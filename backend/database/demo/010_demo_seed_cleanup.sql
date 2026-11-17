-- Removes only the uniquely marked demo rows for the specified user.
-- Stops rather than cascading into dose logs or detaching unrelated reminders.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';

SELECT pg_advisory_xact_lock(
  hashtextextended(
    'meddecode-demo-seed:9a1b7896-34cd-439b-9cfd-b26411086786:964ed15f-d26a-4765-acaf-58837703afdc',
    0
  )
);

DO $cleanup_guard$
DECLARE
  target_user_id CONSTANT uuid :=
    '9a1b7896-34cd-439b-9cfd-b26411086786';
  cabinet_marker CONSTANT text :=
    'DEMO ONLY: Synthetic inventory; not real medication history. [MEDDECODE:DEMO:964ed15f-d26a-4765-acaf-58837703afdc]';
  reminder_marker CONSTANT text :=
    'DEMO ONLY: Fictional paused schedule; not medication advice. [MEDDECODE:DEMO:964ed15f-d26a-4765-acaf-58837703afdc]';
BEGIN
  IF to_regclass('public.medicine_cabinet') IS NULL
     OR to_regclass('public.medication_reminders') IS NULL
     OR to_regclass('public.medication_dose_logs') IS NULL THEN
    RAISE EXCEPTION 'Required tables are missing; cleanup stopped.';
  END IF;

  PERFORM r.id
  FROM public.medication_reminders AS r
  WHERE r.user_id = target_user_id
    AND r.notes = reminder_marker
  FOR UPDATE;

  PERFORM mc.id
  FROM public.medicine_cabinet AS mc
  WHERE mc.user_id = target_user_id
    AND mc.usage_information = cabinet_marker
  FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM public.medication_dose_logs AS dl
    JOIN public.medication_reminders AS r
      ON r.id = dl.reminder_id
     AND r.user_id = dl.user_id
    WHERE r.user_id = target_user_id
      AND r.notes = reminder_marker
  ) THEN
    RAISE EXCEPTION
      'Demo reminders have dose logs; cleanup stopped to preserve those records.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.medication_reminders AS r
    JOIN public.medicine_cabinet AS mc
      ON mc.id = r.medicine_id
    WHERE mc.user_id = target_user_id
      AND mc.usage_information = cabinet_marker
      AND (
        r.user_id <> target_user_id
        OR r.notes IS DISTINCT FROM reminder_marker
      )
  ) THEN
    RAISE EXCEPTION
      'An unrelated reminder references a marked Cabinet row; cleanup stopped.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint AS c
    WHERE c.contype = 'f'
      AND c.confrelid = to_regclass('public.medicine_cabinet')
      AND c.conrelid <> to_regclass('public.medication_reminders')
  ) THEN
    RAISE EXCEPTION
      'An additional table references medicine_cabinet; review dependencies before cleanup.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint AS c
    WHERE c.contype = 'f'
      AND c.confrelid = to_regclass('public.medication_reminders')
      AND c.conrelid <> to_regclass('public.medication_dose_logs')
  ) THEN
    RAISE EXCEPTION
      'An additional table references medication_reminders; review dependencies before cleanup.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.medication_reminders AS r
    LEFT JOIN public.medicine_cabinet AS mc
      ON mc.id = r.medicine_id
    WHERE r.user_id = target_user_id
      AND r.notes = reminder_marker
      AND (
        r.medicine_id IS NULL
        OR mc.id IS NULL
        OR mc.user_id <> target_user_id
        OR mc.usage_information IS DISTINCT FROM cabinet_marker
      )
  ) THEN
    RAISE EXCEPTION
      'A marked reminder is not linked to this seed''s Cabinet row; cleanup stopped.';
  END IF;
END;
$cleanup_guard$;

SELECT
  (
    SELECT count(*)
    FROM public.medicine_cabinet
    WHERE user_id = '9a1b7896-34cd-439b-9cfd-b26411086786'::uuid
      AND usage_information =
        'DEMO ONLY: Synthetic inventory; not real medication history. [MEDDECODE:DEMO:964ed15f-d26a-4765-acaf-58837703afdc]'
  ) AS cabinet_rows_preview,
  (
    SELECT count(*)
    FROM public.medication_reminders
    WHERE user_id = '9a1b7896-34cd-439b-9cfd-b26411086786'::uuid
      AND notes =
        'DEMO ONLY: Fictional paused schedule; not medication advice. [MEDDECODE:DEMO:964ed15f-d26a-4765-acaf-58837703afdc]'
  ) AS reminder_rows_preview;

WITH deleted AS (
  DELETE FROM public.medication_reminders
  WHERE user_id = '9a1b7896-34cd-439b-9cfd-b26411086786'::uuid
    AND notes =
      'DEMO ONLY: Fictional paused schedule; not medication advice. [MEDDECODE:DEMO:964ed15f-d26a-4765-acaf-58837703afdc]'
  RETURNING id
)
SELECT count(*) AS reminders_deleted FROM deleted;

WITH deleted AS (
  DELETE FROM public.medicine_cabinet
  WHERE user_id = '9a1b7896-34cd-439b-9cfd-b26411086786'::uuid
    AND usage_information =
      'DEMO ONLY: Synthetic inventory; not real medication history. [MEDDECODE:DEMO:964ed15f-d26a-4765-acaf-58837703afdc]'
  RETURNING id
)
SELECT count(*) AS cabinet_entries_deleted FROM deleted;

SELECT
  (
    SELECT count(*)
    FROM public.medicine_cabinet
    WHERE user_id = '9a1b7896-34cd-439b-9cfd-b26411086786'::uuid
      AND usage_information =
        'DEMO ONLY: Synthetic inventory; not real medication history. [MEDDECODE:DEMO:964ed15f-d26a-4765-acaf-58837703afdc]'
  ) AS remaining_demo_cabinet_entries,
  (
    SELECT count(*)
    FROM public.medication_reminders
    WHERE user_id = '9a1b7896-34cd-439b-9cfd-b26411086786'::uuid
      AND notes =
        'DEMO ONLY: Fictional paused schedule; not medication advice. [MEDDECODE:DEMO:964ed15f-d26a-4765-acaf-58837703afdc]'
  ) AS remaining_demo_reminders;

COMMIT;
