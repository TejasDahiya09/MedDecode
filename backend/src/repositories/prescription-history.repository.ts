import type { UserSupabaseClient } from "../config/supabase-user.js";
import type { PrescriptionHistoryRow } from "../types/prescriptions.js";

export const PRESCRIPTION_HISTORY_FIELDS = [
  "id",
  "user_id",
  "file_type",
  "file_size_bytes",
  "status",
  "prescription_date",
  "created_at",
  "updated_at",
  "processed_at"
].join(",");

export interface PrescriptionHistoryRepository {
  listOwned(
    client: UserSupabaseClient,
    userId: string,
    pagination: { readonly limit: number; readonly offset: number }
  ): Promise<readonly PrescriptionHistoryRow[]>;
  findOwnedDetail(
    client: UserSupabaseClient,
    userId: string,
    prescriptionId: string
  ): Promise<PrescriptionHistoryRow | null>;
}

export class PrescriptionHistoryRepositoryError extends Error {
  constructor() {
    super("Prescription history query failed.");
    this.name = "PrescriptionHistoryRepositoryError";
  }
}

export const supabasePrescriptionHistoryRepository:
PrescriptionHistoryRepository = {
  async listOwned(client, userId, pagination) {
    try {
      const { data, error } = await client
        .from("prescriptions")
        .select(PRESCRIPTION_HISTORY_FIELDS)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        // PostgREST ranges are inclusive. Fetch one extra row for has_more.
        .range(pagination.offset, pagination.offset + pagination.limit);

      if (error || !data) throw new PrescriptionHistoryRepositoryError();
      return data as unknown as PrescriptionHistoryRow[];
    } catch (error) {
      if (error instanceof PrescriptionHistoryRepositoryError) throw error;
      throw new PrescriptionHistoryRepositoryError();
    }
  },

  async findOwnedDetail(client, userId, prescriptionId) {
    try {
      const { data, error } = await client
        .from("prescriptions")
        .select(PRESCRIPTION_HISTORY_FIELDS)
        .eq("id", prescriptionId)
        .eq("user_id", userId)
        .maybeSingle<PrescriptionHistoryRow>();

      if (error) throw new PrescriptionHistoryRepositoryError();
      return data ?? null;
    } catch (error) {
      if (error instanceof PrescriptionHistoryRepositoryError) throw error;
      throw new PrescriptionHistoryRepositoryError();
    }
  }
};
