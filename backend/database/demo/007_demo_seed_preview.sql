-- READ-ONLY preview for a temporary Medicine Cabinet and Reminder demo seed.
-- No user-owned rows are returned, except proposed rows for the target user.
-- Medicine candidates are existing public.medicines rows only.

BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';

SELECT
  EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = '9a1b7896-34cd-439b-9cfd-b26411086786'::uuid
  ) AS target_user_exists,
  (
    SELECT count(*)
    FROM public.medicine_cabinet
    WHERE user_id = '9a1b7896-34cd-439b-9cfd-b26411086786'::uuid
  ) AS target_cabinet_entries_current,
  (
    SELECT count(*)
    FROM public.medicine_cabinet
    WHERE user_id = '9a1b7896-34cd-439b-9cfd-b26411086786'::uuid
      AND usage_information =
        'DEMO ONLY: Synthetic inventory; not real medication history. [MEDDECODE:DEMO:964ed15f-d26a-4765-acaf-58837703afdc]'
  ) AS this_seed_cabinet_entries,
  (
    SELECT count(*)
    FROM public.medication_reminders
    WHERE user_id = '9a1b7896-34cd-439b-9cfd-b26411086786'::uuid
      AND notes =
        'DEMO ONLY: Fictional paused schedule; not medication advice. [MEDDECODE:DEMO:964ed15f-d26a-4765-acaf-58837703afdc]'
  ) AS this_seed_reminders;

SELECT
  EXISTS (
    SELECT 1
    FROM pg_constraint AS c
    WHERE c.contype = 'f'
      AND c.conrelid = to_regclass('public.medicine_cabinet')
      AND c.confrelid = to_regclass('public.medicines')
      AND cardinality(c.conkey) = 1
      AND cardinality(c.confkey) = 1
      AND c.conkey[1] = (
        SELECT a.attnum
        FROM pg_attribute AS a
        WHERE a.attrelid = c.conrelid
          AND a.attname = 'medicine_id'
          AND NOT a.attisdropped
      )
      AND c.confkey[1] = (
        SELECT a.attnum
        FROM pg_attribute AS a
        WHERE a.attrelid = c.confrelid
          AND a.attname = 'id'
          AND NOT a.attisdropped
      )
  ) AS cabinet_medicine_fk_verified,
  EXISTS (
    SELECT 1
    FROM pg_constraint AS c
    WHERE c.contype = 'f'
      AND c.conrelid = to_regclass('public.medication_reminders')
      AND c.confrelid = to_regclass('public.medicine_cabinet')
      AND pg_get_constraintdef(c.oid, true)
        ILIKE '%FOREIGN KEY (medicine_id) REFERENCES medicine_cabinet(id)%'
  ) AS reminder_cabinet_fk_verified;

-- Candidate choice: at most one row per non-empty generic_name; prefer rows
-- with dosage form and strength. No candidates already in this user's Cabinet.
WITH eligible AS (
  SELECT
    m.id,
    m.canonical_name,
    m.brand_name,
    m.generic_name,
    m.dosage_form,
    m.strength_value,
    m.strength_unit,
    m.manufacturer_id,
    (
      NULLIF(btrim(m.dosage_form), '') IS NOT NULL
      AND m.strength_value IS NOT NULL
      AND NULLIF(btrim(m.strength_unit), '') IS NOT NULL
    ) AS has_structured_detail,
    row_number() OVER (
      PARTITION BY lower(btrim(m.generic_name))
      ORDER BY
        (
          NULLIF(btrim(m.dosage_form), '') IS NOT NULL
          AND m.strength_value IS NOT NULL
          AND NULLIF(btrim(m.strength_unit), '') IS NOT NULL
        ) DESC,
        lower(btrim(m.brand_name)),
        m.id
    ) AS generic_rank
  FROM public.medicines AS m
  WHERE NULLIF(btrim(m.brand_name), '') IS NOT NULL
    AND length(btrim(m.brand_name)) <= 120
    AND NULLIF(btrim(m.generic_name), '') IS NOT NULL
    AND m.manufacturer_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.medicine_cabinet AS mc
      WHERE mc.user_id = '9a1b7896-34cd-439b-9cfd-b26411086786'::uuid
        AND mc.medicine_id = m.id
    )
),
distinct_generics AS (
  SELECT *
  FROM eligible
  WHERE generic_rank = 1
)
SELECT
  row_number() OVER (
    ORDER BY has_structured_detail DESC, lower(btrim(generic_name)), id
  ) AS proposed_slot,
  id AS medicine_id,
  brand_name,
  generic_name,
  dosage_form,
  strength_value,
  strength_unit,
  manufacturer_id,
  has_structured_detail
FROM distinct_generics
ORDER BY has_structured_detail DESC, lower(btrim(generic_name)), id
LIMIT 6;

-- Live Reminder gate summary. Review this together with all policy and ACL
-- details from 006_hosted_reminder_security_discovery.sql.
SELECT
  COALESCE((
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = to_regclass('public.medication_reminders')
  ), false) AS reminders_rls_enabled,
  COALESCE((
    SELECT relrowsecurity
    FROM pg_class
    WHERE oid = to_regclass('public.medication_dose_logs')
  ), false) AS dose_logs_rls_enabled,
  EXISTS (
    SELECT 1
    FROM pg_policy AS p
    WHERE p.polrelid = to_regclass('public.medication_reminders')
      AND p.polname = 'medication_reminders_owner_insert'
      AND p.polcmd = 'a'
      AND COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '')
        ILIKE '%medication_reminders.medicine_id%'
      AND COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '')
        ILIKE '%mc.user_id = auth.uid()%'
  ) AS corrected_reminder_insert_effect_observed,
  EXISTS (
    SELECT 1
    FROM pg_policy AS p
    WHERE p.polrelid = to_regclass('public.medication_reminders')
      AND p.polname = 'medication_reminders_owner_update'
      AND p.polcmd = 'w'
      AND COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '')
        ILIKE '%medication_reminders.medicine_id%'
      AND COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '')
        ILIKE '%mc.user_id = auth.uid()%'
  ) AS corrected_reminder_update_effect_observed,
  EXISTS (
    SELECT 1
    FROM pg_constraint AS c
    WHERE c.conrelid = to_regclass('public.medication_dose_logs')
      AND c.contype = 'f'
      AND c.conname = 'medication_dose_logs_reminder_user_fkey'
      AND c.confrelid = to_regclass('public.medication_reminders')
  ) AS composite_reminder_user_fk_present,
  EXISTS (
    SELECT 1
    FROM pg_constraint AS c
    WHERE c.conrelid = to_regclass('public.medication_dose_logs')
      AND c.contype = 'u'
      AND pg_get_constraintdef(c.oid, true)
        ILIKE '%UNIQUE (reminder_id, dose_time)%'
  ) AS dose_log_reminder_time_unique_present;

ROLLBACK;
