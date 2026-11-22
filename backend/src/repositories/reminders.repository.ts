import { randomUUID } from "node:crypto";
import type { UserSupabaseClient } from "../config/supabase-user.js";
import type {
  CreateReminderInput,
  DoseLogRow,
  LogDoseInput,
  MedicationReminderRow,
  UpdateReminderInput,
} from "../types/reminders.js";

export interface RemindersRepository {
  list(client: UserSupabaseClient | null, userId: string): Promise<readonly MedicationReminderRow[]>;
  findById(client: UserSupabaseClient | null, userId: string, reminderId: string): Promise<MedicationReminderRow | null>;
  create(client: UserSupabaseClient | null, userId: string, input: CreateReminderInput): Promise<MedicationReminderRow>;
  update(client: UserSupabaseClient | null, userId: string, reminderId: string, input: UpdateReminderInput): Promise<MedicationReminderRow | null>;
  delete(client: UserSupabaseClient | null, userId: string, reminderId: string): Promise<boolean>;
  logDose(client: UserSupabaseClient | null, userId: string, reminderId: string, input: LogDoseInput): Promise<{ dose: DoseLogRow; reminder: MedicationReminderRow }>;
  listRecentDoses(client: UserSupabaseClient | null, userId: string, limit?: number): Promise<readonly DoseLogRow[]>;
}

export class RemindersRepositoryError extends Error {
  constructor(message = "Medication reminders storage query failed.") {
    super(message);
    this.name = "RemindersRepositoryError";
  }
}

export class ReminderNotFoundError extends Error {
  constructor() {
    super("Reminder not found.");
    this.name = "ReminderNotFoundError";
  }
}

/**
 * Thrown when the medication reminders database tables have not been deployed.
 * Translates to an honest, actionable HTTP 503 Service Unavailable state.
 */
export class RemindersStorageUnavailableError extends Error {
  readonly code = "REMINDERS_STORAGE_NOT_DEPLOYED";
  constructor(message = "Medication reminders storage is unavailable because database migrations (202611160001_medication_reminders_v1) are pending deployment.") {
    super(message);
    this.name = "RemindersStorageUnavailableError";
  }
}

function isTableMissingError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown };
  const str = `${String(e.code ?? "")} ${String(e.message ?? "")} ${String(e.details ?? "")} ${String(e.hint ?? "")}`.toLowerCase();
  return (
    e.code === "PGRST200" ||
    e.code === "PGRST205" ||
    e.code === "42P01" ||
    str.includes("schema cache") ||
    str.includes("does not exist") ||
    str.includes("relation") ||
    str.includes("medication_reminders")
  );
}

/**
 * Supabase PostgREST Reminders Repository.
 * Production & normal-runtime repository.
 * Strictly durable: NEVER silently falls back to in-memory storage.
 * If tables are absent in Supabase, throws RemindersStorageUnavailableError.
 */
export class SupabaseRemindersRepository implements RemindersRepository {
  private ensureClient(client: UserSupabaseClient | null): UserSupabaseClient {
    if (!client) {
      throw new RemindersStorageUnavailableError("Authenticated database client is not configured for medication reminders.");
    }
    return client;
  }

  async list(client: UserSupabaseClient | null, userId: string): Promise<readonly MedicationReminderRow[]> {
    const supabase = this.ensureClient(client);
    try {
      const db = supabase as unknown as { from(t: string): any };
      const response = await db
        .from("medication_reminders")
        .select("*")
        .eq("user_id", userId)
        .order("scheduled_time", { ascending: true });

      if (response.error) {
        if (isTableMissingError(response.error)) {
          throw new RemindersStorageUnavailableError();
        }
        throw new RemindersRepositoryError(response.error.message || "Failed to list reminders.");
      }
      return (response.data as MedicationReminderRow[]) ?? [];
    } catch (err: unknown) {
      if (err instanceof RemindersStorageUnavailableError) throw err;
      if (isTableMissingError(err)) throw new RemindersStorageUnavailableError();
      throw new RemindersRepositoryError(err instanceof Error ? err.message : "Failed to list reminders.");
    }
  }

