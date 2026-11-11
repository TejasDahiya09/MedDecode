import type { Request, RequestHandler } from "express";

import type {
  AuthVerifier,
  VerifiedIdentity
} from "../services/auth.service.js";
import type { UserSupabaseClientFactory } from "../config/supabase-user.js";
import { AppError } from "./error.middleware.js";

const unauthorized = () => new AppError(
  401,
  "UNAUTHORIZED",
  "Authentication required."
);

function extractBearerToken(request: Request): string {
  const authorizationValues: string[] = [];

  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === "authorization") {
      authorizationValues.push(request.rawHeaders[index + 1] ?? "");
    }
  }

  if (authorizationValues.length !== 1) {
    throw unauthorized();
  }

  const match = /^Bearer[\t ]+(\S+)[\t ]*$/i.exec(authorizationValues[0] ?? "");
  const token = match?.[1];

  if (!token || token.includes(",")) {
    throw unauthorized();
  }

  return token;
}

export function createAuthenticateMiddleware(
  verifier: AuthVerifier,
  userClientFactory?: UserSupabaseClientFactory
): RequestHandler {
  return async (request, _response, next) => {
    let accessToken: string;
    let identity: VerifiedIdentity;

    try {
      accessToken = extractBearerToken(request);
      identity = await verifier.verifyAccessToken(accessToken);
    } catch {
      next(unauthorized());
      return;
    }

    request.auth = Object.freeze({ ...identity });

    if (userClientFactory) {
      try {
        request.userSupabase = userClientFactory(accessToken);
      } catch (error) {
        next(error);
        return;
      }
    }

    next();
  };
}

export function requireAuthenticatedIdentity(
  request: Request
): Readonly<VerifiedIdentity> {
  if (!request.auth) {
    throw unauthorized();
  }

  return request.auth;
}
