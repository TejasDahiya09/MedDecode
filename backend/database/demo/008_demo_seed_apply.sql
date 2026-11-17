-- TRANSACTIONAL demo seed. Review 007_demo_seed_preview.sql first.
-- This script inserts only into this user's Cabinet and Reminders tables.
-- It never inserts or updates master medicines and creates no dose logs.
-- On any error, the transaction is aborted; issue ROLLBACK in SQL Editor.

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Serialize this seed/marker pair so concurrent runs cannot both pass the
-- duplicate check and insert the same demo rows.
SELECT pg_advisory_xact_lock(
  hashtextextended(
    'meddecode-demo-seed:9a1b7896-34cd-439b-9cfd-b26411086786:964ed15f-d26a-4765-acaf-58837703afdc',
    0
  )
);

DO $preflight$
DECLARE
  target_user_id CONSTANT uuid :=
    '9a1b7896-34cd-439b-9cfd-b26411086786';
  cabinet_marker CONSTANT text :=
    'DEMO ONLY: Synthetic inventory; not real medication history. [MEDDECODE:DEMO:964ed15f-d26a-4765-acaf-58837703afdc]';
  reminder_marker CONSTANT text :=
    'DEMO ONLY: Fictional paused schedule; not medication advice. [MEDDECODE:DEMO:964ed15f-d26a-4765-acaf-58837703afdc]';
  existing_cabinet_count integer;
  existing_reminder_count integer;
  eligible_count integer;
