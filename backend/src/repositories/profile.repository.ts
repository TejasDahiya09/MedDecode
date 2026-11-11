import type { UserSupabaseClient } from "../config/supabase-user.js";
import type {
  ApplicationUserProfile,
  ApplicationUserUpdate,
  HealthProfile,
  HealthProfileInput,
  HealthProfileUpdate
} from "../types/profiles.js";

const APPLICATION_USER_FIELDS = "id,email,name,created_at,updated_at";
const HEALTH_PROFILE_FIELDS = [
  "id",
  "user_id",
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
  "other_conditions",
  "created_at",
  "updated_at"
].join(",");

export interface ProfileRepository {
  findApplicationUser(
    client: UserSupabaseClient,
    userId: string
  ): Promise<ApplicationUserProfile | null>;
  findHealthProfile(
    client: UserSupabaseClient,
    userId: string
  ): Promise<HealthProfile | null>;
  updateApplicationUser(
    client: UserSupabaseClient,
    userId: string,
    input: ApplicationUserUpdate
  ): Promise<ApplicationUserProfile | null>;
  createHealthProfile(
    client: UserSupabaseClient,
    userId: string,
    input: HealthProfileInput
  ): Promise<HealthProfile>;
  updateHealthProfile(
    client: UserSupabaseClient,
    userId: string,
    input: HealthProfileUpdate
  ): Promise<HealthProfile | null>;
}

export type ProfileRepositoryErrorCode =
  | "DUPLICATE_HEALTH_PROFILE"
  | "MISSING_APPLICATION_PROFILE"
  | "QUERY_FAILED";

export class ProfileRepositoryError extends Error {
  constructor(readonly code: ProfileRepositoryErrorCode) {
    super("Profile repository operation failed.");
    this.name = "ProfileRepositoryError";
  }
}

function createHealthProfileError(error: unknown): ProfileRepositoryError {
  const providerCode = error && typeof error === "object" && "code" in error
    ? (error as { code?: unknown }).code
    : undefined;

  if (providerCode === "23505") {
    return new ProfileRepositoryError("DUPLICATE_HEALTH_PROFILE");
  }

  if (providerCode === "23503") {
    return new ProfileRepositoryError("MISSING_APPLICATION_PROFILE");
  }

  return new ProfileRepositoryError("QUERY_FAILED");
}

function applicationUserResponse(row: ApplicationUserProfile): ApplicationUserProfile {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function healthProfileResponse(row: HealthProfile): HealthProfile {
  return {
    id: row.id,
    user_id: row.user_id,
    age: row.age,
    gender: row.gender,
    allergies: row.allergies,
    diabetes: row.diabetes,
    hypertension: row.hypertension,
    kidney_disease: row.kidney_disease,
    liver_disease: row.liver_disease,
    asthma: row.asthma,
    thyroid: row.thyroid,
    pregnancy: row.pregnancy,
    other_conditions: row.other_conditions,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

export const supabaseProfileRepository: ProfileRepository = {
  async findApplicationUser(client, userId) {
    const { data, error } = await client
      .from("users")
      .select(APPLICATION_USER_FIELDS)
      .eq("id", userId)
      .maybeSingle<ApplicationUserProfile>();

    if (error) {
      throw new Error("Application profile query failed.");
    }

    return data ? applicationUserResponse(data) : null;
  },

  async findHealthProfile(client, userId) {
    const { data, error } = await client
      .from("health_profiles")
      .select(HEALTH_PROFILE_FIELDS)
      .eq("user_id", userId)
      .maybeSingle<HealthProfile>();

    if (error) {
      throw new Error("Health profile query failed.");
    }

    return data ? healthProfileResponse(data) : null;
  },

  async updateApplicationUser(client, userId, input) {
    const { data, error } = await client
      .from("users")
      .update(input as never)
      .eq("id", userId)
      .select(APPLICATION_USER_FIELDS)
      .maybeSingle<ApplicationUserProfile>();

    if (error) {
      throw new ProfileRepositoryError("QUERY_FAILED");
    }

    return data ? applicationUserResponse(data) : null;
  },

  async createHealthProfile(client, userId, input) {
    const { data, error } = await client
      .from("health_profiles")
      .insert({ user_id: userId, ...input } as never)
      .select(HEALTH_PROFILE_FIELDS)
      .single<HealthProfile>();

    if (error || !data) {
      throw createHealthProfileError(error);
    }

    return healthProfileResponse(data);
  },

  async updateHealthProfile(client, userId, input) {
    const { data, error } = await client
      .from("health_profiles")
      .update(input as never)
      .eq("user_id", userId)
      .select(HEALTH_PROFILE_FIELDS)
      .maybeSingle<HealthProfile>();

    if (error) {
      throw new ProfileRepositoryError("QUERY_FAILED");
    }

    return data ? healthProfileResponse(data) : null;
  }
};
