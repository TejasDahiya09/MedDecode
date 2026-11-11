import { Router } from "express";

import {
  createAuthenticateMiddleware,
  requireAuthenticatedIdentity
} from "../middleware/authenticate.middleware.js";
import type { AuthVerifier } from "../services/auth.service.js";

export function createAuthRouter(verifier: AuthVerifier): Router {
  const router = Router();

  router.get(
    "/api/v1/auth/me",
    createAuthenticateMiddleware(verifier),
    (request, response) => {
      const identity = requireAuthenticatedIdentity(request);
      const user = identity.email
        ? { id: identity.userId, email: identity.email }
        : { id: identity.userId };

      response.status(200).json({ user });
    }
  );

  return router;
}
