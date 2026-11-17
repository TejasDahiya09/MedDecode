import { ApiError, requestAuthenticatedJson } from '../../services/api-client';

export type ReminderRecurrence =
  | 'daily'
  | 'twice_daily'
  | 'thrice_daily'
  | 'weekly'
  | 'as_needed'
  | 'once'
  | 'custom';

export type ReminderStatus = 'active' | 'paused' | 'completed';

export type DoseStatus = 'taken' | 'skipped';

export interface DoseLog {
  readonly id: string;
  readonly reminder_id: string;
  readonly user_id?: string;
  readonly dose_time: string;
  readonly status: DoseStatus;
  readonly notes: string | null;
  readonly logged_at: string;
  readonly medicine_name?: string;
}

export interface MedicationReminder {
  readonly id: string;
  readonly user_id?: string;
  readonly medicine_id: string | null;
  readonly medicine_name: string;
  readonly dosage: string | null;
  readonly scheduled_time: string; // "HH:MM" e.g. "09:00"
  readonly scheduled_times?: readonly string[] | null;
  readonly scheduled_date: string | null; // "YYYY-MM-DD" e.g. "2026-11-14"
  readonly start_date?: string | null;
  readonly end_date?: string | null;
  readonly recurrence: ReminderRecurrence;
  readonly status: ReminderStatus;
  readonly notes: string | null;
  readonly last_taken_at?: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface CreateReminderPayload {
  readonly medicine_name: string;
  readonly medicine_id?: string | null;
  readonly dosage?: string | null;
  readonly scheduled_time: string;
  readonly scheduled_times?: readonly string[];
  readonly scheduled_date?: string | null;
  readonly start_date?: string | null;
  readonly end_date?: string | null;
  readonly recurrence?: ReminderRecurrence;
  readonly notes?: string | null;
}

export interface UpdateReminderPayload {
  readonly medicine_name?: string;
  readonly medicine_id?: string | null;
  readonly dosage?: string | null;
  readonly scheduled_time?: string;
  readonly scheduled_times?: readonly string[] | null;
  readonly scheduled_date?: string | null;
  readonly start_date?: string | null;
  readonly end_date?: string | null;
  readonly recurrence?: ReminderRecurrence;
  readonly status?: ReminderStatus;
  readonly notes?: string | null;
}

export interface RemindersResponse {
  readonly items: readonly MedicationReminder[];
  readonly total: number;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseRecurrence(value: unknown): ReminderRecurrence {
  if (
    value === 'daily' ||
    value === 'twice_daily' ||
    value === 'thrice_daily' ||
    value === 'weekly' ||
    value === 'as_needed' ||
    value === 'once' ||
    value === 'custom'
  ) {
    return value;
  }
  return 'daily';
}

function parseStatus(value: unknown): ReminderStatus {
  if (value === 'active' || value === 'paused' || value === 'completed') {
    return value;
  }
  return 'active';
}

export function parseReminder(value: unknown): MedicationReminder | null {
  if (!isObject(value)) return null;
  if (typeof value.id !== 'string' || !UUID_PATTERN.test(value.id)) return null;
  if (typeof value.medicine_name !== 'string' || !value.medicine_name.trim()) return null;
  if (typeof value.scheduled_time !== 'string' || !TIME_PATTERN.test(value.scheduled_time)) return null;

  const medicineId = typeof value.medicine_id === 'string' && UUID_PATTERN.test(value.medicine_id)
    ? value.medicine_id
    : null;

  let scheduledTimes: readonly string[] | null = null;
  if (Array.isArray(value.scheduled_times)) {
    scheduledTimes = value.scheduled_times.filter((t): t is string => typeof t === 'string' && TIME_PATTERN.test(t));
  }

  return {
    id: value.id,
    user_id: typeof value.user_id === 'string' ? value.user_id : undefined,
    medicine_id: medicineId,
    medicine_name: value.medicine_name.trim(),
    dosage: typeof value.dosage === 'string' && value.dosage.trim() ? value.dosage.trim() : null,
    scheduled_time: value.scheduled_time.slice(0, 5), // normalize to HH:MM
    scheduled_times: scheduledTimes,
    scheduled_date: typeof value.scheduled_date === 'string' ? value.scheduled_date : null,
    start_date: typeof value.start_date === 'string' ? value.start_date : null,
    end_date: typeof value.end_date === 'string' ? value.end_date : null,
    recurrence: parseRecurrence(value.recurrence),
    status: parseStatus(value.status),
    notes: typeof value.notes === 'string' && value.notes.trim() ? value.notes.trim() : null,
    last_taken_at: typeof value.last_taken_at === 'string' ? value.last_taken_at : null,
    created_at: typeof value.created_at === 'string' ? value.created_at : new Date().toISOString(),
    updated_at: typeof value.updated_at === 'string' ? value.updated_at : new Date().toISOString(),
  };
}

export function parseDoseLog(value: unknown): DoseLog | null {
  if (!isObject(value)) return null;
  if (typeof value.id !== 'string' || !UUID_PATTERN.test(value.id)) return null;
  if (typeof value.reminder_id !== 'string' || !UUID_PATTERN.test(value.reminder_id)) return null;
  if (value.status !== 'taken' && value.status !== 'skipped') return null;

  return {
    id: value.id,
    reminder_id: value.reminder_id,
    user_id: typeof value.user_id === 'string' ? value.user_id : undefined,
    dose_time: typeof value.dose_time === 'string' ? value.dose_time : new Date().toISOString(),
    status: value.status,
    notes: typeof value.notes === 'string' && value.notes.trim() ? value.notes.trim() : null,
    logged_at: typeof value.logged_at === 'string' ? value.logged_at : new Date().toISOString(),
    medicine_name: typeof value.medicine_name === 'string' ? value.medicine_name : undefined,
  };
}

export function parseRemindersResponse(value: unknown): RemindersResponse | null {
  if (value === null || typeof value !== 'object') return null;

  // Accept direct array or { items: [...] } or { reminders: [...] }
  const rawList = Array.isArray(value)
    ? value
    : Array.isArray((value as Record<string, unknown>).items)
    ? (value as Record<string, unknown>).items as unknown[]
    : Array.isArray((value as Record<string, unknown>).reminders)
    ? (value as Record<string, unknown>).reminders as unknown[]
    : null;

  if (!rawList) return null;

  const items: MedicationReminder[] = [];
  for (const entry of rawList) {
    const parsed = parseReminder(entry);
    if (parsed) items.push(parsed);
  }

  const total = !Array.isArray(value) && typeof (value as Record<string, unknown>).total === 'number' && Number.isSafeInteger((value as Record<string, unknown>).total)
    ? ((value as Record<string, unknown>).total as number)
    : items.length;

  return { items, total };
}

export async function fetchReminders(accessToken: string): Promise<RemindersResponse> {
  const data = await requestAuthenticatedJson<unknown>('/api/v1/reminders', accessToken);
  const parsed = parseRemindersResponse(data);
  if (!parsed) {
    throw new ApiError('The medication reminders service returned an unexpected response structure.', 502, 'response');
  }
  return parsed;
}

export async function createReminder(
  payload: CreateReminderPayload,
  accessToken: string,
): Promise<MedicationReminder> {
  const data = await requestAuthenticatedJson<{ reminder?: unknown; item?: unknown }>(
    '/api/v1/reminders',
    accessToken,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );

  const raw = isObject(data) ? (data.reminder ?? data.item ?? data) : data;
  const parsed = parseReminder(raw);
  if (!parsed) {
    throw new ApiError('The reminder could not be verified after creation.', 502, 'response');
  }
  return parsed;
}

export async function updateReminder(
  id: string,
  payload: UpdateReminderPayload,
  accessToken: string,
): Promise<MedicationReminder> {
  if (!UUID_PATTERN.test(id)) {
    throw new ApiError('A valid reminder UUID is required.', 400, 'http');
  }

  const data = await requestAuthenticatedJson<{ reminder?: unknown; item?: unknown }>(
    `/api/v1/reminders/${id}`,
    accessToken,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );

  const raw = isObject(data) ? (data.reminder ?? data.item ?? data) : data;
  const parsed = parseReminder(raw);
  if (!parsed) {
    throw new ApiError('The updated reminder could not be verified.', 502, 'response');
  }
  return parsed;
}

export async function deleteReminder(id: string, accessToken: string): Promise<void> {
  if (!UUID_PATTERN.test(id)) {
    throw new ApiError('A valid reminder UUID is required.', 400, 'http');
  }

  await requestAuthenticatedJson<unknown>(`/api/v1/reminders/${id}`, accessToken, {
    method: 'DELETE',
  });
}

export async function logDose(
  reminderId: string,
  payload: { status: DoseStatus; dose_time?: string; notes?: string | null },
  accessToken: string,
): Promise<{ dose: DoseLog; reminder: MedicationReminder }> {
  if (!UUID_PATTERN.test(reminderId)) {
    throw new ApiError('A valid reminder UUID is required.', 400, 'http');
  }

  const data = await requestAuthenticatedJson<{ dose?: unknown; reminder?: unknown }>(
    `/api/v1/reminders/${reminderId}/doses`,
    accessToken,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );

  if (!isObject(data) || !data.dose || !data.reminder) {
    throw new ApiError('Unexpected response from dose tracking endpoint.', 502, 'response');
  }

  const parsedDose = parseDoseLog(data.dose);
  const parsedReminder = parseReminder(data.reminder);

  if (!parsedDose || !parsedReminder) {
    throw new ApiError('Failed to parse dose log verification response.', 502, 'response');
  }

  return { dose: parsedDose, reminder: parsedReminder };
}

export async function fetchRecentDoseLogs(
  accessToken: string,
  limit = 20,
): Promise<readonly DoseLog[]> {
  const data = await requestAuthenticatedJson<{ items?: unknown[] } | unknown[]>(
    `/api/v1/reminders/doses/recent?limit=${limit}`,
    accessToken,
  );

  const rawList = Array.isArray(data)
    ? data
    : isObject(data) && Array.isArray(data.items)
    ? data.items
    : [];

  const logs: DoseLog[] = [];
  for (const item of rawList) {
    const parsed = parseDoseLog(item);
    if (parsed) logs.push(parsed);
  }
  return logs;
}
