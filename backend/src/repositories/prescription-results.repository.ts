import type { UserSupabaseClient } from "../config/supabase-user.js";
import type { PrescriptionStatus } from "../types/prescriptions.js";

export interface OwnedPrescriptionForResults {
  readonly id: string;
  readonly user_id: string;
  readonly status: PrescriptionStatus;
}

export interface PrescriptionIntelligenceResultRow {
  readonly prescription_id: string;
  readonly job_id: string | null;
  readonly schema_version: string;
  readonly status: string;
  readonly result_json: unknown;
  readonly created_at: string;
  readonly is_current?: boolean;
}

export interface PrescriptionResultsRepository {
  findOwnedPrescription(
    client: UserSupabaseClient,
    userId: string,
    prescriptionId: string
  ): Promise<OwnedPrescriptionForResults | null>;
  findOwnedResult(
    client: UserSupabaseClient,
    prescriptionId: string
  ): Promise<PrescriptionIntelligenceResultRow | null>;
}

export class PrescriptionResultsRepositoryError extends Error {
  constructor() {
    super("Prescription results query failed.");
    this.name = "PrescriptionResultsRepositoryError";
  }
}

const PRESCRIPTION_RESULT_FIELDS = [
  "prescription_id",
  "job_id",
  "schema_version",
  "status",
  "result_json",
  "created_at"
].join(",");

type SupabaseQueryError = {
  readonly code?: unknown;
};

function isLegacyResultSchema(error: unknown): boolean {
  // PostgreSQL undefined_column. Only this exact structural mismatch may use
  // the legacy one-result-per-prescription query. Authentication, RLS and
  // transport failures must continue to fail closed.
  return typeof error === "object" && error !== null &&
    (error as SupabaseQueryError).code === "42703";
}

export const supabasePrescriptionResultsRepository: PrescriptionResultsRepository = {
  async findOwnedPrescription(client, userId, prescriptionId) {
    try {
      const { data, error } = await client
        .from("prescriptions")
        .select("id,user_id,status")
        .eq("id", prescriptionId)
        .eq("user_id", userId)
        .maybeSingle<OwnedPrescriptionForResults>();
      if (error) throw new PrescriptionResultsRepositoryError();
      return data ?? null;
    } catch (error) {
      if (error instanceof PrescriptionResultsRepositoryError) throw error;
      throw new PrescriptionResultsRepositoryError();
    }
  },

  async findOwnedResult(client, prescriptionId) {
    try {
      // RLS on intelligence results derives owner access from the prescription.
      // Ownership was also verified by findOwnedPrescription above.
      const current = await client
        .from("prescription_intelligence_results")
        .select(PRESCRIPTION_RESULT_FIELDS)
        .eq("prescription_id", prescriptionId)
        .eq("is_current", true)
        .maybeSingle<PrescriptionIntelligenceResultRow>();
      if (!current.error) return current.data ?? null;
      if (!isLegacyResultSchema(current.error)) throw new PrescriptionResultsRepositoryError();

      // The deployed legacy schema has a UNIQUE(prescription_id) invariant but
      // no is_current column. Do not depend on undeployed review/history tables.
      const legacy = await client
        .from("prescription_intelligence_results")
        .select(PRESCRIPTION_RESULT_FIELDS)
        .eq("prescription_id", prescriptionId)
        .maybeSingle<PrescriptionIntelligenceResultRow>();
      if (legacy.error) throw new PrescriptionResultsRepositoryError();
      return legacy.data ?? null;
    } catch (error) {
      if (error instanceof PrescriptionResultsRepositoryError) throw error;
      throw new PrescriptionResultsRepositoryError();
    }
  }
};

export { isLegacyResultSchema, PRESCRIPTION_RESULT_FIELDS };
