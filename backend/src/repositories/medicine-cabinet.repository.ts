import type { UserSupabaseClient } from "../config/supabase-user.js";
import type { MedicineCabinetRow } from "../types/medicine-cabinet.js";

export const MEDICINE_CABINET_FIELDS = [
  "id",
  "user_id",
  "medicine_id",
  "quantity",
  "purchase_date",
  "expiry_date",
  "refill_date",
  "usage_information",
  "created_at",
  "updated_at"
].join(",");

export interface MedicineCabinetRepository {
  listOwned(
    client: UserSupabaseClient,
    userId: string,
    pagination: { readonly limit: number; readonly offset: number }
  ): Promise<readonly MedicineCabinetRow[]>;
  findOwnedDetail(
    client: UserSupabaseClient,
    userId: string,
    entryId: string
  ): Promise<MedicineCabinetRow | null>;
}

export class MedicineCabinetRepositoryError extends Error {
  constructor() {
    super("Medicine cabinet query failed.");
    this.name = "MedicineCabinetRepositoryError";
  }
}

export const supabaseMedicineCabinetRepository: MedicineCabinetRepository = {
  async listOwned(client, userId, pagination) {
    try {
      const { data, error } = await client
        .from("medicine_cabinet")
        .select(MEDICINE_CABINET_FIELDS)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        // PostgREST ranges are inclusive. Fetch one extra row for has_more.
        .range(pagination.offset, pagination.offset + pagination.limit);

      if (error || !data) throw new MedicineCabinetRepositoryError();
      return data as unknown as MedicineCabinetRow[];
    } catch (error) {
      if (error instanceof MedicineCabinetRepositoryError) throw error;
      throw new MedicineCabinetRepositoryError();
    }
  },

  async findOwnedDetail(client, userId, entryId) {
    try {
      const { data, error } = await client
        .from("medicine_cabinet")
        .select(MEDICINE_CABINET_FIELDS)
        .eq("id", entryId)
        .eq("user_id", userId)
        .maybeSingle<MedicineCabinetRow>();

      if (error) throw new MedicineCabinetRepositoryError();
      return data ?? null;
    } catch (error) {
      if (error instanceof MedicineCabinetRepositoryError) throw error;
      throw new MedicineCabinetRepositoryError();
    }
  }
};