BEGIN
  IF to_regclass('public.users') IS NULL
     OR to_regclass('public.medicines') IS NULL
     OR to_regclass('public.medicine_cabinet') IS NULL
     OR to_regclass('public.medication_reminders') IS NULL
     OR to_regclass('public.medication_dose_logs') IS NULL THEN
    RAISE EXCEPTION 'Required deployed tables are missing; no seed was applied.';
  END IF;

  IF to_regrole('anon') IS NULL OR to_regrole('authenticated') IS NULL THEN
    RAISE EXCEPTION 'Expected Supabase roles are missing; no seed was applied.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users WHERE id = target_user_id
  ) THEN
    RAISE EXCEPTION 'Target user does not exist; no seed was applied.';
  END IF;

  IF NOT has_table_privilege(current_user, 'public.medicine_cabinet', 'INSERT')
     OR NOT has_table_privilege(current_user, 'public.medication_reminders', 'INSERT') THEN
    RAISE EXCEPTION 'Current SQL Editor role cannot insert into the required tables.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class
    WHERE oid = to_regclass('public.medicine_cabinet')
      AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'Medicine Cabinet RLS is not enabled.';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_policy
    WHERE polrelid = to_regclass('public.medicine_cabinet')
  ) <> 4
     OR NOT EXISTS (
       SELECT 1 FROM pg_policy
       WHERE polrelid = to_regclass('public.medicine_cabinet')
         AND polname = 'medicine_cabinet_select_own'
         AND polcmd = 'r'
         AND COALESCE(pg_get_expr(polqual, polrelid), '')
           ILIKE '%user_id = auth.uid()%'
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_policy
       WHERE polrelid = to_regclass('public.medicine_cabinet')
         AND polname = 'medicine_cabinet_insert_own'
         AND polcmd = 'a'
         AND COALESCE(pg_get_expr(polwithcheck, polrelid), '')
           ILIKE '%user_id = auth.uid()%'
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_policy
       WHERE polrelid = to_regclass('public.medicine_cabinet')
         AND polname = 'medicine_cabinet_update_own'
         AND polcmd = 'w'
         AND COALESCE(pg_get_expr(polqual, polrelid), '')
           ILIKE '%user_id = auth.uid()%'
         AND COALESCE(pg_get_expr(polwithcheck, polrelid), '')
           ILIKE '%user_id = auth.uid()%'
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_policy
       WHERE polrelid = to_regclass('public.medicine_cabinet')
         AND polname = 'medicine_cabinet_delete_own'
         AND polcmd = 'd'
         AND COALESCE(pg_get_expr(polqual, polrelid), '')
           ILIKE '%user_id = auth.uid()%'
     ) THEN
    RAISE EXCEPTION 'Cabinet owner RLS policies are missing or unexpected.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS c
    WHERE c.contype = 'f'
      AND c.conrelid = to_regclass('public.medicine_cabinet')
      AND c.confrelid = to_regclass('public.medicines')
      AND cardinality(c.conkey) = 1
      AND cardinality(c.confkey) = 1
      AND c.conkey[1] = (
        SELECT a.attnum FROM pg_attribute AS a
        WHERE a.attrelid = c.conrelid
          AND a.attname = 'medicine_id'
          AND NOT a.attisdropped
      )
      AND c.confkey[1] = (
        SELECT a.attnum FROM pg_attribute AS a
        WHERE a.attrelid = c.confrelid
          AND a.attname = 'id'
          AND NOT a.attisdropped
      )
  ) THEN
    RAISE EXCEPTION 'Cabinet medicine_id -> medicines.id FK is not verified.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS c
    WHERE c.contype = 'f'
      AND c.conrelid = to_regclass('public.medicine_cabinet')
      AND c.confrelid = to_regclass('public.users')
      AND cardinality(c.conkey) = 1
      AND cardinality(c.confkey) = 1
      AND c.conkey[1] = (
        SELECT a.attnum FROM pg_attribute AS a
        WHERE a.attrelid = c.conrelid
          AND a.attname = 'user_id'
          AND NOT a.attisdropped
      )
      AND c.confkey[1] = (
        SELECT a.attnum FROM pg_attribute AS a
        WHERE a.attrelid = c.confrelid
          AND a.attname = 'id'
          AND NOT a.attisdropped
      )
  ) THEN
    RAISE EXCEPTION 'Cabinet user ownership FK is not verified.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS c
    WHERE c.contype = 'f'
      AND c.conrelid = to_regclass('public.medication_reminders')
      AND c.confrelid = to_regclass('public.medicine_cabinet')
      AND cardinality(c.conkey) = 1
      AND cardinality(c.confkey) = 1
      AND c.conkey[1] = (
        SELECT a.attnum FROM pg_attribute AS a
        WHERE a.attrelid = c.conrelid
          AND a.attname = 'medicine_id'
          AND NOT a.attisdropped
      )
      AND c.confkey[1] = (
        SELECT a.attnum FROM pg_attribute AS a
        WHERE a.attrelid = c.confrelid
          AND a.attname = 'id'
          AND NOT a.attisdropped
      )
  ) THEN
    RAISE EXCEPTION 'Reminder-to-Cabinet FK is not verified.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS c
    WHERE c.contype = 'f'
      AND c.conrelid = to_regclass('public.medication_reminders')
      AND c.confrelid = to_regclass('public.users')
      AND cardinality(c.conkey) = 1
      AND cardinality(c.confkey) = 1
      AND c.conkey[1] = (
        SELECT a.attnum FROM pg_attribute AS a
        WHERE a.attrelid = c.conrelid
          AND a.attname = 'user_id'
          AND NOT a.attisdropped
      )
      AND c.confkey[1] = (
        SELECT a.attnum FROM pg_attribute AS a
        WHERE a.attrelid = c.confrelid
          AND a.attname = 'id'
          AND NOT a.attisdropped
      )
  ) THEN
    RAISE EXCEPTION 'Reminder user ownership FK is not verified.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class
    WHERE oid = to_regclass('public.medication_reminders')
      AND relrowsecurity
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_class
    WHERE oid = to_regclass('public.medication_dose_logs')
      AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'Reminder or dose-log RLS is not enabled.';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_policy
    WHERE polrelid = to_regclass('public.medication_reminders')
  ) <> 4 OR (
    SELECT count(*)
    FROM pg_policy
    WHERE polrelid = to_regclass('public.medication_dose_logs')
  ) <> 4 THEN
    RAISE EXCEPTION 'Expected four RLS policies per Reminder/DoseLog table.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      VALUES
        ('public.medication_reminders'::text, 'medication_reminders_owner_select'::text, 'r'::"char"),
        ('public.medication_reminders', 'medication_reminders_owner_insert', 'a'),
        ('public.medication_reminders', 'medication_reminders_owner_update', 'w'),
        ('public.medication_reminders', 'medication_reminders_owner_delete', 'd'),
        ('public.medication_dose_logs', 'medication_dose_logs_owner_select', 'r'),
        ('public.medication_dose_logs', 'medication_dose_logs_owner_insert', 'a'),
        ('public.medication_dose_logs', 'medication_dose_logs_owner_update', 'w'),
        ('public.medication_dose_logs', 'medication_dose_logs_owner_delete', 'd')
    ) AS expected(table_name, policy_name, command)
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_policy AS p
      WHERE p.polrelid = to_regclass(expected.table_name)
        AND p.polname = expected.policy_name
        AND p.polcmd = expected.command
    )
  ) THEN
    RAISE EXCEPTION 'One or more expected Reminder/DoseLog RLS policies are missing.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policy AS p
    WHERE p.polrelid IN (
      to_regclass('public.medicine_cabinet'),
      to_regclass('public.medication_reminders'),
      to_regclass('public.medication_dose_logs')
    )
      AND p.polroles <> ARRAY[
        (SELECT oid FROM pg_roles WHERE rolname = 'authenticated')
      ]::oid[]
  ) THEN
    RAISE EXCEPTION 'An ownership policy is not restricted to authenticated.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = to_regclass('public.medication_reminders')
      AND polname = 'medication_reminders_owner_select'
      AND COALESCE(pg_get_expr(polqual, polrelid), '')
        ILIKE '%auth.uid() = user_id%'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = to_regclass('public.medication_reminders')
      AND polname = 'medication_reminders_owner_insert'
      AND COALESCE(pg_get_expr(polwithcheck, polrelid), '')
        ILIKE '%auth.uid() = user_id%'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = to_regclass('public.medication_reminders')
      AND polname = 'medication_reminders_owner_delete'
      AND COALESCE(pg_get_expr(polqual, polrelid), '')
        ILIKE '%auth.uid() = user_id%'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = to_regclass('public.medication_dose_logs')
      AND polname = 'medication_dose_logs_owner_select'
      AND COALESCE(pg_get_expr(polqual, polrelid), '')
        ILIKE '%auth.uid() = user_id%'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = to_regclass('public.medication_dose_logs')
      AND polname = 'medication_dose_logs_owner_insert'
      AND COALESCE(pg_get_expr(polwithcheck, polrelid), '')
        ILIKE '%auth.uid() = user_id%'
      AND COALESCE(pg_get_expr(polwithcheck, polrelid), '')
        ILIKE '%medication_reminders%'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = to_regclass('public.medication_dose_logs')
      AND polname = 'medication_dose_logs_owner_update'
      AND COALESCE(pg_get_expr(polqual, polrelid), '')
        ILIKE '%auth.uid() = user_id%'
      AND COALESCE(pg_get_expr(polwithcheck, polrelid), '')
        ILIKE '%auth.uid() = user_id%'
      AND COALESCE(pg_get_expr(polwithcheck, polrelid), '')
        ILIKE '%medication_reminders%'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = to_regclass('public.medication_dose_logs')
      AND polname = 'medication_dose_logs_owner_delete'
      AND COALESCE(pg_get_expr(polqual, polrelid), '')
        ILIKE '%auth.uid() = user_id%'
  ) THEN
    RAISE EXCEPTION 'One or more Reminder/DoseLog owner policy predicates are invalid.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policy AS p
    WHERE p.polrelid = to_regclass('public.medication_reminders')
      AND p.polname = 'medication_reminders_owner_insert'
      AND COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '')
        ILIKE '%medication_reminders.medicine_id%'
      AND COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '')
        ILIKE '%mc.id = medication_reminders.medicine_id%'
      AND COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '')
        ILIKE '%mc.user_id = auth.uid()%'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_policy AS p
    WHERE p.polrelid = to_regclass('public.medication_reminders')
      AND p.polname = 'medication_reminders_owner_update'
      AND COALESCE(pg_get_expr(p.polqual, p.polrelid), '')
        ILIKE '%auth.uid() = user_id%'
      AND COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '')
        ILIKE '%medication_reminders.medicine_id%'
      AND COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '')
        ILIKE '%mc.id = medication_reminders.medicine_id%'
      AND COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '')
        ILIKE '%mc.user_id = auth.uid()%'
  ) THEN
    RAISE EXCEPTION 'Corrected Reminder Cabinet-owner policy effects are not verified.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class AS c
    CROSS JOIN LATERAL aclexplode(
      COALESCE(c.relacl, acldefault('r', c.relowner))
    ) AS acl
    WHERE c.oid IN (
      to_regclass('public.medicine_cabinet'),
      to_regclass('public.medication_reminders'),
      to_regclass('public.medication_dose_logs')
    )
      AND acl.grantee = 0
  ) OR EXISTS (
    SELECT 1
    FROM pg_attribute AS a
    CROSS JOIN LATERAL aclexplode(a.attacl) AS acl
    WHERE a.attrelid IN (
      to_regclass('public.medicine_cabinet'),
      to_regclass('public.medication_reminders'),
      to_regclass('public.medication_dose_logs')
    )
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND acl.grantee = 0
  ) THEN
    RAISE EXCEPTION 'PUBLIC has a direct Reminder/DoseLog table or column grant.';
  END IF;

  IF has_table_privilege('anon', 'public.medication_reminders', 'SELECT')
     OR has_table_privilege('anon', 'public.medication_reminders', 'INSERT')
     OR has_table_privilege('anon', 'public.medication_reminders', 'UPDATE')
     OR has_table_privilege('anon', 'public.medication_reminders', 'DELETE')
     OR has_table_privilege('anon', 'public.medication_reminders', 'TRUNCATE')
     OR has_table_privilege('anon', 'public.medication_reminders', 'REFERENCES')
     OR has_table_privilege('anon', 'public.medication_reminders', 'TRIGGER')
     OR has_table_privilege('anon', 'public.medication_dose_logs', 'SELECT')
     OR has_table_privilege('anon', 'public.medication_dose_logs', 'INSERT')
     OR has_table_privilege('anon', 'public.medication_dose_logs', 'UPDATE')
     OR has_table_privilege('anon', 'public.medication_dose_logs', 'DELETE')
     OR has_table_privilege('anon', 'public.medication_dose_logs', 'TRUNCATE')
     OR has_table_privilege('anon', 'public.medication_dose_logs', 'REFERENCES')
     OR has_table_privilege('anon', 'public.medication_dose_logs', 'TRIGGER')
     OR has_any_column_privilege('anon', 'public.medication_reminders', 'SELECT')
     OR has_any_column_privilege('anon', 'public.medication_reminders', 'INSERT')
     OR has_any_column_privilege('anon', 'public.medication_reminders', 'UPDATE')
     OR has_any_column_privilege('anon', 'public.medication_reminders', 'REFERENCES')
     OR has_any_column_privilege('anon', 'public.medication_dose_logs', 'SELECT')
     OR has_any_column_privilege('anon', 'public.medication_dose_logs', 'INSERT')
     OR has_any_column_privilege('anon', 'public.medication_dose_logs', 'UPDATE')
     OR has_any_column_privilege('anon', 'public.medication_dose_logs', 'REFERENCES') THEN
    RAISE EXCEPTION 'anon has effective Reminder/DoseLog table or column privileges.';
  END IF;

  IF has_table_privilege('anon', 'public.medicine_cabinet', 'SELECT')
     OR has_table_privilege('anon', 'public.medicine_cabinet', 'INSERT')
     OR has_table_privilege('anon', 'public.medicine_cabinet', 'UPDATE')
     OR has_table_privilege('anon', 'public.medicine_cabinet', 'DELETE')
     OR has_table_privilege('anon', 'public.medicine_cabinet', 'TRUNCATE')
     OR has_table_privilege('anon', 'public.medicine_cabinet', 'REFERENCES')
     OR has_table_privilege('anon', 'public.medicine_cabinet', 'TRIGGER')
     OR has_any_column_privilege('anon', 'public.medicine_cabinet', 'SELECT')
     OR has_any_column_privilege('anon', 'public.medicine_cabinet', 'INSERT')
     OR has_any_column_privilege('anon', 'public.medicine_cabinet', 'UPDATE')
     OR has_any_column_privilege('anon', 'public.medicine_cabinet', 'REFERENCES') THEN
    RAISE EXCEPTION 'anon has effective Medicine Cabinet table or column privileges.';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.medication_reminders', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.medication_reminders', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.medication_reminders', 'UPDATE')
     OR NOT has_table_privilege('authenticated', 'public.medication_reminders', 'DELETE')
     OR NOT has_table_privilege('authenticated', 'public.medication_dose_logs', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.medication_dose_logs', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.medication_dose_logs', 'UPDATE')
     OR NOT has_table_privilege('authenticated', 'public.medication_dose_logs', 'DELETE') THEN
    RAISE EXCEPTION 'Authenticated Reminder/DoseLog CRUD grants are incomplete.';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.medicine_cabinet', 'SELECT')
     OR NOT has_table_privilege('authenticated', 'public.medicine_cabinet', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.medicine_cabinet', 'UPDATE')
     OR NOT has_table_privilege('authenticated', 'public.medicine_cabinet', 'DELETE') THEN
    RAISE EXCEPTION 'Authenticated Medicine Cabinet CRUD grants are incomplete.';
  END IF;

  IF has_table_privilege('authenticated', 'public.medicine_cabinet', 'TRUNCATE')
     OR has_table_privilege('authenticated', 'public.medicine_cabinet', 'REFERENCES')
     OR has_table_privilege('authenticated', 'public.medicine_cabinet', 'TRIGGER')
     OR has_table_privilege('authenticated', 'public.medication_reminders', 'TRUNCATE')
     OR has_table_privilege('authenticated', 'public.medication_reminders', 'REFERENCES')
     OR has_table_privilege('authenticated', 'public.medication_reminders', 'TRIGGER')
     OR has_table_privilege('authenticated', 'public.medication_dose_logs', 'TRUNCATE')
     OR has_table_privilege('authenticated', 'public.medication_dose_logs', 'REFERENCES')
     OR has_table_privilege('authenticated', 'public.medication_dose_logs', 'TRIGGER') THEN
    RAISE EXCEPTION 'Authenticated role has unexpected elevated table privileges.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS c
    WHERE c.conrelid = to_regclass('public.medication_dose_logs')
      AND c.contype = 'f'
      AND c.conname = 'medication_dose_logs_reminder_user_fkey'
      AND c.confrelid = to_regclass('public.medication_reminders')
      AND pg_get_constraintdef(c.oid, true)
        ILIKE '%FOREIGN KEY (reminder_id, user_id)%REFERENCES medication_reminders(id, user_id)%'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS c
    WHERE c.conrelid = to_regclass('public.medication_dose_logs')
      AND c.contype = 'u'
      AND pg_get_constraintdef(c.oid, true)
        ILIKE '%UNIQUE (reminder_id, dose_time)%'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_constraint AS c
    WHERE c.conrelid = to_regclass('public.medication_dose_logs')
      AND c.contype = 'f'
      AND c.confrelid = to_regclass('public.users')
      AND cardinality(c.conkey) = 1
      AND cardinality(c.confkey) = 1
      AND c.conkey[1] = (
        SELECT a.attnum FROM pg_attribute AS a
        WHERE a.attrelid = c.conrelid
          AND a.attname = 'user_id'
          AND NOT a.attisdropped
      )
      AND c.confkey[1] = (
        SELECT a.attnum FROM pg_attribute AS a
        WHERE a.attrelid = c.confrelid
          AND a.attname = 'id'
          AND NOT a.attisdropped
      )
  ) THEN
    RAISE EXCEPTION 'Dose-log ownership FK or uniqueness constraint is missing.';
  END IF;

  SELECT count(*)::integer
  INTO existing_cabinet_count
  FROM public.medicine_cabinet
  WHERE user_id = target_user_id
    AND usage_information = cabinet_marker;

  SELECT count(*)::integer
  INTO existing_reminder_count
  FROM public.medication_reminders
  WHERE user_id = target_user_id
    AND notes = reminder_marker;

  IF NOT (
    (existing_cabinet_count = 0 AND existing_reminder_count = 0)
    OR (existing_cabinet_count BETWEEN 5 AND 6 AND existing_reminder_count = 5)
  ) THEN
    RAISE EXCEPTION
      'Partial or unexpected demo marker state (Cabinet %, Reminders %); inspect before continuing.',
      existing_cabinet_count,
      existing_reminder_count;
  END IF;

  IF existing_cabinet_count = 0 THEN
    WITH eligible AS (
      SELECT
        m.id,
        m.generic_name,
        m.brand_name,
        m.dosage_form,
        m.strength_value,
        m.strength_unit,
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
          WHERE mc.user_id = target_user_id
            AND mc.medicine_id = m.id
        )
    )
    SELECT count(*)::integer
    INTO eligible_count
    FROM (
      SELECT id
      FROM eligible
      WHERE generic_rank = 1
      ORDER BY has_structured_detail DESC, lower(btrim(generic_name)), id
      LIMIT 6
    ) AS chosen;

    IF eligible_count < 5 THEN
      RAISE EXCEPTION
        'Only % eligible distinct-generic medicines are available; at least five are required.',
        eligible_count;
    END IF;
  END IF;