  async findById(client: UserSupabaseClient | null, userId: string, reminderId: string): Promise<MedicationReminderRow | null> {
    const supabase = this.ensureClient(client);
    try {
      const db = supabase as unknown as { from(t: string): any };
      const response = await db
        .from("medication_reminders")
        .select("*")
        .eq("id", reminderId)
        .eq("user_id", userId)
        .maybeSingle();

      if (response.error) {
        if (isTableMissingError(response.error)) {
          throw new RemindersStorageUnavailableError();
        }
        throw new RemindersRepositoryError(response.error.message || "Failed to find reminder.");
      }
      return (response.data as MedicationReminderRow) ?? null;
    } catch (err: unknown) {
      if (err instanceof RemindersStorageUnavailableError) throw err;
      if (isTableMissingError(err)) throw new RemindersStorageUnavailableError();
      throw new RemindersRepositoryError(err instanceof Error ? err.message : "Failed to find reminder.");
    }
  }

  async create(client: UserSupabaseClient | null, userId: string, input: CreateReminderInput): Promise<MedicationReminderRow> {
    const supabase = this.ensureClient(client);
    try {
      const now = new Date().toISOString();
      const insertPayload = {
        user_id: userId,
        medicine_id: input.medicine_id ?? null,
        medicine_name: input.medicine_name.trim(),
        dosage: input.dosage?.trim() || null,
        scheduled_time: input.scheduled_time.slice(0, 5),
        scheduled_times: input.scheduled_times ? Array.from(input.scheduled_times) : null,
        scheduled_date: input.scheduled_date || null,
        start_date: input.start_date || null,
        end_date: input.end_date || null,
        recurrence: input.recurrence ?? "daily",
        status: "active",
        notes: input.notes?.trim() || null,
        created_at: now,
        updated_at: now,
      };

      const db = supabase as unknown as { from(t: string): any };
      const response = await db
        .from("medication_reminders")
        .insert(insertPayload)
        .select("*")
        .single();

      if (response.error || !response.data) {
        if (isTableMissingError(response?.error)) {
          throw new RemindersStorageUnavailableError();
        }
        throw new RemindersRepositoryError(response?.error?.message || "Failed to create reminder.");
      }
      return response.data as MedicationReminderRow;
    } catch (err: unknown) {
      if (err instanceof RemindersStorageUnavailableError) throw err;
      if (isTableMissingError(err)) throw new RemindersStorageUnavailableError();
      throw new RemindersRepositoryError(err instanceof Error ? err.message : "Failed to create reminder.");
    }
  }

  async update(client: UserSupabaseClient | null, userId: string, reminderId: string, input: UpdateReminderInput): Promise<MedicationReminderRow | null> {
    const supabase = this.ensureClient(client);
    try {
      const now = new Date().toISOString();
      const updatePayload: Record<string, unknown> = { updated_at: now };
      if (input.medicine_name !== undefined) updatePayload.medicine_name = input.medicine_name.trim();
      if (input.medicine_id !== undefined) updatePayload.medicine_id = input.medicine_id;
      if (input.dosage !== undefined) updatePayload.dosage = input.dosage?.trim() || null;
      if (input.scheduled_time !== undefined) updatePayload.scheduled_time = input.scheduled_time.slice(0, 5);
      if (input.scheduled_times !== undefined) updatePayload.scheduled_times = input.scheduled_times ? Array.from(input.scheduled_times) : null;
      if (input.scheduled_date !== undefined) updatePayload.scheduled_date = input.scheduled_date;
      if (input.start_date !== undefined) updatePayload.start_date = input.start_date;
      if (input.end_date !== undefined) updatePayload.end_date = input.end_date;
      if (input.recurrence !== undefined) updatePayload.recurrence = input.recurrence;
      if (input.status !== undefined) updatePayload.status = input.status;
      if (input.notes !== undefined) updatePayload.notes = input.notes?.trim() || null;

      const db = supabase as unknown as { from(t: string): any };
      const response = await db
        .from("medication_reminders")
        .update(updatePayload)
        .eq("id", reminderId)
        .eq("user_id", userId)
        .select("*")
        .maybeSingle();

      if (response.error) {
        if (isTableMissingError(response.error)) {
          throw new RemindersStorageUnavailableError();
        }
        throw new RemindersRepositoryError(response.error.message || "Failed to update reminder.");
      }
      return (response.data as MedicationReminderRow) ?? null;
    } catch (err: unknown) {
      if (err instanceof RemindersStorageUnavailableError) throw err;
      if (isTableMissingError(err)) throw new RemindersStorageUnavailableError();
      throw new RemindersRepositoryError(err instanceof Error ? err.message : "Failed to update reminder.");
    }
  }

