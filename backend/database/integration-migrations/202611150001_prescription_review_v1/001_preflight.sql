\set ON_ERROR_STOP on
BEGIN;
SET TRANSACTION READ ONLY;

DO $preflight$
BEGIN
  IF current_database() <> 'postgres' THEN RAISE EXCEPTION 'unexpected database'; END IF;
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'unexpected deployment role'; END IF;
  IF to_regprocedure('auth.uid()') IS NULL THEN RAISE EXCEPTION 'auth.uid() is missing'; END IF;
  IF to_regclass('public.users') IS NULL OR to_regclass('public.prescriptions') IS NULL
     OR to_regclass('public.ai_jobs') IS NULL OR to_regclass('public.prescription_intelligence_results') IS NULL THEN
    RAISE EXCEPTION 'required application tables are missing';
  END IF;
  IF to_regrole('authenticated') IS NULL OR to_regrole('anon') IS NULL THEN
    RAISE EXCEPTION 'Supabase application roles are missing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE oid IN (
    to_regclass('public.prescription_ocr_evidence_sets'),
    to_regclass('public.prescription_review_revisions'),
    to_regclass('public.prescription_review_medicines'),
    to_regclass('public.prescription_review_events')
  )) THEN RAISE EXCEPTION 'prescription review objects already exist'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='prescriptions' AND column_name='user_id' AND data_type='uuid'
  ) THEN RAISE EXCEPTION 'prescriptions.user_id contract is missing'; END IF;
END $preflight$;

SELECT 'PRESCRIPTION_REVIEW_PREFLIGHT_OK' AS marker;
ROLLBACK;
