\set ON_ERROR_STOP on
BEGIN;
SET TRANSACTION READ ONLY;

DO $preflight$
BEGIN
  IF current_database() <> 'postgres' THEN RAISE EXCEPTION 'unexpected database'; END IF;
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'unexpected deployment role'; END IF;
  IF to_regprocedure('auth.uid()') IS NULL THEN RAISE EXCEPTION 'auth.uid() is missing'; END IF;
  IF to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION 'required application users table is missing';
  END IF;
  IF to_regclass('public.medicine_cabinet') IS NULL THEN
    RAISE EXCEPTION 'required application medicine_cabinet table is missing';
  END IF;
  IF to_regrole('authenticated') IS NULL OR to_regrole('anon') IS NULL THEN
    RAISE EXCEPTION 'Supabase application roles are missing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE oid IN (
    to_regclass('public.medication_reminders'),
    to_regclass('public.medication_dose_logs')
  )) THEN RAISE EXCEPTION 'medication reminder objects already exist'; END IF;
END $preflight$;

SELECT 'MEDICATION_REMINDERS_PREFLIGHT_OK' AS marker;
ROLLBACK;
