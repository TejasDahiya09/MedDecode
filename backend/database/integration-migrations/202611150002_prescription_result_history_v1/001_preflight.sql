\set ON_ERROR_STOP on
BEGIN;
SET TRANSACTION READ ONLY;
DO $preflight$
DECLARE v_unique_count integer;
BEGIN
  IF current_database()<>'postgres' OR current_user<>'postgres' THEN RAISE EXCEPTION 'unexpected deployment identity'; END IF;
  IF to_regclass('public.prescription_intelligence_results') IS NULL OR to_regclass('public.prescription_review_revisions') IS NULL
     OR to_regclass('public.ai_jobs') IS NULL OR to_regclass('public.prescriptions') IS NULL THEN RAISE EXCEPTION 'required dependencies missing'; END IF;
  IF to_regrole('authenticated') IS NULL OR to_regrole('anon') IS NULL OR to_regrole('meddecode_scoped_worker') IS NULL THEN RAISE EXCEPTION 'required roles missing'; END IF;
  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='prescription_intelligence_results' AND column_name='is_current')
     OR to_regprocedure('public.meddecode_finalize_review_result_v1(uuid,uuid,uuid,text,text,bigint,jsonb)') IS NOT NULL THEN RAISE EXCEPTION 'already installed'; END IF;
  IF EXISTS(SELECT 1 FROM public.prescription_intelligence_results GROUP BY job_id HAVING count(*)>1) THEN RAISE EXCEPTION 'duplicate job lineage'; END IF;
  IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
      AND table_name='prescription_intelligence_results' AND column_name='created_at') THEN
    RAISE EXCEPTION 'result creation timestamp is missing';
  END IF;
  SELECT count(*) INTO v_unique_count FROM pg_constraint c WHERE c.conrelid='public.prescription_intelligence_results'::regclass AND c.contype='u'
    AND (SELECT array_agg(a.attname ORDER BY k.ord) FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ord)
      JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum)=ARRAY['prescription_id']::name[];
  IF v_unique_count<>1 THEN RAISE EXCEPTION 'expected prescription-only unique constraint'; END IF;
END $preflight$;
SELECT 'PRESCRIPTION_RESULT_HISTORY_PREFLIGHT_OK' AS marker;
ROLLBACK;
