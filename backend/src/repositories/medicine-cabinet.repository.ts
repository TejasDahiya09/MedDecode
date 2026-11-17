import type { UserSupabaseClient } from "../config/supabase-user.js";
import type { MedicineCabinetCreate, MedicineCabinetRow, MedicineCabinetUpdate } from "../types/medicine-cabinet.js";

export const MEDICINE_CABINET_FIELDS = [
  "id",
  "user_id",
  "medicine_id",
  "family_member_id",
  // Keep PostgreSQL numeric precision across PostgREST's JSON boundary.
  "quantity:quantity::text",
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
  deleteOwned?(client: UserSupabaseClient, userId: string, entryId: string): Promise<boolean>;
  medicineExists?(client: UserSupabaseClient, medicineId: string): Promise<boolean>;
  familyOwned?(client: UserSupabaseClient, userId: string, familyId: string): Promise<boolean>;
  createOwned?(client: UserSupabaseClient, userId: string, input: MedicineCabinetCreate): Promise<MedicineCabinetRow>;
  updateOwned?(client: UserSupabaseClient, userId: string, entryId: string, input: MedicineCabinetUpdate): Promise<MedicineCabinetRow | null>;
}

export class MedicineCabinetRepositoryError extends Error {
  constructor() {
    super("Medicine cabinet query failed.");
    this.name = "MedicineCabinetRepositoryError";
  }
}

export const supabaseMedicineCabinetRepository: MedicineCabinetRepository = {
  async updateOwned(client, userId, entryId, input) {
    try {
      const { data, error } = await client.from("medicine_cabinet").update(input as never)
        .eq("id", entryId).eq("user_id", userId).select(MEDICINE_CABINET_FIELDS).maybeSingle<MedicineCabinetRow>();
      if (error) throw new MedicineCabinetRepositoryError();
      return data ?? null;
    } catch { throw new MedicineCabinetRepositoryError(); }
  },
  async medicineExists(client, medicineId) {
    try {
      const rpc = client as unknown as { rpc(name: string, params: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };
      const { data, error } = await rpc.rpc("meddecode_catalogue_detail_v1", { p_id: medicineId });
      if (error) throw new MedicineCabinetRepositoryError();
      if (data === null) return false;
      if (typeof data !== "object" || Array.isArray(data) || (data as { id?: unknown }).id !== medicineId) throw new MedicineCabinetRepositoryError();
      return true;
    } catch { throw new MedicineCabinetRepositoryError(); }
  },
  async familyOwned(client, userId, familyId) {
    try {
      const { data, error } = await client.from("family_members").select("id").eq("id", familyId).eq("user_id", userId).maybeSingle<{ id: string }>();
      if (error) throw new MedicineCabinetRepositoryError();
      return data?.id === familyId;
    } catch { throw new MedicineCabinetRepositoryError(); }
  },
  async createOwned(client, userId, input) {
    try {
      const { data, error } = await client.from("medicine_cabinet")
        .insert({ ...input, user_id: userId } as never).select(MEDICINE_CABINET_FIELDS).single<MedicineCabinetRow>();
      if (error || !data) throw new MedicineCabinetRepositoryError();
      return data;
    } catch { throw new MedicineCabinetRepositoryError(); }
  },
  async deleteOwned(client, userId, entryId) {
    try {
      const { data, error } = await client.from("medicine_cabinet")
        .delete().eq("id", entryId).eq("user_id", userId)
        .select("id").maybeSingle<{ id: string }>();
      if (error) throw new MedicineCabinetRepositoryError();
      return data?.id === entryId;
    } catch {
      throw new MedicineCabinetRepositoryError();
    }
  },
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
