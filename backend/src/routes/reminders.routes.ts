import { Router, type Request, type Response } from "express";
import type { UserSupabaseClientFactory, UserSupabaseClient } from "../config/supabase-user.js";
import {
  createAuthenticateMiddleware,
  requireAuthenticatedIdentity,
} from "../middleware/authenticate.middleware.js";
import { AppError } from "../middleware/error.middleware.js";
import type { AuthVerifier } from "../services/auth.service.js";
import type {
  CreateReminderInput,
  DoseStatus,
  ReminderRecurrence,
  ReminderStatus,
  UpdateReminderInput,
} from "../types/reminders.js";
import {
  defaultRemindersRepository,
  RemindersRepositoryError,
  RemindersStorageUnavailableError,
  type RemindersRepository,
} from "../repositories/reminders.repository.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const VALID_RECURRENCES = new Set<ReminderRecurrence>([
  "daily",
  "twice_daily",
  "thrice_daily",
  "weekly",
  "as_needed",
  "once",
  "custom",
]);
const VALID_STATUSES = new Set<ReminderStatus>(["active", "paused", "completed"]);
const VALID_DOSE_STATUSES = new Set<DoseStatus>(["taken", "skipped"]);

function invalidReminderInput(message: string): AppError {
  return new AppError(400, "INVALID_REMINDER_INPUT", message);
}

function reminderNotFound(): AppError {
  return new AppError(404, "REMINDER_NOT_FOUND", "The requested medication reminder was not found.");
}

function handleStorageError(err: unknown): never {
  if (err instanceof RemindersStorageUnavailableError) {
    throw new AppError(503, err.code, err.message);
  }
  if (err instanceof RemindersRepositoryError) {
    throw new AppError(500, "REMINDERS_STORAGE_ERROR", err.message);
  }
  throw err;
}

function getUserClient(request: Request): UserSupabaseClient | null {
  return request.userSupabase ?? null;
}

