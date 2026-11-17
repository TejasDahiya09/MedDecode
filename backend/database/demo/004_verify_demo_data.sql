-- Read-only aggregate verification draft.
-- Run only after manually confirming the deployed schema and the Reminders
-- security gate. Outputs aggregates only and scopes every count to the
-- user UUID supplied for this demo.
--
-- "Unrelated" counts are current non-demo row counts, not proof of
-- preservation without comparing them to a pre-seed baseline.

BEGIN TRANSACTION READ ONLY;

DO $schema_guard$
BEGIN
  IF to_regclass('public.users') IS NULL
     OR to_regclass('public.medicines') IS NULL
     OR to_regclass('public.medicine_cabinet') IS NULL
     OR to_regclass('public.medication_reminders') IS NULL
     OR to_regclass('public.medication_dose_logs') IS NULL THEN
    RAISE EXCEPTION
      'Required deployed tables are missing; verify schema before running this report.';
  END IF;
END;
$schema_guard$;

WITH
target AS (
  SELECT
    '9a1b7896-34cd-439b-9cfd-b26411086786'::uuid AS user_id,
    '[MEDDECODE_DEMO_SEED:wyripeqruhvbksjfsvlr:20261116]'::text AS marker
),
demo_cabinet AS (
  SELECT mc.*
  FROM public.medicine_cabinet AS mc
  CROSS JOIN target AS t
  WHERE mc.user_id = t.user_id
    AND strpos(coalesce(mc.usage_information, ''), t.marker) > 0
),
demo_reminders AS (
  SELECT r.*
  FROM public.medication_reminders AS r
  CROSS JOIN target AS t
  WHERE r.user_id = t.user_id
    AND strpos(coalesce(r.notes, ''), t.marker) > 0
),
demo_dose_logs AS (
  SELECT dl.*
  FROM public.medication_dose_logs AS dl
  CROSS JOIN target AS t
  WHERE dl.user_id = t.user_id
    AND strpos(coalesce(dl.notes, ''), t.marker) > 0
)
SELECT
  (SELECT count(*) FROM demo_cabinet) AS demonstration_cabinet_entries,
  (SELECT count(*) FROM demo_reminders) AS demonstration_reminders,
  (SELECT count(*) FROM demo_dose_logs) AS demonstration_dose_logs,
  (
    SELECT count(*)
    FROM public.medicine_cabinet AS mc
    CROSS JOIN target AS t
    WHERE mc.user_id = t.user_id
      AND strpos(coalesce(mc.usage_information, ''), t.marker) = 0
  ) AS unrelated_cabinet_entries_current,
  (
    SELECT count(*)
    FROM public.medication_reminders AS r
    CROSS JOIN target AS t
    WHERE r.user_id = t.user_id
      AND strpos(coalesce(r.notes, ''), t.marker) = 0
  ) AS unrelated_reminders_current,
  (
    SELECT count(*)
    FROM demo_reminders AS r
    LEFT JOIN public.medicine_cabinet AS mc
      ON mc.id = r.medicine_id
    WHERE r.medicine_id IS NOT NULL
      AND (mc.id IS NULL OR mc.user_id <> r.user_id)
  ) AS reminder_owner_mismatches,
  (
    SELECT count(*)
    FROM demo_reminders AS r
    WHERE r.medicine_id IS NULL
  ) AS reminders_without_cabinet_link,
  (
    SELECT count(*)
    FROM demo_cabinet AS dc
    LEFT JOIN public.medicines AS m
      ON m.id = dc.medicine_id
    WHERE m.id IS NULL
  ) AS missing_legacy_medicine_relationships,
  (
    SELECT count(*)
    FROM (
      SELECT dc.medicine_id
      FROM demo_cabinet AS dc
      GROUP BY dc.medicine_id
      HAVING count(*) > 1
    ) AS duplicates
  ) AS duplicate_demo_cabinet_medicine_ids,
  (
    SELECT count(*)
    FROM (
      SELECT r.medicine_id, r.scheduled_time, r.scheduled_date
      FROM demo_reminders AS r
      GROUP BY r.medicine_id, r.scheduled_time, r.scheduled_date
      HAVING count(*) > 1
    ) AS duplicates
  ) AS duplicate_demo_reminder_schedules;

ROLLBACK;
