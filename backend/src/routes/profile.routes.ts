import { Router } from "express";

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
  ProfileRepositoryError,
  supabaseProfileRepository,
  type ProfileRepository
} from "../repositories/profile.repository.js";
import type { AuthVerifier } from "../services/auth.service.js";
import type {
  ApplicationUserProfile,
  ApplicationUserUpdate,
  HealthProfile,
  HealthProfileInput,
  HealthProfileUpdate
} from "../types/profiles.js";

const HEALTH_PROFILE_FIELDS = [
  "age",
  "gender",
  "allergies",
  "diabetes",
  "hypertension",
  "kidney_disease",
  "liver_disease",
  "asthma",
  "thyroid",
  "pregnancy",
  "other_conditions"
] as const;

const NULLABLE_HEALTH_FIELDS = new Set(["age", "gender", "pregnancy"]);
const BOOLEAN_HEALTH_FIELDS = new Set([
  "diabetes",
  "hypertension",
  "kidney_disease",
  "liver_disease",
  "asthma",
  "thyroid"
]);
const ARRAY_HEALTH_FIELDS = new Set(["allergies", "other_conditions"]);

function invalidInput(message: string): AppError {
  return new AppError(400, "INVALID_PROFILE_INPUT", message);
}

function requireObjectBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw invalidInput("Request body must be a JSON object.");
  }

  return body as Record<string, unknown>;
}

function assertExactAllowedKeys(
  body: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  requireAll: boolean
): void {
  const keys = Object.keys(body);
  if (keys.length === 0) {
    throw invalidInput("Request body must include at least one editable field.");
  }

  if (keys.some((key) => !allowed.has(key))) {
    throw invalidInput("Request body contains an unknown or protected field.");
  }

  if (requireAll && (keys.length !== allowed.size || [...allowed].some(
    (key) => !Object.hasOwn(body, key)
  ))) {
    throw invalidInput(
      "Health profile creation requires every editable field to be stated explicitly."
    );
  }
}

function normalizedNullableText(
  value: unknown,
  fieldName: string,
  maximumLength: number
): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw invalidInput(`${fieldName} must be a string or null.`);
  }

  const normalized = value.trim();
  if (!normalized || normalized.length > maximumLength) {
    throw invalidInput(
      `${fieldName} must contain 1 to ${maximumLength} characters or be null.`
    );
  }

  return normalized;
}

function normalizedStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value) || value.length > 50) {
    throw invalidInput(`${fieldName} must be an array containing at most 50 strings.`);
  }

  return value.map((item) => {
    if (typeof item !== "string") {
      throw invalidInput(`${fieldName} must contain only strings.`);
    }

    const normalized = item.trim();
    if (!normalized || normalized.length > 120) {
      throw invalidInput(
        `${fieldName} entries must contain 1 to 120 characters.`
      );
    }
    return normalized;
  });
}

function applicationUserUpdate(body: unknown): ApplicationUserUpdate {
  const record = requireObjectBody(body);
  assertExactAllowedKeys(record, new Set(["name"]), true);
  return { name: normalizedNullableText(record.name, "name", 100) };
}

function healthFieldValue(field: string, value: unknown): unknown {
  if (field === "age") {
    if (value === null) return null;
    if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 150) {
      throw invalidInput("age must be an integer between 0 and 150 or null.");
    }
    return value;
  }

  if (field === "gender") {
    return normalizedNullableText(value, "gender", 50);
  }

  if (field === "pregnancy") {
    if (value !== null && typeof value !== "boolean") {
      throw invalidInput("pregnancy must be a boolean or null.");
    }
    return value;
  }

  if (BOOLEAN_HEALTH_FIELDS.has(field)) {
    if (typeof value !== "boolean") {
      throw invalidInput(`${field} must be a boolean.`);
    }
    return value;
  }

  if (ARRAY_HEALTH_FIELDS.has(field)) {
    return normalizedStringArray(value, field);
  }

  if (value === null && !NULLABLE_HEALTH_FIELDS.has(field)) {
    throw invalidInput(`${field} cannot be null.`);
  }

  throw invalidInput("Request body contains an unknown or protected field.");
}

function healthProfileInput(body: unknown, requireAll: true): HealthProfileInput;
function healthProfileInput(body: unknown, requireAll: false): HealthProfileUpdate;
function healthProfileInput(
  body: unknown,
  requireAll: boolean
): HealthProfileInput | HealthProfileUpdate {
  const record = requireObjectBody(body);
  const allowed = new Set<string>(HEALTH_PROFILE_FIELDS);
  assertExactAllowedKeys(record, allowed, requireAll);

  const result: Record<string, unknown> = {};
  for (const field of Object.keys(record)) {
    result[field] = healthFieldValue(field, record[field]);
  }

  return result as unknown as HealthProfileInput | HealthProfileUpdate;
}

