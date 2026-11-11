import type { UserSupabaseClient } from "../config/supabase-user.js";
import type {
  FamilyMemberInput,
  FamilyMemberRow,
  FamilyMemberUpdate
} from "../types/family-members.js";

export const FAMILY_MEMBER_FIELDS = [
  "id",
  "user_id",
  "name",
  "relationship",
  "created_at",
  "updated_at"
].join(",");

export interface FamilyMemberRepository {
  listOwned(
    client: UserSupabaseClient,
    userId: string,
    pagination: { readonly limit: number; readonly offset: number }
  ): Promise<readonly FamilyMemberRow[]>;
  findOwned(
    client: UserSupabaseClient,
    userId: string,
    memberId: string
  ): Promise<FamilyMemberRow | null>;
  createOwned(
    client: UserSupabaseClient,
    userId: string,
    input: FamilyMemberInput
  ): Promise<FamilyMemberRow>;
  updateOwned(
    client: UserSupabaseClient,
    userId: string,
    memberId: string,
    input: FamilyMemberUpdate
  ): Promise<FamilyMemberRow | null>;
  deleteOwned(
    client: UserSupabaseClient,
    userId: string,
    memberId: string
  ): Promise<FamilyMemberRow | null>;
}

export type FamilyMemberRepositoryErrorCode =
  | "MISSING_APPLICATION_PROFILE"
  | "QUERY_FAILED";

export class FamilyMemberRepositoryError extends Error {
  constructor(readonly code: FamilyMemberRepositoryErrorCode) {
    super("Family member repository operation failed.");
    this.name = "FamilyMemberRepositoryError";
  }
}

function repositoryError(error: unknown): FamilyMemberRepositoryError {
  const code = error && typeof error === "object" && "code" in error
    ? (error as { code?: unknown }).code
    : undefined;
  return new FamilyMemberRepositoryError(
    code === "23503" ? "MISSING_APPLICATION_PROFILE" : "QUERY_FAILED"
  );
}

function validText(value: unknown): value is string {
  return typeof value === "string" &&
    value === value.trim() &&
    value.length >= 1 &&
    value.length <= 100;
}

function insertPayload(userId: string, input: FamilyMemberInput) {
  if (!validText(input.name) ||
    !(input.relationship === null || validText(input.relationship))) {
    throw new FamilyMemberRepositoryError("QUERY_FAILED");
  }
  return {
    user_id: userId,
    name: input.name,
    relationship: input.relationship
  };
}

function updatePayload(input: FamilyMemberUpdate) {
  const payload: { name?: string; relationship?: string | null } = {};
  if (Object.hasOwn(input, "name")) {
    if (!validText(input.name)) throw new FamilyMemberRepositoryError("QUERY_FAILED");
    payload.name = input.name;
  }
  if (Object.hasOwn(input, "relationship")) {
    if (!(input.relationship === null || validText(input.relationship))) {
      throw new FamilyMemberRepositoryError("QUERY_FAILED");
    }
    payload.relationship = input.relationship;
  }
  if (!Object.hasOwn(payload, "name") && !Object.hasOwn(payload, "relationship")) {
    throw new FamilyMemberRepositoryError("QUERY_FAILED");
  }
  return payload;
}

export const supabaseFamilyMemberRepository: FamilyMemberRepository = {
  async listOwned(client, userId, pagination) {
    try {
      const { data, error } = await client
        .from("family_members")
        .select(FAMILY_MEMBER_FIELDS)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(pagination.offset, pagination.offset + pagination.limit);
      if (error || !data) throw repositoryError(error);
      return data as unknown as FamilyMemberRow[];
    } catch (error) {
      if (error instanceof FamilyMemberRepositoryError) throw error;
      throw repositoryError(error);
    }
  },

  async findOwned(client, userId, memberId) {
    try {
      const { data, error } = await client
        .from("family_members")
        .select(FAMILY_MEMBER_FIELDS)
        .eq("id", memberId)
        .eq("user_id", userId)
        .maybeSingle<FamilyMemberRow>();
      if (error) throw repositoryError(error);
      return data ?? null;
    } catch (error) {
      if (error instanceof FamilyMemberRepositoryError) throw error;
      throw repositoryError(error);
    }
  },

  async createOwned(client, userId, input) {
    try {
      const { data, error } = await client
        .from("family_members")
        .insert(insertPayload(userId, input) as never)
        .select(FAMILY_MEMBER_FIELDS)
        .single<FamilyMemberRow>();
      if (error || !data) throw repositoryError(error);
      return data;
    } catch (error) {
      if (error instanceof FamilyMemberRepositoryError) throw error;
      throw repositoryError(error);
    }
  },

  async updateOwned(client, userId, memberId, input) {
    try {
      const { data, error } = await client
        .from("family_members")
        .update(updatePayload(input) as never)
        .eq("id", memberId)
        .eq("user_id", userId)
        .select(FAMILY_MEMBER_FIELDS)
        .maybeSingle<FamilyMemberRow>();
      if (error) throw repositoryError(error);
      return data ?? null;
    } catch (error) {
      if (error instanceof FamilyMemberRepositoryError) throw error;
      throw repositoryError(error);
    }
  },

  async deleteOwned(client, userId, memberId) {
    try {
      const { data, error } = await client
        .from("family_members")
        .delete()
        .eq("id", memberId)
        .eq("user_id", userId)
        .select(FAMILY_MEMBER_FIELDS)
        .maybeSingle<FamilyMemberRow>();
      if (error) throw repositoryError(error);
      return data ?? null;
    } catch (error) {
      if (error instanceof FamilyMemberRepositoryError) throw error;
      throw repositoryError(error);
    }
  }
};
