\set ON_ERROR_STOP on
BEGIN;
SET TRANSACTION READ ONLY;
DO $verify$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='prescription_intelligence_results'
    AND column_name='is_current' AND data_type='boolean' AND is_nullable='NO') THEN RAISE EXCEPTION 'current marker missing'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='prescription_intelligence_results_one_current_uq'
    AND indexdef LIKE '%UNIQUE INDEX%' AND indexdef LIKE '%WHERE is_current%') THEN RAISE EXCEPTION 'current uniqueness missing'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='prescription_intelligence_results_job_uq'
    AND indexdef LIKE '%UNIQUE INDEX%') THEN RAISE EXCEPTION 'job idempotency missing'; END IF;
  IF NOT has_function_privilege('authenticated','public.meddecode_get_current_prescription_result_v1(uuid)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.meddecode_list_prescription_result_history_v1(uuid)','EXECUTE')
     OR has_function_privilege('anon','public.meddecode_get_current_prescription_result_v1(uuid)','EXECUTE')
     OR has_function_privilege('anon','public.meddecode_list_prescription_result_history_v1(uuid)','EXECUTE') THEN RAISE EXCEPTION 'reader ACL unsafe'; END IF;
  IF NOT has_function_privilege('meddecode_scoped_worker','public.meddecode_finalize_review_result_v1(uuid,uuid,uuid,text,text,bigint,jsonb)','EXECUTE')
     OR has_function_privilege('authenticated','public.meddecode_finalize_review_result_v1(uuid,uuid,uuid,text,text,bigint,jsonb)','EXECUTE')
     OR has_function_privilege('anon','public.meddecode_finalize_review_result_v1(uuid,uuid,uuid,text,text,bigint,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'finalizer ACL unsafe'; END IF;
  IF EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('meddecode_get_current_prescription_result_v1',
      'meddecode_list_prescription_result_history_v1','meddecode_finalize_review_result_v1')
      AND (NOT p.prosecdef OR pg_get_userbyid(p.proowner)<>'postgres'
        OR NOT ('search_path=pg_catalog, public'=ANY(COALESCE(p.proconfig,'{}'::text[]))))) THEN
    RAISE EXCEPTION 'result-history function security is unsafe';
  END IF;
END $verify$;
SELECT 'PRESCRIPTION_RESULT_HISTORY_VERIFY_OK' AS marker;
ROLLBACK;