  async delete(client: UserSupabaseClient | null, userId: string, reminderId: string): Promise<boolean> {
    const supabase = this.ensureClient(client);
    try {
      const db = supabase as unknown as { from(t: string): any };
      const response = await db
        .from("medication_reminders")
        .delete({ count: "exact" })
        .eq("id", reminderId)
        .eq("user_id", userId);

      if (response.error) {
        if (isTableMissingError(response.error)) {
          throw new RemindersStorageUnavailableError();
        }
        throw new RemindersRepositoryError(response.error.message || "Failed to delete reminder.");
      }
      return (response.count ?? 0) > 0;
    } catch (err: unknown) {
      if (err instanceof RemindersStorageUnavailableError) throw err;
      if (isTableMissingError(err)) throw new RemindersStorageUnavailableError();
      throw new RemindersRepositoryError(err instanceof Error ? err.message : "Failed to delete reminder.");
    }
  }

  async logDose(
    client: UserSupabaseClient | null,
    userId: string,
    reminderId: string,
    input: LogDoseInput
  ): Promise<{ dose: DoseLogRow; reminder: MedicationReminderRow }> {
    const supabase = this.ensureClient(client);
    try {
      const reminder = await this.findById(client, userId, reminderId);
      if (!reminder) {
        throw new ReminderNotFoundError();
      }

      const now = new Date().toISOString();
      const doseTime = input.dose_time || now;
      const db = supabase as unknown as { from(t: string): any };

      // Check existing dose record for idempotency
      const existing = await db
        .from("medication_dose_logs")
        .select("*")
        .eq("reminder_id", reminderId)
        .eq("dose_time", doseTime)
        .maybeSingle();

      let doseRow: DoseLogRow;
      if (existing.data) {
        doseRow = existing.data as DoseLogRow;
      } else {
        const insertDose = {
          reminder_id: reminderId,
          user_id: userId,
          dose_time: doseTime,
          status: input.status,
          notes: input.notes?.trim() || null,
          logged_at: now,
        };
        const insertRes = await db
          .from("medication_dose_logs")
          .insert(insertDose)
          .select("*")
          .single();

        if (insertRes.error) {
          if (isTableMissingError(insertRes.error)) throw new RemindersStorageUnavailableError();
          throw new RemindersRepositoryError(insertRes.error.message);
        }
        doseRow = insertRes.data as DoseLogRow;
      }

      let updatedReminder = reminder;
      if (input.status === "taken") {
        const updateRes = await db
          .from("medication_reminders")
          .update({ last_taken_at: now, updated_at: now })
          .eq("id", reminderId)
          .eq("user_id", userId)
          .select("*")
          .single();

        if (updateRes.data) {
          updatedReminder = updateRes.data as MedicationReminderRow;
        }
      }

      return {
        dose: { ...doseRow, medicine_name: reminder.medicine_name },
        reminder: updatedReminder,
      };
    } catch (err: unknown) {
      if (err instanceof RemindersStorageUnavailableError) throw err;
      if (isTableMissingError(err)) throw new RemindersStorageUnavailableError();
      throw new RemindersRepositoryError(err instanceof Error ? err.message : "Failed to log dose.");
    }
  }

