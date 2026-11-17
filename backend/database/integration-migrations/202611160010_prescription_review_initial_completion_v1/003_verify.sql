\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $verify$
BEGIN
  IF to_regprocedure('public.meddecode_complete_initial_review_job_v1(uuid,uuid,text,integer,bigint)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='public.prescription_ocr_evidence_sets'::regclass AND attname='initial_processing_job_id' AND NOT attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid='public.meddecode_complete_initial_review_job_v1(uuid,uuid,text,integer,bigint)'::regprocedure AND r.rolname='postgres' AND p.prosecdef AND p.proconfig @> ARRAY['search_path=pg_catalog, public'])
     OR has_function_privilege('anon','public.meddecode_complete_initial_review_job_v1(uuid,uuid,text,integer,bigint)','EXECUTE')
     OR has_function_privilege('authenticated','public.meddecode_complete_initial_review_job_v1(uuid,uuid,text,integer,bigint)','EXECUTE')
     OR NOT has_function_privilege('meddecode_scoped_worker','public.meddecode_complete_initial_review_job_v1(uuid,uuid,text,integer,bigint)','EXECUTE')
     OR has_table_privilege('meddecode_scoped_worker','public.prescription_ocr_evidence_sets','UPDATE')
  THEN RAISE EXCEPTION 'initial review completion verification failed'; END IF;
END $verify$;
SELECT 'PRESCRIPTION_REVIEW_INITIAL_COMPLETION_VERIFY_OK';
ROLLBACK;
