\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $verify$ BEGIN
 IF to_regprocedure('public.meddecode_submit_confirmed_review_job_v1(text)') IS NULL
 OR to_regprocedure('public.meddecode_scoped_authorize_next_confirmed_review_job_v1(text)') IS NULL
 OR to_regprocedure('public.meddecode_load_confirmed_review_job_v1(uuid,uuid,uuid,text,text,bigint)') IS NULL
 OR to_regprocedure('public.meddecode_fail_review_job_v1(uuid,uuid,uuid,text,text,bigint,text)') IS NULL
 OR to_regprocedure('public.meddecode_scoped_authorize_next_v3_job_v1(text)') IS NULL
 OR has_function_privilege('anon','public.meddecode_submit_confirmed_review_job_v1(text)','EXECUTE')
 OR NOT has_function_privilege('authenticated','public.meddecode_submit_confirmed_review_job_v1(text)','EXECUTE')
 OR has_function_privilege('authenticated','public.meddecode_load_confirmed_review_job_v1(uuid,uuid,uuid,text,text,bigint)','EXECUTE')
 OR NOT has_function_privilege('meddecode_scoped_worker','public.meddecode_load_confirmed_review_job_v1(uuid,uuid,uuid,text,text,bigint)','EXECUTE')
 OR NOT has_function_privilege('meddecode_scoped_worker','public.meddecode_fail_review_job_v1(uuid,uuid,uuid,text,text,bigint,text)','EXECUTE')
 OR NOT has_function_privilege('meddecode_scoped_worker','public.meddecode_scoped_authorize_next_v3_job_v1(text)','EXECUTE')
 THEN RAISE EXCEPTION 'V3 worker verification failed'; END IF;
 RAISE NOTICE 'PRESCRIPTION_REVIEW_WORKER_VERIFY_OK';
END $verify$;
ROLLBACK;
