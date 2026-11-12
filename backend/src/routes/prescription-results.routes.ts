import { Router, type Request } from "express";

import {
  createUserSupabaseClient,
  type UserSupabaseClientFactory
} from "../config/supabase-user.js";
import {
  createAuthenticateMiddleware,
  requireAuthenticatedIdentity
} from "../middleware/authenticate.middleware.js";
import { AppError } from "../middleware/error.middleware.js";
import {
  supabasePrescriptionResultsRepository,
  type PrescriptionIntelligenceResultRow,
  type PrescriptionResultsRepository
} from "../repositories/prescription-results.repository.js";
import type { AuthVerifier } from "../services/auth.service.js";
import {
  IntelligenceContractValidationError,
  validateIntelligenceResponseV1
} from "../services/intelligence-contract-v1.validator.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PENDING_STATUSES = new Set(["uploaded", "queued", "processing"]);
const COMPLETED_STATUSES = new Set(["completed", "completed_with_warnings"]);

function userClient(request: Request) {
  if (!request.userSupabase) throw new Error("Authenticated user client is unavailable.");
  return request.userSupabase;
}

function prescriptionId(request: Request): string {
  const value = request.params.prescriptionId;
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new AppError(400, "INVALID_PRESCRIPTION_ID", "Prescription ID must be a valid UUID.");
  }
  return value;
}

function notFound(): AppError {
  return new AppError(404, "PRESCRIPTION_NOT_FOUND", "Prescription not found.");
}

function pending(): AppError {
  return new AppError(409, "PROCESSING_PENDING", "Prescription processing is not complete.");
}

function unavailable(): AppError {
  return new AppError(404, "RESULT_UNAVAILABLE", "Prescription analysis result is unavailable.");
}

function validatedResult(row: PrescriptionIntelligenceResultRow, prescriptionId: string) {
  if (!UUID_PATTERN.test(row.prescription_id) || row.prescription_id !== prescriptionId ||
      typeof row.job_id !== "string" || !UUID_PATTERN.test(row.job_id) ||
      row.schema_version !== "1.0" || !COMPLETED_STATUSES.has(row.status)) {
    throw new AppError(500, "STORED_RESULT_INVALID", "Stored prescription analysis result is invalid.");
  }
  try {
    const result = validateIntelligenceResponseV1(row.result_json, {
      jobId: row.job_id,
      prescriptionId
    });
    if (result.status !== row.status || result.status === "failed") {
      throw new AppError(500, "STORED_RESULT_INVALID", "Stored prescription analysis result is invalid.");
    }
    return result;
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof IntelligenceContractValidationError) {
      throw new AppError(500, "STORED_RESULT_INVALID", "Stored prescription analysis result is invalid.");
    }
    throw error;
  }
}

export function createPrescriptionResultsRouter(
  verifier: AuthVerifier,
  userClientFactory: UserSupabaseClientFactory = createUserSupabaseClient,
  repository: PrescriptionResultsRepository = supabasePrescriptionResultsRepository
): Router {
  const router = Router();
  const authenticate = createAuthenticateMiddleware(verifier, userClientFactory);

  router.get(
    "/api/v1/prescriptions/:prescriptionId/results",
    authenticate,
    async (request, response) => {
      const identity = requireAuthenticatedIdentity(request);
      const id = prescriptionId(request);
      const client = userClient(request);
      const prescription = await repository.findOwnedPrescription(client, identity.userId, id);
      // This explicit check preserves indistinguishable missing/non-owned behavior
      // even for a faulty repository implementation.
      if (!prescription || prescription.user_id !== identity.userId || prescription.id !== id) {
        throw notFound();
      }
      if (PENDING_STATUSES.has(prescription.status)) throw pending();
      // A terminal infrastructure/processing failure must never be presented
      // as a completed analysis, even if a corrupted row exists alongside it.
      // The frontend accepts only successful Contract v1 result envelopes.
      if (prescription.status === "failed") throw unavailable();
      if (!COMPLETED_STATUSES.has(prescription.status)) {
        throw new AppError(500, "STORED_RESULT_INVALID", "Stored prescription analysis result is invalid.");
      }

      const stored = await repository.findOwnedResult(client, id);
      if (!stored) throw unavailable();
      response.status(200).json(validatedResult(stored, id));
    }
  );

  return router;
}