  async listRecentDoses(client: UserSupabaseClient | null, userId: string, limit = 20): Promise<readonly DoseLogRow[]> {
    const supabase = this.ensureClient(client);
    try {
      const db = supabase as unknown as { from(t: string): any };
      const response = await db
        .from("medication_dose_logs")
        .select("*, medication_reminders(medicine_name)")
        .eq("user_id", userId)
        .order("logged_at", { ascending: false })
        .limit(Math.min(limit, 50));

      if (response.error) {
        if (isTableMissingError(response.error)) throw new RemindersStorageUnavailableError();
        throw new RemindersRepositoryError(response.error.message);
      }
      return (response.data as Array<DoseLogRow & { medication_reminders?: { medicine_name?: string } }>).map((d) => ({
        id: d.id,
        reminder_id: d.reminder_id,
        user_id: d.user_id,
        dose_time: d.dose_time,
        status: d.status,
        notes: d.notes,
        logged_at: d.logged_at,
        medicine_name: d.medication_reminders?.medicine_name,
      }));
    } catch (err: unknown) {
      if (err instanceof RemindersStorageUnavailableError) throw err;
      if (isTableMissingError(err)) throw new RemindersStorageUnavailableError();
      throw new RemindersRepositoryError(err instanceof Error ? err.message : "Failed to list recent doses.");
    }
  }
}

/**
 * In-memory reminders store for explicit unit tests and test fixtures only.
 * NEVER used as automatic normal-runtime persistence.
 */
export class InMemoryRemindersRepository implements RemindersRepository {
  private readonly remindersByUser = new Map<string, Map<string, MedicationReminderRow>>();
  private readonly doseLogsByUser = new Map<string, DoseLogRow[]>();

  private getRemindersMap(userId: string): Map<string, MedicationReminderRow> {
    let userMap = this.remindersByUser.get(userId);
    if (!userMap) {
      userMap = new Map();
      this.remindersByUser.set(userId, userMap);
    }
    return userMap;
  }

  private getDoseLogs(userId: string): DoseLogRow[] {
    let logs = this.doseLogsByUser.get(userId);
    if (!logs) {
      logs = [];
      this.doseLogsByUser.set(userId, logs);
    }
    return logs;
  }

  async list(_client: UserSupabaseClient | null, userId: string): Promise<readonly MedicationReminderRow[]> {
    const userMap = this.getRemindersMap(userId);
    const list = Array.from(userMap.values());
    return list.sort((a, b) => a.scheduled_time.localeCompare(b.scheduled_time));
  }

  async findById(_client: UserSupabaseClient | null, userId: string, reminderId: string): Promise<MedicationReminderRow | null> {
    const userMap = this.getRemindersMap(userId);
    return userMap.get(reminderId) ?? null;
  }

  async create(_client: UserSupabaseClient | null, userId: string, input: CreateReminderInput): Promise<MedicationReminderRow> {
    const userMap = this.getRemindersMap(userId);
    const id = randomUUID();
    const now = new Date().toISOString();

    const row: MedicationReminderRow = {
      id,
      user_id: userId,
      medicine_id: input.medicine_id ?? null,
      medicine_name: input.medicine_name.trim(),
      dosage: input.dosage?.trim() || null,
      scheduled_time: input.scheduled_time.slice(0, 5),
      scheduled_times: input.scheduled_times ? Array.from(input.scheduled_times) : null,
      scheduled_date: input.scheduled_date || null,
      start_date: input.start_date || null,
      end_date: input.end_date || null,
      recurrence: input.recurrence ?? "daily",
      status: "active",
      notes: input.notes?.trim() || null,
      last_taken_at: null,
      created_at: now,
      updated_at: now,
    };

    userMap.set(id, row);
    return row;
  }

