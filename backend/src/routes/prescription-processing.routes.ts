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
  createConfiguredProcessingJobStore,
  type ProcessingJobStoreFactory
} from "../repositories/processing-job.store.js";
import type { AuthVerifier } from "../services/auth.service.js";
import { ProcessingJobService } from "../services/processing-job.service.js";

function requireUserClient(request: Request) {
  if (!request.userSupabase) {
    throw new Error("Authenticated user client is unavailable.");
  }
  return request.userSupabase;
}

function prescriptionId(request: Request): string {
  const value = request.params.prescriptionId;
  return typeof value === "string" ? value : "";
}

export function createPrescriptionProcessingRouter(
  verifier: AuthVerifier,
  userClientFactory: UserSupabaseClientFactory = createUserSupabaseClient,
  storeFactory: ProcessingJobStoreFactory = createConfiguredProcessingJobStore
): Router {
  const router = Router();
  const authenticate = createAuthenticateMiddleware(verifier, userClientFactory);

  router.post(
    "/api/v1/prescriptions/:prescriptionId/process",
    authenticate,
    async (request, response) => {
      if (
        request.body !== undefined &&
        (typeof request.body !== "object" || request.body === null ||
          Array.isArray(request.body) || Object.keys(request.body).length !== 0)
      ) {
        throw new AppError(
          400,
          "INVALID_PROCESSING_REQUEST",
          "Processing submission does not accept request fields."
        );
      }

      const identity = requireAuthenticatedIdentity(request);
      const service = new ProcessingJobService(
        storeFactory(requireUserClient(request))
      );
      const result = await service.submit(identity.userId, prescriptionId(request));
      response.status(result.statusCode).json(result.body);
    }
  );

  router.get(
    "/api/v1/prescriptions/:prescriptionId/processing-status",
    authenticate,
    async (request, response) => {
      const identity = requireAuthenticatedIdentity(request);
      const service = new ProcessingJobService(
        storeFactory(requireUserClient(request))
      );
      response.status(200).json(
        await service.status(identity.userId, prescriptionId(request))
      );
    }
  );

  return router;
}