END;
$preflight$;

-- Insert 5–6 distinct generic-name candidates. Existing Cabinet medicine
-- entries are excluded. Values are synthetic stock metadata, not use history.
WITH eligible AS (
  SELECT
    m.id,
    m.brand_name,
    m.generic_name,
    m.dosage_form,
    m.strength_value,
    m.strength_unit,
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
chosen AS (
  SELECT
    id AS medicine_id,
    row_number() OVER (
      ORDER BY has_structured_detail DESC, lower(btrim(generic_name)), id
    ) AS demo_slot
  FROM eligible
  WHERE generic_rank = 1
  ORDER BY has_structured_detail DESC, lower(btrim(generic_name)), id
  LIMIT 6
)
INSERT INTO public.medicine_cabinet (
  user_id,
  medicine_id,
  family_member_id,
  quantity,
  purchase_date,
  expiry_date,
  refill_date,
  usage_information
)
SELECT
  '9a1b7896-34cd-439b-9cfd-b26411086786'::uuid,
  chosen.medicine_id,
  NULL,
  18 + chosen.demo_slot * 6,
  current_date - (chosen.demo_slot * 3)::integer,
  current_date + (330 + chosen.demo_slot)::integer,
  current_date + (14 + chosen.demo_slot * 7)::integer,
  'DEMO ONLY: Synthetic inventory; not real medication history. [MEDDECODE:DEMO:964ed15f-d26a-4765-acaf-58837703afdc]'
FROM chosen
WHERE NOT EXISTS (
  SELECT 1
  FROM public.medicine_cabinet AS already_seeded
  WHERE already_seeded.user_id =
    '9a1b7896-34cd-439b-9cfd-b26411086786'::uuid
    AND already_seeded.usage_information =
      'DEMO ONLY: Synthetic inventory; not real medication history. [MEDDECODE:DEMO:964ed15f-d26a-4765-acaf-58837703afdc]'
);

DO $cabinet_check$
BEGIN
  IF (
    SELECT count(*)
    FROM public.medicine_cabinet
    WHERE user_id = '9a1b7896-34cd-439b-9cfd-b26411086786'::uuid
      AND usage_information =
        'DEMO ONLY: Synthetic inventory; not real medication history. [MEDDECODE:DEMO:964ed15f-d26a-4765-acaf-58837703afdc]'
  ) NOT BETWEEN 5 AND 6
  OR EXISTS (
    SELECT 1
    FROM public.medicine_cabinet AS mc
    LEFT JOIN public.medicines AS m ON m.id = mc.medicine_id
    WHERE mc.user_id = '9a1b7896-34cd-439b-9cfd-b26411086786'::uuid
      AND mc.usage_information =
        'DEMO ONLY: Synthetic inventory; not real medication history. [MEDDECODE:DEMO:964ed15f-d26a-4765-acaf-58837703afdc]'
      AND (
        mc.user_id <> '9a1b7896-34cd-439b-9cfd-b26411086786'::uuid
        OR m.id IS NULL
      )
  ) THEN
    RAISE EXCEPTION 'Cabinet ownership or catalogue-link verification failed.';
  END IF;
END;
$cabinet_check$;

-- Five paused reminders, one per Cabinet entry. Paused status prevents Take
-- Dose/Skip actions in the UI; dosage instructions and dose logs are omitted.
WITH demo_cabinet AS (
  SELECT
    mc.id AS cabinet_id,
    m.id AS medicine_id,
    m.brand_name,
    m.generic_name,
    m.dosage_form,
    m.strength_value,
    m.strength_unit,
    (
      NULLIF(btrim(m.dosage_form), '') IS NOT NULL
      AND m.strength_value IS NOT NULL
      AND NULLIF(btrim(m.strength_unit), '') IS NOT NULL
    ) AS has_structured_detail
  FROM public.medicine_cabinet AS mc
  JOIN public.medicines AS m ON m.id = mc.medicine_id
  WHERE mc.user_id = '9a1b7896-34cd-439b-9cfd-b26411086786'::uuid
    AND mc.usage_information =
      'DEMO ONLY: Synthetic inventory; not real medication history. [MEDDECODE:DEMO:964ed15f-d26a-4765-acaf-58837703afdc]'
),
chosen AS (
  SELECT
    cabinet_id,
    brand_name,
    generic_name,
    row_number() OVER (
      ORDER BY has_structured_detail DESC, lower(btrim(generic_name)), medicine_id
    ) AS demo_slot
  FROM demo_cabinet
  ORDER BY has_structured_detail DESC, lower(btrim(generic_name)), medicine_id
  LIMIT 5
)
INSERT INTO public.medication_reminders (
  user_id,
  medicine_id,
  medicine_name,
  dosage,
  scheduled_time,
  scheduled_date,
  start_date,
  end_date,
  recurrence,
  status,
  notes
)
SELECT
  '9a1b7896-34cd-439b-9cfd-b26411086786'::uuid,
  chosen.cabinet_id,
  chosen.brand_name,
  NULL,
  CASE chosen.demo_slot
    WHEN 1 THEN '08:17'
    WHEN 2 THEN '12:31'
    WHEN 3 THEN '16:43'
    WHEN 4 THEN '19:09'
    ELSE '21:27'
  END,
  CASE chosen.demo_slot
    WHEN 3 THEN current_date + 1
    WHEN 4 THEN current_date + 4
    ELSE NULL
  END,
  current_date,
  current_date + 30,
  CASE chosen.demo_slot
    WHEN 1 THEN 'daily'
    WHEN 2 THEN 'daily'
    WHEN 3 THEN 'weekly'
    WHEN 4 THEN 'once'
    ELSE 'custom'
  END,
  'paused',
  'DEMO ONLY: Fictional paused schedule; not medication advice. [MEDDECODE:DEMO:964ed15f-d26a-4765-acaf-58837703afdc]'
FROM chosen
WHERE NOT EXISTS (
  SELECT 1
  FROM public.medication_reminders AS already_seeded
  WHERE already_seeded.user_id =
    '9a1b7896-34cd-439b-9cfd-b26411086786'::uuid
    AND already_seeded.notes =
      'DEMO ONLY: Fictional paused schedule; not medication advice. [MEDDECODE:DEMO:964ed15f-d26a-4765-acaf-58837703afdc]'
);

DO $reminder_check$
BEGIN
  IF (
    SELECT count(*)
    FROM public.medication_reminders
    WHERE user_id = '9a1b7896-34cd-439b-9cfd-b26411086786'::uuid
      AND notes =
        'DEMO ONLY: Fictional paused schedule; not medication advice. [MEDDECODE:DEMO:964ed15f-d26a-4765-acaf-58837703afdc]'
  ) <> 5
  OR EXISTS (
    SELECT 1
    FROM public.medication_reminders AS r
    LEFT JOIN public.medicine_cabinet AS mc
      ON mc.id = r.medicine_id
    WHERE r.user_id = '9a1b7896-34cd-439b-9cfd-b26411086786'::uuid
      AND r.notes =
        'DEMO ONLY: Fictional paused schedule; not medication advice. [MEDDECODE:DEMO:964ed15f-d26a-4765-acaf-58837703afdc]'
      AND (
        mc.id IS NULL
        OR mc.user_id <> r.user_id
        OR r.status <> 'paused'
        OR r.dosage IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'Reminder ownership or synthetic-field verification failed.';
  END IF;
END;
$reminder_check$;

-- A repeat run must remain a no-op, never silently accept duplicated marker
-- rows or a seed that has acquired medication-taking history.
DO $demo_identity_check$
BEGIN
  IF EXISTS (
    SELECT medicine_id FROM public.medicine_cabinet
    WHERE user_id='9a1b7896-34cd-439b-9cfd-b26411086786'::uuid
      AND usage_information='DEMO ONLY: Synthetic inventory; not real medication history. [MEDDECODE:DEMO:964ed15f-d26a-4765-acaf-58837703afdc]'
    GROUP BY medicine_id HAVING count(*)>1
  ) OR EXISTS (
    SELECT medicine_id FROM public.medication_reminders
    WHERE user_id='9a1b7896-34cd-439b-9cfd-b26411086786'::uuid
      AND notes='DEMO ONLY: Fictional paused schedule; not medication advice. [MEDDECODE:DEMO:964ed15f-d26a-4765-acaf-58837703afdc]'
    GROUP BY medicine_id HAVING count(*)>1
  ) OR EXISTS (
    SELECT FROM public.medication_dose_logs dl
    JOIN public.medication_reminders r ON r.id=dl.reminder_id AND r.user_id=dl.user_id
    WHERE r.user_id='9a1b7896-34cd-439b-9cfd-b26411086786'::uuid
      AND r.notes='DEMO ONLY: Fictional paused schedule; not medication advice. [MEDDECODE:DEMO:964ed15f-d26a-4765-acaf-58837703afdc]'
  ) THEN
    RAISE EXCEPTION 'Duplicate demo identities or existing dose history detected; entire seed rolled back.';
  END IF;
END;
$demo_identity_check$;

SELECT
  (
    SELECT count(*)
    FROM public.medicine_cabinet
    WHERE user_id = '9a1b7896-34cd-439b-9cfd-b26411086786'::uuid
      AND usage_information =
        'DEMO ONLY: Synthetic inventory; not real medication history. [MEDDECODE:DEMO:964ed15f-d26a-4765-acaf-58837703afdc]'
  ) AS demo_cabinet_entries,
  (
    SELECT count(*)
    FROM public.medication_reminders
    WHERE user_id = '9a1b7896-34cd-439b-9cfd-b26411086786'::uuid
      AND notes =
        'DEMO ONLY: Fictional paused schedule; not medication advice. [MEDDECODE:DEMO:964ed15f-d26a-4765-acaf-58837703afdc]'
  ) AS demo_reminders;

COMMIT;
