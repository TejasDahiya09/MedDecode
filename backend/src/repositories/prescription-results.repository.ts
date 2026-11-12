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
  "result_json"
].join(",");

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
      const { data, error } = await client
        .from("prescription_intelligence_results")
        .select(PRESCRIPTION_RESULT_FIELDS)
        .eq("prescription_id", prescriptionId)
        .maybeSingle<PrescriptionIntelligenceResultRow>();
      if (error) throw new PrescriptionResultsRepositoryError();
      return data ?? null;
    } catch (error) {
      if (error instanceof PrescriptionResultsRepositoryError) throw error;
      throw new PrescriptionResultsRepositoryError();
    }
  }
};

export { PRESCRIPTION_RESULT_FIELDS };
