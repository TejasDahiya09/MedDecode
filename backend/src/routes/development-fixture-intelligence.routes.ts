import { Router, type Request } from "express";

import {
  createUserSupabaseClient,
  type UserSupabaseClientFactory,
} from "../config/supabase-user.js";
import {
  createAuthenticateMiddleware,
  requireAuthenticatedIdentity,
} from "../middleware/authenticate.middleware.js";
import { AppError } from "../middleware/error.middleware.js";
import type { AuthVerifier } from "../services/auth.service.js";
import type { IntelligenceClient } from "../services/intelligence-client.js";
import type { IntelligenceRequestV1 } from "../types/intelligence-contract-v1.js";

const FIXTURE_REQUEST: IntelligenceRequestV1 = {
  schema_version: "1.0",
  job_id: "10000000-0000-4000-8000-000000000020",
  prescription_id: "10000000-0000-4000-8000-000000000021",
  document: {
    access_type: "authorized_url",
    file_url: "https://development.invalid/fictional-fixture.pdf",
    file_type: "application/pdf",
  },
  requested_analysis: {
    extract_prescription: true,
    match_medicines: true,
    find_alternatives: false,
    generate_recommendations: false,
  },
};

function requiresEmptyBody(request: Request): void {
  if (
    request.body !== undefined &&
    (typeof request.body !== "object" || request.body === null ||
      Array.isArray(request.body) || Object.keys(request.body).length !== 0)
  ) {
    throw new AppError(400, "INVALID_DEVELOPMENT_FIXTURE_REQUEST", "This development endpoint does not accept request fields.");
  }
}

/**
 * Registered only from a development-only, server-side configuration branch.
 * It has no path, job, document, or command parameters supplied by the caller.
 */
export function createDevelopmentFixtureIntelligenceRouter(
  verifier: AuthVerifier,
  clientFactory: () => IntelligenceClient,
  userClientFactory: UserSupabaseClientFactory = createUserSupabaseClient,
): Router {
  const router = Router();
  const authenticate = createAuthenticateMiddleware(verifier, userClientFactory);

  router.post(
    "/api/v1/development/fictional-intelligence-result",
    authenticate,
    async (request, response) => {
      requiresEmptyBody(request);
      // Require successful verified authentication even though this response is
      // non-persistent and contains only fictional fixture data.
      requireAuthenticatedIdentity(request);
      try {
        const result = await clientFactory().analyze(FIXTURE_REQUEST);
        if (result.status === "failed") {
          throw new AppError(503, "DEVELOPMENT_FIXTURE_UNAVAILABLE", "The fictional intelligence fixture is unavailable.");
        }
        response.status(200).json(result);
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError(503, "DEVELOPMENT_FIXTURE_UNAVAILABLE", "The fictional intelligence fixture is unavailable.");
      }
    },
  );

  return router;
}
