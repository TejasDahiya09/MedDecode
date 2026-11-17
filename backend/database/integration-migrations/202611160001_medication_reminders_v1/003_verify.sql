\set ON_ERROR_STOP on
BEGIN;
SET TRANSACTION READ ONLY;

DO $verify$
DECLARE
  pol_qual text;
  pol_check text;
BEGIN
  -- 1. Table presence
  IF to_regclass('public.medication_reminders') IS NULL THEN
    RAISE EXCEPTION 'table public.medication_reminders is missing';
  END IF;
  IF to_regclass('public.medication_dose_logs') IS NULL THEN
    RAISE EXCEPTION 'table public.medication_dose_logs is missing';
  END IF;

  -- 2. Verify RLS is enabled on both tables
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'medication_reminders' AND rowsecurity = true
  ) THEN
    RAISE EXCEPTION 'row level security is not enabled on public.medication_reminders';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'medication_dose_logs' AND rowsecurity = true
  ) THEN
    RAISE EXCEPTION 'row level security is not enabled on public.medication_dose_logs';
  END IF;

  -- 3. Verify Constraints and Relationships
  -- 3a. medication_reminders (id, user_id) unique constraint
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.medication_reminders'::regclass
      AND contype = 'u'
      AND conname = 'medication_reminders_id_user_uniq'
  ) THEN
    RAISE EXCEPTION 'medication_reminders_id_user_uniq constraint is missing';
  END IF;

  -- 3b. medication_dose_logs uniqueness on (reminder_id, dose_time)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.medication_dose_logs'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) LIKE '%UNIQUE (reminder_id, dose_time)%'
  ) THEN
    RAISE EXCEPTION 'medication_dose_logs (reminder_id, dose_time) unique constraint is missing';
  END IF;

  -- 3c. medication_reminders -> users foreign key
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.medication_reminders'::regclass
      AND contype = 'f'
      AND confrelid = 'public.users'::regclass
      AND pg_get_constraintdef(oid) LIKE '%REFERENCES users(id)%'
  ) THEN
    RAISE EXCEPTION 'medication_reminders -> users foreign key is missing';
  END IF;

  -- 3d. medication_reminders -> medicine_cabinet foreign key
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.medication_reminders'::regclass
      AND contype = 'f'
      AND confrelid = 'public.medicine_cabinet'::regclass
      AND pg_get_constraintdef(oid) LIKE '%REFERENCES medicine_cabinet(id)%'
  ) THEN
    RAISE EXCEPTION 'medication_reminders -> medicine_cabinet foreign key is missing';
  END IF;

  -- 3e. medication_dose_logs -> medication_reminders composite foreign key (owner consistent)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.medication_dose_logs'::regclass
      AND contype = 'f'
      AND confrelid = 'public.medication_reminders'::regclass
      AND pg_get_constraintdef(oid) LIKE '%REFERENCES medication_reminders(id, user_id)%'
  ) THEN
    RAISE EXCEPTION 'medication_dose_logs -> medication_reminders(id, user_id) composite foreign key is missing';
  END IF;

  -- 4. Verify Indexes
  IF to_regclass('public.medication_reminders_user_time_idx') IS NULL THEN
    RAISE EXCEPTION 'medication_reminders_user_time_idx is missing';
  END IF;
  IF to_regclass('public.medication_reminders_user_status_idx') IS NULL THEN
    RAISE EXCEPTION 'medication_reminders_user_status_idx is missing';
  END IF;
  IF to_regclass('public.medication_dose_logs_user_idx') IS NULL THEN
    RAISE EXCEPTION 'medication_dose_logs_user_idx is missing';
  END IF;

  -- 5. Verify All 8 RLS Policies and Predicates
  -- 5a. medication_reminders_owner_select
  SELECT pg_get_expr(polqual, polrelid) INTO pol_qual
  FROM pg_policy WHERE polname = 'medication_reminders_owner_select' AND polrelid = 'public.medication_reminders'::regclass;
  IF pol_qual IS NULL OR pol_qual NOT LIKE '%(auth.uid() = user_id)%' THEN
    RAISE EXCEPTION 'medication_reminders_owner_select predicate invalid or missing: %', pol_qual;
  END IF;

  -- 5b. medication_reminders_owner_insert
  SELECT pg_get_expr(polwithcheck, polrelid) INTO pol_check
  FROM pg_policy WHERE polname = 'medication_reminders_owner_insert' AND polrelid = 'public.medication_reminders'::regclass;
  IF pol_check IS NULL OR pol_check NOT LIKE '%(auth.uid() = user_id)%' OR pol_check NOT LIKE '%medicine_cabinet%' THEN
    RAISE EXCEPTION 'medication_reminders_owner_insert predicate invalid or missing: %', pol_check;
  END IF;

  -- 5c. medication_reminders_owner_update
  SELECT pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid) INTO pol_qual, pol_check
  FROM pg_policy WHERE polname = 'medication_reminders_owner_update' AND polrelid = 'public.medication_reminders'::regclass;
  IF pol_qual IS NULL OR pol_qual NOT LIKE '%(auth.uid() = user_id)%' OR pol_check NOT LIKE '%medicine_cabinet%' THEN
    RAISE EXCEPTION 'medication_reminders_owner_update predicates invalid or missing: qual=%, check=%', pol_qual, pol_check;
  END IF;

  -- 5d. medication_reminders_owner_delete
  SELECT pg_get_expr(polqual, polrelid) INTO pol_qual
  FROM pg_policy WHERE polname = 'medication_reminders_owner_delete' AND polrelid = 'public.medication_reminders'::regclass;
  IF pol_qual IS NULL OR pol_qual NOT LIKE '%(auth.uid() = user_id)%' THEN
    RAISE EXCEPTION 'medication_reminders_owner_delete predicate invalid or missing: %', pol_qual;
  END IF;

  -- 5e. medication_dose_logs_owner_select
  SELECT pg_get_expr(polqual, polrelid) INTO pol_qual
  FROM pg_policy WHERE polname = 'medication_dose_logs_owner_select' AND polrelid = 'public.medication_dose_logs'::regclass;
  IF pol_qual IS NULL OR pol_qual NOT LIKE '%(auth.uid() = user_id)%' THEN
    RAISE EXCEPTION 'medication_dose_logs_owner_select predicate invalid or missing: %', pol_qual;
  END IF;

  -- 5f. medication_dose_logs_owner_insert
  SELECT pg_get_expr(polwithcheck, polrelid) INTO pol_check
  FROM pg_policy WHERE polname = 'medication_dose_logs_owner_insert' AND polrelid = 'public.medication_dose_logs'::regclass;
  IF pol_check IS NULL OR pol_check NOT LIKE '%(auth.uid() = user_id)%' OR pol_check NOT LIKE '%medication_reminders%' THEN
    RAISE EXCEPTION 'medication_dose_logs_owner_insert predicate invalid or missing: %', pol_check;
  END IF;

  -- 5g. medication_dose_logs_owner_update
  SELECT pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid) INTO pol_qual, pol_check
  FROM pg_policy WHERE polname = 'medication_dose_logs_owner_update' AND polrelid = 'public.medication_dose_logs'::regclass;
  IF pol_qual IS NULL OR pol_qual NOT LIKE '%(auth.uid() = user_id)%' OR pol_check NOT LIKE '%medication_reminders%' THEN
    RAISE EXCEPTION 'medication_dose_logs_owner_update predicates invalid or missing: qual=%, check=%', pol_qual, pol_check;
  END IF;

  -- 5h. medication_dose_logs_owner_delete
  SELECT pg_get_expr(polqual, polrelid) INTO pol_qual
  FROM pg_policy WHERE polname = 'medication_dose_logs_owner_delete' AND polrelid = 'public.medication_dose_logs'::regclass;
  IF pol_qual IS NULL OR pol_qual NOT LIKE '%(auth.uid() = user_id)%' THEN
    RAISE EXCEPTION 'medication_dose_logs_owner_delete predicate invalid or missing: %', pol_qual;
  END IF;

  -- 6. Verify Permissions & Anonymous Denial
  IF NOT has_table_privilege('authenticated', 'public.medication_reminders', 'SELECT, INSERT, UPDATE, DELETE') THEN
    RAISE EXCEPTION 'authenticated role missing required privileges on public.medication_reminders';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.medication_dose_logs', 'SELECT, INSERT, UPDATE, DELETE') THEN
    RAISE EXCEPTION 'authenticated role missing required privileges on public.medication_dose_logs';
  END IF;

  IF has_table_privilege('anon', 'public.medication_reminders', 'SELECT') OR
     has_table_privilege('anon', 'public.medication_reminders', 'INSERT') OR
     has_table_privilege('anon', 'public.medication_reminders', 'UPDATE') OR
     has_table_privilege('anon', 'public.medication_reminders', 'DELETE') THEN
    RAISE EXCEPTION 'anonymous role has unexpected privilege on public.medication_reminders';
  END IF;

  IF has_table_privilege('anon', 'public.medication_dose_logs', 'SELECT') OR
     has_table_privilege('anon', 'public.medication_dose_logs', 'INSERT') OR
     has_table_privilege('anon', 'public.medication_dose_logs', 'UPDATE') OR
     has_table_privilege('anon', 'public.medication_dose_logs', 'DELETE') THEN
    RAISE EXCEPTION 'anonymous role has unexpected privilege on public.medication_dose_logs';
  END IF;

END $verify$;

SELECT 'MEDICATION_REMINDERS_VERIFY_OK' AS marker;
ROLLBACK;
