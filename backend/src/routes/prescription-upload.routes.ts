import { randomUUID } from "node:crypto";

import { Router } from "express";

import { getPrescriptionUploadEnv } from "../config/env.js";
import {
  createUserSupabaseClient,
  type UserSupabaseClientFactory
} from "../config/supabase-user.js";
import {
  createAuthenticateMiddleware,
  requireAuthenticatedIdentity
} from "../middleware/authenticate.middleware.js";
import { AppError } from "../middleware/error.middleware.js";
import { parsePrescriptionMultipart } from "../middleware/prescription-multipart.js";
import {
  PrescriptionRepositoryError,
  prescriptionRecordMatches,
  supabasePrescriptionRepository,
  type PrescriptionRepository
} from "../repositories/prescription.repository.js";
import {
  createS3PrescriptionStorage,
  PrescriptionStorageError,
  type PrescriptionStorage
} from "../services/prescription-storage.service.js";
import type { AuthVerifier } from "../services/auth.service.js";
import type { PrescriptionInsert } from "../types/prescriptions.js";

export interface PrescriptionUploadDependencies {
  readonly storage: PrescriptionStorage;
  readonly repository: PrescriptionRepository;
  readonly bucket: string;
  readonly maximumFileSizeBytes: number;
  readonly uploadTimeoutMs: number;
  readonly generatePrescriptionId: () => string;
}

export type PrescriptionUploadDependenciesFactory = () =>
  PrescriptionUploadDependencies;

let defaultDependencies: PrescriptionUploadDependencies | undefined;

export const createDefaultPrescriptionUploadDependencies:
PrescriptionUploadDependenciesFactory = () => {
  if (defaultDependencies) return defaultDependencies;
  const configuration = getPrescriptionUploadEnv();
  defaultDependencies = {
    storage: createS3PrescriptionStorage({
      region: configuration.awsRegion,
      bucket: configuration.awsS3Bucket
    }),
    repository: supabasePrescriptionRepository,
    bucket: configuration.awsS3Bucket,
    maximumFileSizeBytes: configuration.maximumFileSizeBytes,
    uploadTimeoutMs: configuration.uploadTimeoutMs,
    generatePrescriptionId: randomUUID
  };
  return defaultDependencies;
};

function requireUserClient(request: Express.Request) {
  if (!request.userSupabase) {
    throw new Error("Authenticated user client is unavailable.");
  }
  return request.userSupabase;
}

export function createPrescriptionUploadRouter(
  verifier: AuthVerifier,
  userClientFactory: UserSupabaseClientFactory = createUserSupabaseClient,
  dependenciesFactory: PrescriptionUploadDependenciesFactory =
    createDefaultPrescriptionUploadDependencies
): Router {
  const router = Router();
  const authenticate = createAuthenticateMiddleware(verifier, userClientFactory);

  router.post(
    "/api/v1/prescriptions/upload",
    authenticate,
    async (request, response) => {
      const identity = requireAuthenticatedIdentity(request);
      const dependencies = dependenciesFactory();
      const file = await parsePrescriptionMultipart(
        request,
        dependencies.maximumFileSizeBytes,
        { uploadTimeoutMs: dependencies.uploadTimeoutMs }
      );
      const prescriptionId = dependencies.generatePrescriptionId();
      const objectKey = `private/prescriptions/${prescriptionId}/source.${file.extension}`;

      try {
        await dependencies.storage.upload({
          objectKey,
          bytes: file.bytes,
          fileType: file.fileType
        });
      } catch (error) {
        if (error instanceof PrescriptionStorageError) {
          throw new AppError(
            503,
            "PRESCRIPTION_STORAGE_FAILED",
            "Prescription could not be stored."
          );
        }
        throw error;
      }

      const insert: PrescriptionInsert = {
        id: prescriptionId,
        user_id: identity.userId,
        storage_provider: "aws_s3",
        storage_bucket: dependencies.bucket,
        object_key: objectKey,
        file_type: file.fileType,
        file_size_bytes: file.sizeBytes,
        status: "uploaded"
      };

      try {
        await dependencies.repository.create(requireUserClient(request), insert);
      } catch (error) {
        const definiteRejection = error instanceof PrescriptionRepositoryError &&
          error.outcome === "definite_rejection";

        if (!definiteRejection) {
          try {
            const observed = await dependencies.repository.findOwnedById(
              requireUserClient(request),
              identity.userId,
              prescriptionId
            );
            if (observed && prescriptionRecordMatches(observed, insert)) {
              // The INSERT committed but its response was lost. Preserve the
              // object and treat the verified owner-scoped record as success.
            } else {
              throw new AppError(
                500,
                observed
                  ? "PRESCRIPTION_INTEGRITY_CHECK_FAILED"
                  : "PRESCRIPTION_REGISTRATION_UNCERTAIN",
                "Prescription registration requires reconciliation."
              );
            }
          } catch (reconciliationError) {
            if (reconciliationError instanceof AppError) throw reconciliationError;
            throw new AppError(
              500,
              "PRESCRIPTION_REGISTRATION_UNCERTAIN",
              "Prescription registration requires reconciliation."
            );
          }
        } else {
        try {
          await dependencies.storage.delete(objectKey);
        } catch {
          throw new AppError(
            500,
            "PRESCRIPTION_CLEANUP_FAILED",
            "Prescription upload could not be completed safely."
          );
        }
        throw new AppError(
          500,
          "PRESCRIPTION_REGISTRATION_FAILED",
          "Prescription upload could not be completed."
        );
        }
      }

      response.status(201).json({
        prescription_id: prescriptionId,
        upload: {
          state: "stored",
          mime_type: file.fileType,
          size_bytes: file.sizeBytes
        },
        processing: {
          requested: false,
          job_id: null
        }
      });
    }
  );

  return router;
}
