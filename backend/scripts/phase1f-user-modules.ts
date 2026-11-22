import type { Pool } from "pg";

import type { MedicineCabinetRepository } from "../src/repositories/medicine-cabinet.repository.js";
import { ReminderNotFoundError, type RemindersRepository } from "../src/repositories/reminders.repository.js";
import type { MedicineCatalogueRepository, MedicineCataloguePage } from "../src/routes/medicine-catalogue.routes.js";
import type { MedicineCabinetCreate, MedicineCabinetRow, MedicineCabinetUpdate } from "../src/types/medicine-cabinet.js";
import type { CreateReminderInput, DoseLogRow, LogDoseInput, MedicationReminderRow, UpdateReminderInput } from "../src/types/reminders.js";

const CABINET_COLUMNS = `id,user_id,medicine_id,family_member_id,quantity::text AS quantity,
  purchase_date::text,expiry_date::text,refill_date::text,usage_information,
  created_at::text AS created_at,updated_at::text AS updated_at`;
const REMINDER_COLUMNS = `id,user_id,medicine_id,medicine_name,dosage,scheduled_time,
  scheduled_times,scheduled_date::text,start_date::text,end_date::text,recurrence,status,
  notes,last_taken_at::text AS last_taken_at,created_at::text AS created_at,updated_at::text AS updated_at`;

export function createPhase1fCabinetRepository(pool: Pool): MedicineCabinetRepository {
  const repository: MedicineCabinetRepository = {
    async listOwned(_client, userId, pagination) {
      const result = await pool.query<MedicineCabinetRow>(
        `SELECT ${CABINET_COLUMNS} FROM public.medicine_cabinet
          WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3`,
        [userId, pagination.limit + 1, pagination.offset],
      );
      return result.rows;
    },
    async findOwnedDetail(_client, userId, entryId) {
      const result = await pool.query<MedicineCabinetRow>(
        `SELECT ${CABINET_COLUMNS} FROM public.medicine_cabinet WHERE id=$1 AND user_id=$2`,
        [entryId, userId],
      );
      return result.rows[0] ?? null;
    },
    async medicineExists(_client, medicineId) {
      return (await pool.query("SELECT 1 FROM public.medicines WHERE id=$1", [medicineId])).rowCount === 1;
    },
    async familyOwned(_client, userId, familyId) {
      return (await pool.query("SELECT 1 FROM public.family_members WHERE id=$1 AND user_id=$2", [familyId, userId])).rowCount === 1;
    },
    async createOwned(_client, userId, input: MedicineCabinetCreate) {
      const result = await pool.query<MedicineCabinetRow>(
        `INSERT INTO public.medicine_cabinet
          (user_id,medicine_id,family_member_id,quantity,purchase_date,expiry_date,refill_date,usage_information)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${CABINET_COLUMNS}`,
        [userId,input.medicine_id,input.family_member_id,input.quantity,input.purchase_date,input.expiry_date,input.refill_date,input.usage_information],
      );
      return result.rows[0]!;
    },
    async updateOwned(_client, userId, entryId, input: MedicineCabinetUpdate) {
      const columns: string[] = [];
      const values: unknown[] = [];
      for (const [name, value] of Object.entries(input)) {
        columns.push(`${name}=$${values.length + 1}`);
        values.push(value);
      }
      if (!columns.length) return repository.findOwnedDetail(_client, userId, entryId);
      values.push(entryId, userId);
      const result = await pool.query<MedicineCabinetRow>(
        `UPDATE public.medicine_cabinet SET ${columns.join(",")},updated_at=clock_timestamp()
          WHERE id=$${values.length - 1} AND user_id=$${values.length} RETURNING ${CABINET_COLUMNS}`,
        values,
      );
      return result.rows[0] ?? null;
    },
    async deleteOwned(_client, userId, entryId) {
      return (await pool.query("DELETE FROM public.medicine_cabinet WHERE id=$1 AND user_id=$2", [entryId,userId])).rowCount === 1;
    },
  };
  return repository;
}

