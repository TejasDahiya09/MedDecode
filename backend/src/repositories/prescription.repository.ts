import type { UserSupabaseClient } from "../config/supabase-user.js";
import type {
  PrescriptionInsert,
  PrescriptionRecord
} from "../types/prescriptions.js";

const PRESCRIPTION_FIELDS = [
  "id", "user_id", "storage_provider", "storage_bucket", "object_key",
  "file_type", "file_size_bytes", "status", "created_at", "updated_at"
].join(",");

export interface PrescriptionRepository {
  create(
    client: UserSupabaseClient,
    input: PrescriptionInsert
  ): Promise<PrescriptionRecord>;
  findOwnedById(
    client: UserSupabaseClient,
    userId: string,
    prescriptionId: string
  ): Promise<PrescriptionRecord | null>;
}

export class PrescriptionRepositoryError extends Error {
  constructor(
    readonly code:
      | "MISSING_APPLICATION_PROFILE"
      | "WRITE_DENIED"
      | "CONSTRAINT_REJECTED"
      | "AMBIGUOUS_OUTCOME",
    readonly outcome: "definite_rejection" | "ambiguous"
  ) {
    super("Prescription repository operation failed.");
    this.name = "PrescriptionRepositoryError";
  }
}

function repositoryError(error: unknown): PrescriptionRepositoryError {
  const providerCode = error && typeof error === "object" && "code" in error
    ? (error as { code?: unknown }).code
    : undefined;

  if (providerCode === "23503") {
    return new PrescriptionRepositoryError(
      "MISSING_APPLICATION_PROFILE",
      "definite_rejection"
    );
  }
  if (providerCode === "42501") {
    return new PrescriptionRepositoryError("WRITE_DENIED", "definite_rejection");
  }
  if (typeof providerCode === "string" && providerCode.startsWith("23")) {
    return new PrescriptionRepositoryError(
      "CONSTRAINT_REJECTED",
      "definite_rejection"
    );
  }
  return new PrescriptionRepositoryError("AMBIGUOUS_OUTCOME", "ambiguous");
}

export function prescriptionRecordMatches(
  record: PrescriptionRecord,
  expected: PrescriptionInsert
): boolean {
  return record.id === expected.id &&
    record.user_id === expected.user_id &&
    record.storage_provider === expected.storage_provider &&
    record.storage_bucket === expected.storage_bucket &&
    record.object_key === expected.object_key &&
    record.file_type === expected.file_type &&
    record.file_size_bytes === expected.file_size_bytes &&
    record.status === expected.status;
}

export const supabasePrescriptionRepository: PrescriptionRepository = {
  async create(client, input) {
    let result;
    try {
      result = await client
        .from("prescriptions")
        .insert(input as never)
        .select(PRESCRIPTION_FIELDS)
        .single<PrescriptionRecord>();
    } catch {
      throw new PrescriptionRepositoryError("AMBIGUOUS_OUTCOME", "ambiguous");
    }

    if (result.error) throw repositoryError(result.error);
    if (!result.data || !prescriptionRecordMatches(result.data, input)) {
      throw new PrescriptionRepositoryError("AMBIGUOUS_OUTCOME", "ambiguous");
    }
    return result.data;
  },

  async findOwnedById(client, userId, prescriptionId) {
    try {
      const { data, error } = await client
        .from("prescriptions")
        .select(PRESCRIPTION_FIELDS)
        .eq("id", prescriptionId)
        .eq("user_id", userId)
        .maybeSingle<PrescriptionRecord>();

      if (error) {
        throw new PrescriptionRepositoryError("AMBIGUOUS_OUTCOME", "ambiguous");
      }
      return data ?? null;
    } catch (error) {
      if (error instanceof PrescriptionRepositoryError) throw error;
      throw new PrescriptionRepositoryError("AMBIGUOUS_OUTCOME", "ambiguous");
    }
  }
};