function handleRepositoryError(error: unknown): never {
  if (error instanceof ProfileRepositoryError) {
    if (error.code === "DUPLICATE_HEALTH_PROFILE") {
      throw new AppError(
        409,
        "HEALTH_PROFILE_ALREADY_EXISTS",
        "Health profile already exists."
      );
    }

    if (error.code === "MISSING_APPLICATION_PROFILE") {
      throw new AppError(
        409,
        "APPLICATION_PROFILE_REQUIRED",
        "Application profile is required before creating a health profile."
      );
    }
  }

  throw error;
}

function requireUserClient(request: Express.Request) {
  if (!request.userSupabase) {
    throw new Error("Authenticated user client is unavailable.");
  }

  return request.userSupabase;
}

function applicationUserResponse(profile: ApplicationUserProfile) {
  return {
    id: profile.id,
    email: profile.email,
    name: profile.name,
    created_at: profile.created_at,
    updated_at: profile.updated_at
  };
}

function healthProfileResponse(profile: HealthProfile) {
  return {
    id: profile.id,
    user_id: profile.user_id,
    age: profile.age,
    gender: profile.gender,
    allergies: profile.allergies,
    diabetes: profile.diabetes,
    hypertension: profile.hypertension,
    kidney_disease: profile.kidney_disease,
    liver_disease: profile.liver_disease,
    asthma: profile.asthma,
    thyroid: profile.thyroid,
    pregnancy: profile.pregnancy,
    other_conditions: profile.other_conditions,
    created_at: profile.created_at,
    updated_at: profile.updated_at
  };
}

export function createProfileRouter(
  verifier: AuthVerifier,
  userClientFactory: UserSupabaseClientFactory = createUserSupabaseClient,
  repository: ProfileRepository = supabaseProfileRepository
): Router {
  const router = Router();
  const authenticate = createAuthenticateMiddleware(
    verifier,
    userClientFactory
  );

  router.get("/api/v1/users/me", authenticate, async (request, response) => {
    const identity = requireAuthenticatedIdentity(request);
    const profile = await repository.findApplicationUser(
      requireUserClient(request),
      identity.userId
    );

    if (!profile) {
      throw new AppError(
        404,
        "USER_PROFILE_NOT_FOUND",
        "User profile not found."
      );
    }

    response.status(200).json({ profile: applicationUserResponse(profile) });
  });

  router.patch("/api/v1/users/me", authenticate, async (request, response) => {
    const identity = requireAuthenticatedIdentity(request);
    let profile: ApplicationUserProfile | null;
    try {
      profile = await repository.updateApplicationUser(
        requireUserClient(request),
        identity.userId,
        applicationUserUpdate(request.body)
      );
    } catch (error) {
      handleRepositoryError(error);
    }

    if (!profile) {
      throw new AppError(
        404,
        "USER_PROFILE_NOT_FOUND",
        "User profile not found."
      );
    }

    response.status(200).json({ profile: applicationUserResponse(profile) });
  });

  router.get(
    "/api/v1/health-profile/me",
    authenticate,
    async (request, response) => {
      const identity = requireAuthenticatedIdentity(request);
      const healthProfile = await repository.findHealthProfile(
        requireUserClient(request),
        identity.userId
      );

      if (!healthProfile) {
        throw new AppError(
          404,
          "HEALTH_PROFILE_NOT_FOUND",
          "Health profile not found."
        );
      }

      response.status(200).json({
        healthProfile: healthProfileResponse(healthProfile)
      });
    }
  );

  router.post(
    "/api/v1/health-profile/me",
    authenticate,
    async (request, response) => {
      const identity = requireAuthenticatedIdentity(request);
      let healthProfile: HealthProfile;
      try {
        healthProfile = await repository.createHealthProfile(
          requireUserClient(request),
          identity.userId,
          healthProfileInput(request.body, true)
        );
      } catch (error) {
        handleRepositoryError(error);
      }

      response.status(201).json({
        healthProfile: healthProfileResponse(healthProfile)
      });
    }
  );

  router.patch(
    "/api/v1/health-profile/me",
    authenticate,
    async (request, response) => {
      const identity = requireAuthenticatedIdentity(request);
      let healthProfile: HealthProfile | null;
      try {
        healthProfile = await repository.updateHealthProfile(
          requireUserClient(request),
          identity.userId,
          healthProfileInput(request.body, false)
        );
      } catch (error) {
        handleRepositoryError(error);
      }

      if (!healthProfile) {
        throw new AppError(
          404,
          "HEALTH_PROFILE_NOT_FOUND",
          "Health profile not found."
        );
      }

      response.status(200).json({
        healthProfile: healthProfileResponse(healthProfile)
      });
    }
  );

  return router;
}