function reminderValues(input: CreateReminderInput) {
  return [input.medicine_id ?? null,input.medicine_name.trim(),input.dosage?.trim() || null,
    input.scheduled_time.slice(0,5),JSON.stringify(input.scheduled_times ?? []),input.scheduled_date ?? null,
    input.start_date ?? null,input.end_date ?? null,input.recurrence ?? "daily",input.notes?.trim() || null];
}

export function createPhase1fRemindersRepository(pool: Pool): RemindersRepository {
  const repository: RemindersRepository = {
    async list(_client, userId) {
      return (await pool.query<MedicationReminderRow>(
        `SELECT ${REMINDER_COLUMNS} FROM public.medication_reminders WHERE user_id=$1 ORDER BY scheduled_time,id`,[userId])).rows;
    },
    async findById(_client, userId, reminderId) {
      return (await pool.query<MedicationReminderRow>(
        `SELECT ${REMINDER_COLUMNS} FROM public.medication_reminders WHERE id=$1 AND user_id=$2`,[reminderId,userId])).rows[0] ?? null;
    },
    async create(_client, userId, input) {
      const result = await pool.query<MedicationReminderRow>(
        `INSERT INTO public.medication_reminders
          (user_id,medicine_id,medicine_name,dosage,scheduled_time,scheduled_times,scheduled_date,start_date,end_date,recurrence,notes)
         VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11) RETURNING ${REMINDER_COLUMNS}`,
        [userId,...reminderValues(input)],
      );
      return result.rows[0]!;
    },
    async update(_client, userId, reminderId, input: UpdateReminderInput) {
      const allowed = ["medicine_name","medicine_id","dosage","scheduled_time","scheduled_times","scheduled_date","start_date","end_date","recurrence","status","notes"] as const;
      const columns: string[] = [];
      const values: unknown[] = [];
      for (const name of allowed) {
        if (input[name] === undefined) continue;
        const value = name === "scheduled_times" && input[name] !== null ? JSON.stringify(input[name]) : input[name];
        columns.push(`${name}=$${values.length + 1}${name === "scheduled_times" && value !== null ? "::jsonb" : ""}`);
        values.push(value);
      }
      if (!columns.length) return repository.findById(_client,userId,reminderId);
      values.push(reminderId,userId);
      const result = await pool.query<MedicationReminderRow>(
        `UPDATE public.medication_reminders SET ${columns.join(",")},updated_at=clock_timestamp()
          WHERE id=$${values.length - 1} AND user_id=$${values.length} RETURNING ${REMINDER_COLUMNS}`,values);
      return result.rows[0] ?? null;
    },
    async delete(_client, userId, reminderId) {
      return (await pool.query("DELETE FROM public.medication_reminders WHERE id=$1 AND user_id=$2",[reminderId,userId])).rowCount === 1;
    },
    async logDose(_client, userId, reminderId, input: LogDoseInput) {
      const connection = await pool.connect();
      try {
        await connection.query("BEGIN");
        const reminder = (await connection.query<MedicationReminderRow>(
          `SELECT ${REMINDER_COLUMNS} FROM public.medication_reminders WHERE id=$1 AND user_id=$2 FOR UPDATE`,[reminderId,userId])).rows[0];
        if (!reminder) throw new ReminderNotFoundError();
        const doseTime = input.dose_time ?? new Date().toISOString();
        let dose = (await connection.query<DoseLogRow>(
          `INSERT INTO public.medication_dose_logs(reminder_id,user_id,dose_time,status,notes)
           VALUES($1,$2,$3,$4,$5) ON CONFLICT(reminder_id,dose_time) DO NOTHING
           RETURNING id,reminder_id,user_id,dose_time::text AS dose_time,status,notes,logged_at::text AS logged_at`,
          [reminderId,userId,doseTime,input.status,input.notes?.trim() || null])).rows[0];
        dose ??= (await connection.query<DoseLogRow>(
          `SELECT id,reminder_id,user_id,dose_time::text AS dose_time,status,notes,logged_at::text AS logged_at
             FROM public.medication_dose_logs WHERE reminder_id=$1 AND user_id=$2 AND dose_time=$3`,
          [reminderId,userId,doseTime])).rows[0]!;
        let updated = reminder;
        if (input.status === "taken") updated = (await connection.query<MedicationReminderRow>(
          `UPDATE public.medication_reminders SET last_taken_at=clock_timestamp(),updated_at=clock_timestamp()
           WHERE id=$1 AND user_id=$2 RETURNING ${REMINDER_COLUMNS}`,[reminderId,userId])).rows[0]!;
        await connection.query("COMMIT");
        return { dose: { ...dose, medicine_name: reminder.medicine_name }, reminder: updated };
      } catch (error) {
        await connection.query("ROLLBACK");
        throw error;
      } finally { connection.release(); }
    },
    async listRecentDoses(_client, userId, limit=20) {
      return (await pool.query<DoseLogRow>(
        `SELECT d.id,d.reminder_id,d.user_id,d.dose_time::text AS dose_time,d.status,d.notes,
                d.logged_at::text AS logged_at,r.medicine_name FROM public.medication_dose_logs d
          JOIN public.medication_reminders r ON r.id=d.reminder_id AND r.user_id=d.user_id
         WHERE d.user_id=$1 ORDER BY d.logged_at DESC LIMIT $2`,[userId,Math.min(limit,50)])).rows;
    },
  };
  return repository;
}

