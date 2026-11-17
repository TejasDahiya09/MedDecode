-- Read-only verification scoped to the target user's uniquely marked demo rows.

BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';

WITH
target AS (
  SELECT '9a1b7896-34cd-439b-9cfd-b26411086786'::uuid AS user_id
),
demo_cabinet AS (
  SELECT mc.*
  FROM public.medicine_cabinet AS mc
  CROSS JOIN target AS t
  WHERE mc.user_id = t.user_id
    AND mc.usage_information =
      'DEMO ONLY: Synthetic inventory; not real medication history. [MEDDECODE:DEMO:964ed15f-d26a-4765-acaf-58837703afdc]'
),
demo_reminders AS (
  SELECT r.*
  FROM public.medication_reminders AS r
  CROSS JOIN target AS t
  WHERE r.user_id = t.user_id
    AND r.notes =
      'DEMO ONLY: Fictional paused schedule; not medication advice. [MEDDECODE:DEMO:964ed15f-d26a-4765-acaf-58837703afdc]'
)
SELECT
  EXISTS (
    SELECT 1
    FROM public.users AS u
    CROSS JOIN target AS t
    WHERE u.id = t.user_id
  )
    AS target_user_exists,
  (SELECT count(*) FROM demo_cabinet) AS demo_cabinet_entries,
  (SELECT count(*) FROM demo_reminders) AS demo_reminders,
  (
    SELECT count(*)
    FROM demo_cabinet AS dc
    LEFT JOIN public.medicines AS m ON m.id = dc.medicine_id
    WHERE m.id IS NULL
  ) AS missing_medicine_links,
  (
    SELECT count(*)
    FROM demo_reminders AS r
    LEFT JOIN demo_cabinet AS dc
      ON dc.id = r.medicine_id
    WHERE dc.id IS NULL OR dc.user_id <> r.user_id
  ) AS reminder_cabinet_owner_mismatches,
  (
    SELECT count(*)
    FROM demo_reminders
    WHERE medicine_id IS NULL
  ) AS reminders_without_cabinet_links,
  (
    SELECT count(*)
    FROM demo_reminders
    WHERE status <> 'paused' OR dosage IS NOT NULL
  ) AS reminders_not_in_safe_demo_state,
  (
    SELECT count(*)
    FROM public.medication_dose_logs AS dl
    JOIN demo_reminders AS r
      ON r.id = dl.reminder_id
     AND r.user_id = dl.user_id
  ) AS dose_logs_for_demo_reminders,
  (
    SELECT count(*)
    FROM (
      SELECT medicine_id
      FROM demo_cabinet
      GROUP BY medicine_id
      HAVING count(*) > 1
    ) AS duplicates
  ) AS duplicate_demo_cabinet_medicines,
  (
    SELECT count(*)
    FROM (
      SELECT medicine_id
      FROM demo_reminders
      GROUP BY medicine_id
      HAVING count(*) > 1
    ) AS duplicates
  ) AS duplicate_demo_reminder_links;

-- Selected catalogue/Cabinet details only for the target's marked demo rows.
SELECT
  mc.id AS cabinet_entry_id,
  mc.medicine_id,
  m.brand_name,
  m.generic_name,
  m.dosage_form,
  m.strength_value,
  m.strength_unit,
  m.manufacturer_id,
  mc.quantity,
  mc.purchase_date,
  mc.expiry_date,
  mc.refill_date,
  mc.usage_information
FROM public.medicine_cabinet AS mc
JOIN public.medicines AS m ON m.id = mc.medicine_id
WHERE mc.user_id = '9a1b7896-34cd-439b-9cfd-b26411086786'::uuid
  AND mc.usage_information =
    'DEMO ONLY: Synthetic inventory; not real medication history. [MEDDECODE:DEMO:964ed15f-d26a-4765-acaf-58837703afdc]'
ORDER BY lower(m.generic_name), m.id;

SELECT
  r.id AS reminder_id,
  r.medicine_id AS cabinet_entry_id,
  r.medicine_name,
  r.dosage,
  r.scheduled_time,
  r.scheduled_date,
  r.start_date,
  r.end_date,
  r.recurrence,
  r.status,
  r.notes
FROM public.medication_reminders AS r
WHERE r.user_id = '9a1b7896-34cd-439b-9cfd-b26411086786'::uuid
  AND r.notes =
    'DEMO ONLY: Fictional paused schedule; not medication advice. [MEDDECODE:DEMO:964ed15f-d26a-4765-acaf-58837703afdc]'
ORDER BY r.scheduled_time, r.id;

ROLLBACK;