  async update(_client: UserSupabaseClient | null, userId: string, reminderId: string, input: UpdateReminderInput): Promise<MedicationReminderRow | null> {
    const userMap = this.getRemindersMap(userId);
    const existing = userMap.get(reminderId);
    if (!existing) return null;

    const now = new Date().toISOString();
    const updated: MedicationReminderRow = {
      ...existing,
      medicine_name: input.medicine_name !== undefined ? input.medicine_name.trim() : existing.medicine_name,
      medicine_id: input.medicine_id !== undefined ? input.medicine_id : existing.medicine_id,
      dosage: input.dosage !== undefined ? (input.dosage?.trim() || null) : existing.dosage,
      scheduled_time: input.scheduled_time !== undefined ? input.scheduled_time.slice(0, 5) : existing.scheduled_time,
      scheduled_times: input.scheduled_times !== undefined ? (input.scheduled_times ? Array.from(input.scheduled_times) : null) : existing.scheduled_times,
      scheduled_date: input.scheduled_date !== undefined ? input.scheduled_date : existing.scheduled_date,
      start_date: input.start_date !== undefined ? input.start_date : existing.start_date,
      end_date: input.end_date !== undefined ? input.end_date : existing.end_date,
      recurrence: input.recurrence !== undefined ? input.recurrence : existing.recurrence,
      status: input.status !== undefined ? input.status : existing.status,
      notes: input.notes !== undefined ? (input.notes?.trim() || null) : existing.notes,
      updated_at: now,
    };

    userMap.set(reminderId, updated);
    return updated;
  }

  async delete(_client: UserSupabaseClient | null, userId: string, reminderId: string): Promise<boolean> {
    const userMap = this.getRemindersMap(userId);
    return userMap.delete(reminderId);
  }

  async logDose(
    _client: UserSupabaseClient | null,
    userId: string,
    reminderId: string,
    input: LogDoseInput
  ): Promise<{ dose: DoseLogRow; reminder: MedicationReminderRow }> {
    const userMap = this.getRemindersMap(userId);
    const reminder = userMap.get(reminderId);
    if (!reminder) {
      throw new RemindersRepositoryError("Reminder not found.");
    }

    const logs = this.getDoseLogs(userId);
    const now = new Date().toISOString();
    const doseTime = input.dose_time || now;

    const existing = logs.find(
      (l) => l.reminder_id === reminderId && (l.dose_time === doseTime || Math.abs(new Date(l.dose_time).getTime() - new Date(doseTime).getTime()) < 60000)
    );

    let doseRow: DoseLogRow;
    if (existing) {
      doseRow = existing;
    } else {
      doseRow = {
        id: randomUUID(),
        reminder_id: reminderId,
        user_id: userId,
        dose_time: doseTime,
        status: input.status,
        notes: input.notes?.trim() || null,
        logged_at: now,
        medicine_name: reminder.medicine_name,
      };
      logs.unshift(doseRow);
    }

    let updatedReminder = reminder;
    if (input.status === "taken") {
      updatedReminder = {
        ...reminder,
        last_taken_at: now,
        updated_at: now,
      };
      userMap.set(reminderId, updatedReminder);
    }

    return { dose: doseRow, reminder: updatedReminder };
  }

  async listRecentDoses(_client: UserSupabaseClient | null, userId: string, limit = 20): Promise<readonly DoseLogRow[]> {
    const logs = this.getDoseLogs(userId);
    return logs.slice(0, Math.min(limit, 100));
  }
}

/**
 * Production default: Supabase PostgREST repository.
 * Fails closed if tables are absent in Supabase. Never silently falls back to in-memory store.
 */
export const defaultRemindersRepository: RemindersRepository = new SupabaseRemindersRepository();
