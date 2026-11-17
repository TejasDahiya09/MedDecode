export type ReminderRecurrence =
  | "daily"
  | "twice_daily"
  | "thrice_daily"
  | "weekly"
  | "as_needed"
  | "once"
  | "custom";

export type ReminderStatus = "active" | "paused" | "completed";

export type DoseStatus = "taken" | "skipped";

export interface MedicationReminderRow {
  readonly id: string;
  readonly user_id: string;
  readonly medicine_id: string | null;
  readonly medicine_name: string;
  readonly dosage: string | null;
  readonly scheduled_time: string; // "HH:MM"
  readonly scheduled_times?: readonly string[] | null | undefined;
  readonly scheduled_date: string | null; // "YYYY-MM-DD"
  readonly start_date?: string | null | undefined;
  readonly end_date?: string | null | undefined;
  readonly recurrence: ReminderRecurrence;
  readonly status: ReminderStatus;
  readonly notes: string | null;
  readonly last_taken_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface DoseLogRow {
  readonly id: string;
  readonly reminder_id: string;
  readonly user_id: string;
  readonly dose_time: string;
  readonly status: DoseStatus;
  readonly notes: string | null;
  readonly logged_at: string;
  readonly medicine_name?: string | undefined;
}

export interface CreateReminderInput {
  readonly medicine_name: string;
  readonly medicine_id?: string | null | undefined;
  readonly dosage?: string | null | undefined;
  readonly scheduled_time: string;
  readonly scheduled_times?: readonly string[] | null | undefined;
  readonly scheduled_date?: string | null | undefined;
  readonly start_date?: string | null | undefined;
  readonly end_date?: string | null | undefined;
  readonly recurrence?: ReminderRecurrence | undefined;
  readonly notes?: string | null | undefined;
}

export interface UpdateReminderInput {
  readonly medicine_name?: string | undefined;
  readonly medicine_id?: string | null | undefined;
  readonly dosage?: string | null | undefined;
  readonly scheduled_time?: string | undefined;
  readonly scheduled_times?: readonly string[] | null | undefined;
  readonly scheduled_date?: string | null | undefined;
  readonly start_date?: string | null | undefined;
  readonly end_date?: string | null | undefined;
  readonly recurrence?: ReminderRecurrence | undefined;
  readonly status?: ReminderStatus | undefined;
  readonly notes?: string | null | undefined;
}

export interface LogDoseInput {
  readonly dose_time?: string | undefined;
  readonly status: DoseStatus;
  readonly notes?: string | null | undefined;
}

export interface MedicationReminderItem {
  readonly id: string;
  readonly medicine_id: string | null;
  readonly medicine_name: string;
  readonly dosage: string | null;
  readonly scheduled_time: string;
  readonly scheduled_times?: readonly string[] | null | undefined;
  readonly scheduled_date: string | null;
  readonly start_date?: string | null | undefined;
  readonly end_date?: string | null | undefined;
  readonly recurrence: ReminderRecurrence;
  readonly status: ReminderStatus;
  readonly notes: string | null;
  readonly last_taken_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface RemindersResponse {
  readonly items: readonly MedicationReminderItem[];
  readonly total: number;
}
