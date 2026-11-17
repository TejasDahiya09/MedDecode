\set ON_ERROR_STOP on
\if :{?meddecode_expected_database}
\else
\set meddecode_expected_database postgres
\endif
BEGIN READ ONLY;
SELECT set_config('meddecode.expected_database', :'meddecode_expected_database', true);
DO $preflight$ BEGIN
 IF current_database()<>current_setting('meddecode.expected_database')
 OR to_regprocedure('public.meddecode_initialize_prescription_review_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb)') IS NULL
 OR to_regprocedure('public.meddecode_finalize_review_result_v1(uuid,uuid,uuid,text,text,bigint,jsonb)') IS NULL
 OR to_regprocedure('public.meddecode_scoped_authorize_next_automatic_job_v1(text)') IS NULL
 OR to_regclass('public.meddecode_auto_authorized_jobs') IS NULL
 OR to_regclass('public.meddecode_auto_test_account') IS NULL
 OR to_regrole('meddecode_scoped_worker') IS NULL
 OR to_regprocedure('public.meddecode_submit_confirmed_review_job_v1(text)') IS NOT NULL
 OR to_regprocedure('public.meddecode_fail_review_job_v1(uuid,uuid,uuid,text,text,bigint,text)') IS NOT NULL
 THEN RAISE EXCEPTION 'V3 worker preflight failed'; END IF;
 RAISE NOTICE 'PRESCRIPTION_REVIEW_WORKER_PREFLIGHT_OK';
END $preflight$;
ROLLBACK;
