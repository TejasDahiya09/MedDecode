-- READ ONLY. Run against the verified project before any separately approved deployment.
\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $guard$
BEGIN
 IF current_database()<>'postgres' OR session_user<>'postgres' OR current_user<>'postgres'
 OR current_setting('server_version_num')::integer / 10000<>17
 OR NOT EXISTS (SELECT FROM pg_roles WHERE rolname='postgres' AND rolcreaterole AND NOT rolsuper)
 OR to_regrole('meddecode_auto_worker_login') IS NOT NULL
 OR to_regrole('meddecode_scoped_worker') IS NULL
 OR NOT EXISTS (SELECT FROM pg_auth_members WHERE roleid='meddecode_scoped_worker'::regrole AND member='postgres'::regrole AND admin_option AND NOT inherit_option AND NOT set_option)
 OR to_regclass('public.meddecode_scoped_worker_scope') IS NULL
 OR NOT EXISTS (SELECT FROM pg_class WHERE oid='public.meddecode_scoped_worker_scope'::regclass AND relrowsecurity)
 OR to_regclass('public.meddecode_auto_worker_policy') IS NOT NULL
 OR to_regclass('public.meddecode_auto_authorized_jobs') IS NOT NULL
 OR to_regprocedure('public.submit_automatic_prescription_analysis_job_v1(uuid,jsonb)') IS NOT NULL
 OR to_regprocedure('public.meddecode_scoped_authorize_next_automatic_job_v1(text)') IS NOT NULL
 OR to_regprocedure('public.submit_prescription_analysis_job_v1(uuid,jsonb)') IS NULL
 OR to_regprocedure('public.meddecode_scoped_claim_next_prescription_analysis_job_v1(text,integer)') IS NULL
 OR has_function_privilege('meddecode_scoped_worker','public.claim_next_prescription_analysis_job_v1(text,integer)','EXECUTE')
 OR has_function_privilege('meddecode_scoped_worker','public.recover_expired_prescription_analysis_jobs_v1(integer)','EXECUTE')
 THEN RAISE EXCEPTION 'automatic worker preflight failed'; END IF;
END $guard$;
SELECT 'AUTOMATIC_WORKER_PREFLIGHT_OK';
ROLLBACK;