type CatalogueRow = { entity_id: string; identity: Record<string, unknown>; evidence: Record<string, unknown> };
function catalogueItem(row: CatalogueRow) {
  const ingredients = Array.isArray(row.identity.ingredients) ? row.identity.ingredients : [];
  const first = ingredients[0] && typeof ingredients[0] === "object" ? ingredients[0] as Record<string, unknown> : {};
  return {
    id: row.entity_id,
    canonical_name: row.evidence.canonical_name ?? null,
    generic_name: row.evidence.generic_name ?? null,
    brand_name: row.evidence.brand_name ?? null,
    dosage_form: typeof row.identity.dosage_form === "string" ? `${row.identity.dosage_form[0]?.toUpperCase()}${row.identity.dosage_form.slice(1)}` : null,
    strength_value: first.strength_value ?? null,
    strength_unit: first.strength_unit ?? null,
    manufacturer_name: null,
    catalogue_source: "official_catalogue",
    id_namespace: "official_catalogue.formulation_id",
    ingredients,
    aliases: [],
    sources: ["synthetic_local_fixture"],
    prices: [],
  };
}
async function catalogueRows(pool: Pool): Promise<CatalogueRow[]> {
  return (await pool.query<CatalogueRow>("SELECT entity_id,identity,evidence FROM official_catalogue.catalogue_entities ORDER BY entity_id")).rows;
}
function page(rows: CatalogueRow[], limit: number, offset: number): MedicineCataloguePage {
  return { items: rows.slice(offset,offset+limit).map(catalogueItem), total: rows.length };
}
export function createPhase1fCatalogueRepository(pool: Pool): MedicineCatalogueRepository {
  const filtered = async (term: string | null, form: string | null) => (await catalogueRows(pool)).filter(row => {
    const text = JSON.stringify({ identity: row.identity, evidence: row.evidence }).toLowerCase();
    return (!term || text.includes(term.toLowerCase())) && (!form || String(row.identity.dosage_form).toLowerCase()===form.toLowerCase());
  });
  return {
    async browse(_client,limit,offset,form) { return page(await filtered(null,form),limit,offset); },
    async searchPage(_client,term,limit,offset,form) { return page(await filtered(term,form),limit,offset); },
    async search(_client,term,limit,offset) { return page(await filtered(term,null),limit,offset).items; },
    async detail(_client,id) {
      const row=(await catalogueRows(pool)).find(value=>value.entity_id===id);
      return row ? catalogueItem(row) : null;
    },
  };
}