export function createRemindersRouter(
  authVerifier: AuthVerifier,
  userClientFactory: UserSupabaseClientFactory,
  repository: RemindersRepository = defaultRemindersRepository
): Router {
  const router = Router();
  const authenticate = createAuthenticateMiddleware(authVerifier, userClientFactory);

  // GET /api/v1/reminders/doses/recent
  router.get("/api/v1/reminders/doses/recent", authenticate, async (req: Request, res: Response) => {
    const identity = requireAuthenticatedIdentity(req);
    const client = getUserClient(req);
    const limit = typeof req.query.limit === "string" ? Math.min(Math.max(1, parseInt(req.query.limit, 10) || 20), 50) : 20;

    try {
      const items = await repository.listRecentDoses(client, identity.userId, limit);
      return res.status(200).json({ items, total: items.length });
    } catch (err) {
      handleStorageError(err);
    }
  });

  // GET /api/v1/reminders
  router.get("/api/v1/reminders", authenticate, async (req: Request, res: Response) => {
    const identity = requireAuthenticatedIdentity(req);
    const client = getUserClient(req);

    try {
      let items = await repository.list(client, identity.userId);

      const statusFilter = req.query.status;
      if (typeof statusFilter === "string" && VALID_STATUSES.has(statusFilter as ReminderStatus)) {
        items = items.filter((item) => item.status === statusFilter);
      }

      return res.status(200).json({
        items,
        total: items.length,
      });
    } catch (err) {
      handleStorageError(err);
    }
  });

  // POST /api/v1/reminders
  router.post("/api/v1/reminders", authenticate, async (req: Request, res: Response) => {
    const identity = requireAuthenticatedIdentity(req);
    const client = getUserClient(req);

    const body = req.body;
    if (!body || typeof body !== "object") {
      throw invalidReminderInput("Request body must be a JSON object.");
    }

    const medicineName = typeof body.medicine_name === "string" ? body.medicine_name.trim() : "";
    if (!medicineName || medicineName.length > 120) {
      throw invalidReminderInput("medicine_name must be a non-empty string of at most 120 characters.");
    }

    const scheduledTime = typeof body.scheduled_time === "string" ? body.scheduled_time.trim() : "";
    if (!scheduledTime || !TIME_PATTERN.test(scheduledTime)) {
      throw invalidReminderInput("scheduled_time must be a valid 24-hour time string in HH:MM format.");
    }

    let recurrence: ReminderRecurrence = "daily";
    if (body.recurrence !== undefined) {
      if (typeof body.recurrence !== "string" || !VALID_RECURRENCES.has(body.recurrence as ReminderRecurrence)) {
        throw invalidReminderInput("recurrence must be one of: daily, twice_daily, thrice_daily, weekly, as_needed, once, custom.");
      }
      recurrence = body.recurrence as ReminderRecurrence;
    }

    let medicineId: string | null = null;
    if (body.medicine_id !== undefined && body.medicine_id !== null) {
      if (typeof body.medicine_id !== "string" || !UUID_PATTERN.test(body.medicine_id)) {
        throw invalidReminderInput("medicine_id must be a valid UUID.");
      }
      medicineId = body.medicine_id;
    }

    let dosage: string | null = null;
    if (body.dosage !== undefined && body.dosage !== null) {
      if (typeof body.dosage !== "string" || body.dosage.length > 100) {
        throw invalidReminderInput("dosage must be a string of at most 100 characters.");
      }
      dosage = body.dosage.trim() || null;
    }

    let scheduledTimes: string[] | null = null;
    if (body.scheduled_times !== undefined && body.scheduled_times !== null) {
      if (!Array.isArray(body.scheduled_times)) {
        throw invalidReminderInput("scheduled_times must be an array of time strings.");
      }
      for (const t of body.scheduled_times) {
        if (typeof t !== "string" || !TIME_PATTERN.test(t)) {
          throw invalidReminderInput("Every entry in scheduled_times must be in HH:MM format.");
        }
      }
      scheduledTimes = body.scheduled_times.map((t: string) => t.slice(0, 5));
    }

    let scheduledDate: string | null = null;
    if (body.scheduled_date !== undefined && body.scheduled_date !== null) {
      if (typeof body.scheduled_date !== "string" || !DATE_PATTERN.test(body.scheduled_date)) {
        throw invalidReminderInput("scheduled_date must be in YYYY-MM-DD format.");
      }
      scheduledDate = body.scheduled_date;
    }

    let startDate: string | null = null;
    if (body.start_date !== undefined && body.start_date !== null) {
      if (typeof body.start_date !== "string" || !DATE_PATTERN.test(body.start_date)) {
        throw invalidReminderInput("start_date must be in YYYY-MM-DD format.");
      }
      startDate = body.start_date;
    }

    let endDate: string | null = null;
    if (body.end_date !== undefined && body.end_date !== null) {
      if (typeof body.end_date !== "string" || !DATE_PATTERN.test(body.end_date)) {
        throw invalidReminderInput("end_date must be in YYYY-MM-DD format.");
      }
      endDate = body.end_date;
    }

    let notes: string | null = null;
    if (body.notes !== undefined && body.notes !== null) {
      if (typeof body.notes !== "string" || body.notes.length > 250) {
        throw invalidReminderInput("notes must be a string of at most 250 characters.");
      }
      notes = body.notes.trim() || null;
    }

    const input: CreateReminderInput = {
      medicine_name: medicineName,
      medicine_id: medicineId,
      dosage,
      scheduled_time: scheduledTime.slice(0, 5),
      scheduled_times: scheduledTimes,
      scheduled_date: scheduledDate,
      start_date: startDate,
      end_date: endDate,
      recurrence,
      notes,
    };

    try {
      const reminder = await repository.create(client, identity.userId, input);
      return res.status(201).json({ reminder });
    } catch (err) {
      handleStorageError(err);
    }
  });

  // GET /api/v1/reminders/:id
  router.get("/api/v1/reminders/:id", authenticate, async (req: Request, res: Response) => {
    const identity = requireAuthenticatedIdentity(req);
    const client = getUserClient(req);
    const id = String(req.params.id ?? "");

    if (!id || !UUID_PATTERN.test(id)) {
      throw invalidReminderInput("Reminder id must be a valid UUID.");
    }

    try {
      const reminder = await repository.findById(client, identity.userId, id);
      if (!reminder) {
        throw reminderNotFound();
      }
      return res.status(200).json({ reminder });
    } catch (err) {
      handleStorageError(err);
    }
  });

  // PATCH /api/v1/reminders/:id
  router.patch("/api/v1/reminders/:id", authenticate, async (req: Request, res: Response) => {
    const identity = requireAuthenticatedIdentity(req);
    const client = getUserClient(req);
    const id = String(req.params.id ?? "");

    if (!id || !UUID_PATTERN.test(id)) {
      throw invalidReminderInput("Reminder id must be a valid UUID.");
    }

    const body = req.body;
    if (!body || typeof body !== "object") {
      throw invalidReminderInput("Request body must be a JSON object.");
    }

    const update: UpdateReminderInput = {};

    if (body.medicine_name !== undefined) {
      if (typeof body.medicine_name !== "string" || !body.medicine_name.trim() || body.medicine_name.trim().length > 120) {
        throw invalidReminderInput("medicine_name must be a non-empty string of at most 120 characters.");
      }
      (update as Record<string, unknown>).medicine_name = body.medicine_name.trim();
    }

    if (body.medicine_id !== undefined) {
      if (body.medicine_id !== null && (typeof body.medicine_id !== "string" || !UUID_PATTERN.test(body.medicine_id))) {
        throw invalidReminderInput("medicine_id must be a valid UUID or null.");
      }
      (update as Record<string, unknown>).medicine_id = body.medicine_id;
    }

    if (body.dosage !== undefined) {
      if (body.dosage !== null && (typeof body.dosage !== "string" || body.dosage.length > 100)) {
        throw invalidReminderInput("dosage must be a string of at most 100 characters or null.");
      }
      (update as Record<string, unknown>).dosage = body.dosage ? body.dosage.trim() : null;
    }

    if (body.scheduled_time !== undefined) {
      if (typeof body.scheduled_time !== "string" || !TIME_PATTERN.test(body.scheduled_time)) {
        throw invalidReminderInput("scheduled_time must be a valid 24-hour time string in HH:MM format.");
      }
      (update as Record<string, unknown>).scheduled_time = body.scheduled_time.slice(0, 5);
    }

    if (body.scheduled_times !== undefined) {
      if (body.scheduled_times !== null) {
        if (!Array.isArray(body.scheduled_times)) {
          throw invalidReminderInput("scheduled_times must be an array of time strings or null.");
        }
        for (const t of body.scheduled_times) {
          if (typeof t !== "string" || !TIME_PATTERN.test(t)) {
            throw invalidReminderInput("Every entry in scheduled_times must be in HH:MM format.");
          }
        }
        (update as Record<string, unknown>).scheduled_times = body.scheduled_times.map((t: string) => t.slice(0, 5));
      } else {
        (update as Record<string, unknown>).scheduled_times = null;
      }
    }

    if (body.scheduled_date !== undefined) {
      if (body.scheduled_date !== null && (typeof body.scheduled_date !== "string" || !DATE_PATTERN.test(body.scheduled_date))) {
        throw invalidReminderInput("scheduled_date must be in YYYY-MM-DD format or null.");
      }
      (update as Record<string, unknown>).scheduled_date = body.scheduled_date;
    }

    if (body.start_date !== undefined) {
      if (body.start_date !== null && (typeof body.start_date !== "string" || !DATE_PATTERN.test(body.start_date))) {
        throw invalidReminderInput("start_date must be in YYYY-MM-DD format or null.");
      }
      (update as Record<string, unknown>).start_date = body.start_date;
    }

    if (body.end_date !== undefined) {
      if (body.end_date !== null && (typeof body.end_date !== "string" || !DATE_PATTERN.test(body.end_date))) {
        throw invalidReminderInput("end_date must be in YYYY-MM-DD format or null.");
      }
      (update as Record<string, unknown>).end_date = body.end_date;
    }

    if (body.recurrence !== undefined) {
      if (typeof body.recurrence !== "string" || !VALID_RECURRENCES.has(body.recurrence as ReminderRecurrence)) {
        throw invalidReminderInput("recurrence must be one of: daily, twice_daily, thrice_daily, weekly, as_needed, once, custom.");
      }
      (update as Record<string, unknown>).recurrence = body.recurrence;
    }

    if (body.status !== undefined) {
      if (typeof body.status !== "string" || !VALID_STATUSES.has(body.status as ReminderStatus)) {
        throw invalidReminderInput("status must be active, paused, or completed.");
      }
      (update as Record<string, unknown>).status = body.status;
    }

    if (body.notes !== undefined) {
      if (body.notes !== null && (typeof body.notes !== "string" || body.notes.length > 250)) {
        throw invalidReminderInput("notes must be a string of at most 250 characters or null.");
      }
      (update as Record<string, unknown>).notes = body.notes ? body.notes.trim() : null;
    }

    try {
      const updated = await repository.update(client, identity.userId, id, update);
      if (!updated) {
        throw reminderNotFound();
      }
      return res.status(200).json({ reminder: updated });
    } catch (err) {
      handleStorageError(err);
    }
  });

  // DELETE /api/v1/reminders/:id
  router.delete("/api/v1/reminders/:id", authenticate, async (req: Request, res: Response) => {
    const identity = requireAuthenticatedIdentity(req);
    const client = getUserClient(req);
    const id = String(req.params.id ?? "");

    if (!id || !UUID_PATTERN.test(id)) {
      throw invalidReminderInput("Reminder id must be a valid UUID.");
    }

    try {
      const deleted = await repository.delete(client, identity.userId, id);
      if (!deleted) {
        throw reminderNotFound();
      }
      return res.status(204).end();
    } catch (err) {
      handleStorageError(err);
    }
  });

  // POST /api/v1/reminders/:id/doses
  router.post("/api/v1/reminders/:id/doses", authenticate, async (req: Request, res: Response) => {
    const identity = requireAuthenticatedIdentity(req);
    const client = getUserClient(req);
    const id = String(req.params.id ?? "");

    if (!id || !UUID_PATTERN.test(id)) {
      throw invalidReminderInput("Reminder id must be a valid UUID.");
    }

    const body = req.body;
    if (!body || typeof body !== "object") {
      throw invalidReminderInput("Request body must be a JSON object.");
    }

    const status = body.status;
    if (typeof status !== "string" || !VALID_DOSE_STATUSES.has(status as DoseStatus)) {
      throw invalidReminderInput("Dose status must be either 'taken' or 'skipped'.");
    }

    let doseTime: string | undefined;
    if (body.dose_time !== undefined && body.dose_time !== null) {
      if (typeof body.dose_time !== "string" || isNaN(Date.parse(body.dose_time))) {
        throw invalidReminderInput("dose_time must be a valid ISO date-time string.");
      }
      doseTime = body.dose_time;
    }

    let notes: string | null = null;
    if (body.notes !== undefined && body.notes !== null) {
      if (typeof body.notes !== "string" || body.notes.length > 250) {
        throw invalidReminderInput("notes must be a string of at most 250 characters.");
      }
      notes = body.notes.trim() || null;
    }

    try {
      const result = await repository.logDose(client, identity.userId, id, {
        status: status as DoseStatus,
        dose_time: doseTime,
        notes,
      });
      return res.status(200).json(result);
    } catch (err) {
      handleStorageError(err);
    }
  });

  return router;
}
