\set ON_ERROR_STOP on
BEGIN;
SET TRANSACTION READ ONLY;

DO $verify$
DECLARE t text; f text;
BEGIN
  FOREACH t IN ARRAY ARRAY['prescription_ocr_evidence_sets','prescription_review_revisions','prescription_review_medicines','prescription_review_events'] LOOP
    IF to_regclass('public.'||t) IS NULL THEN RAISE EXCEPTION 'missing table %', t; END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass('public.'||t)) THEN RAISE EXCEPTION 'RLS disabled on %', t; END IF;
    IF has_table_privilege('anon', 'public.'||t, 'SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'anon privilege on %', t; END IF;
    IF has_table_privilege('authenticated', 'public.'||t, 'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER') THEN RAISE EXCEPTION 'authenticated mutation privilege on %', t; END IF;
  END LOOP;
  IF NOT has_column_privilege('authenticated','public.prescription_ocr_evidence_sets','id','SELECT')
     OR has_column_privilege('authenticated','public.prescription_ocr_evidence_sets','evidence_payload','SELECT') THEN
    RAISE EXCEPTION 'evidence column privileges are unsafe';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='prescription_review_revisions' AND policyname='prescription_review_revisions_select_own') THEN
    RAISE EXCEPTION 'revision ownership policy missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='prescription_intelligence_results' AND column_name='review_revision_id') THEN
    RAISE EXCEPTION 'result revision binding missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.prescription_intelligence_results'::regclass
      AND tgname='prescription_result_review_fence' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'result review fence missing';
  END IF;
  FOREACH f IN ARRAY ARRAY[
    'meddecode_has_owned_prescription_review_v1(uuid)',
    'meddecode_get_prescription_review_v1(uuid)',
    'meddecode_list_prescription_review_revisions_v1(uuid)',
    'meddecode_get_prescription_review_evidence_v1(uuid)',
    'meddecode_get_review_intelligence_request_v1(uuid)',
    'meddecode_apply_prescription_review_draft_v1(uuid,uuid,integer,bigint,jsonb,jsonb,jsonb)',
    'meddecode_confirm_prescription_review_v1(uuid,uuid,integer,bigint,jsonb,jsonb,jsonb,jsonb)',
    'meddecode_reopen_prescription_review_v1(uuid,uuid,integer,bigint,jsonb,jsonb,jsonb)'
  ] LOOP
    IF to_regprocedure('public.'||f) IS NULL THEN RAISE EXCEPTION 'missing RPC %', f; END IF;
    IF NOT has_function_privilege('authenticated','public.'||f,'EXECUTE')
       OR has_function_privilege('anon','public.'||f,'EXECUTE') THEN RAISE EXCEPTION 'unsafe authenticated RPC ACL %', f; END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY[
    'meddecode_initialize_prescription_review_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb)',
    'meddecode_bind_review_intelligence_job_v1(text,uuid)',
    'meddecode_assert_current_review_result_v1(uuid,uuid,text,uuid)'
  ] LOOP
    IF to_regprocedure('public.'||f) IS NULL THEN RAISE EXCEPTION 'missing worker RPC %', f; END IF;
    IF has_function_privilege('authenticated','public.'||f,'EXECUTE')
       OR has_function_privilege('anon','public.'||f,'EXECUTE') THEN RAISE EXCEPTION 'unsafe worker RPC ACL %', f; END IF;
    IF to_regrole('meddecode_scoped_worker') IS NOT NULL
       AND NOT has_function_privilege('meddecode_scoped_worker','public.'||f,'EXECUTE') THEN RAISE EXCEPTION 'worker RPC grant missing %', f; END IF;
  END LOOP;
  IF has_function_privilege('authenticated','public.meddecode_fence_review_result_v1()','EXECUTE')
     OR has_function_privilege('anon','public.meddecode_fence_review_result_v1()','EXECUTE') THEN
    RAISE EXCEPTION 'trigger function is callable';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname LIKE 'meddecode_%review%_v1'
      AND NOT p.prosecdef
  ) THEN RAISE EXCEPTION 'review function is not security definer'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname LIKE 'meddecode_%review%_v1'
      AND pg_get_userbyid(p.proowner) <> 'postgres'
  ) THEN RAISE EXCEPTION 'review function owner is unsafe'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname LIKE 'meddecode_%review%_v1'
      AND NOT ('search_path=pg_catalog, public'=ANY(COALESCE(p.proconfig,'{}'::text[])))
  ) THEN RAISE EXCEPTION 'review function search_path is unsafe'; END IF;
  IF to_regrole('meddecode_scoped_worker') IS NOT NULL AND EXISTS (
    SELECT 1 FROM unnest(ARRAY['prescription_ocr_evidence_sets','prescription_review_revisions','prescription_review_medicines','prescription_review_events']) x(name)
    WHERE has_table_privilege('meddecode_scoped_worker','public.'||x.name,'SELECT,INSERT,UPDATE,DELETE')
  ) THEN RAISE EXCEPTION 'worker has direct review table access'; END IF;
END $verify$;

SELECT 'PRESCRIPTION_REVIEW_VERIFY_OK' AS marker;
ROLLBACK;
