-- READ ONLY. Run after approved role and disabled migration deployment.
\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $guard$
DECLARE r record;
BEGIN
 IF current_database()<>'postgres' OR session_user<>'postgres'
 OR to_regrole('meddecode_auto_worker_login') IS NULL
 OR to_regclass('public.meddecode_auto_worker_policy') IS NULL
 OR to_regclass('public.meddecode_auto_authorized_jobs') IS NULL
 OR NOT EXISTS (SELECT FROM pg_auth_members WHERE roleid='meddecode_scoped_worker'::regrole AND member='meddecode_auto_worker_login'::regrole AND set_option AND NOT inherit_option AND NOT admin_option)
 OR NOT EXISTS (SELECT FROM public.meddecode_auto_worker_policy WHERE singleton AND NOT enabled AND activated_at IS NULL AND worker_login='meddecode_auto_worker_login' AND worker_instance_id='meddecode-auto-worker-001')
 OR EXISTS (SELECT FROM public.meddecode_auto_authorized_jobs)
 OR EXISTS (SELECT FROM public.meddecode_scoped_worker_scope WHERE worker_login='meddecode_auto_worker_login' AND enabled)
 OR EXISTS (SELECT FROM pg_class WHERE oid IN ('public.meddecode_auto_worker_policy'::regclass,'public.meddecode_auto_authorized_jobs'::regclass) AND NOT relrowsecurity)
 OR has_table_privilege('authenticated','public.meddecode_auto_authorized_jobs','SELECT')
 OR has_table_privilege('meddecode_scoped_worker','public.meddecode_auto_authorized_jobs','SELECT')
 OR NOT has_function_privilege('authenticated','public.submit_automatic_prescription_analysis_job_v1(uuid,jsonb)','EXECUTE')
 OR has_function_privilege('anon','public.submit_automatic_prescription_analysis_job_v1(uuid,jsonb)','EXECUTE')
 OR NOT has_function_privilege('meddecode_scoped_worker','public.meddecode_scoped_authorize_next_automatic_job_v1(text)','EXECUTE')
 OR has_function_privilege('authenticated','public.meddecode_scoped_authorize_next_automatic_job_v1(text)','EXECUTE')
 OR has_function_privilege('anon','public.meddecode_scoped_authorize_next_automatic_job_v1(text)','EXECUTE')
 OR has_function_privilege('meddecode_scoped_worker','public.claim_next_prescription_analysis_job_v1(text,integer)','EXECUTE')
 THEN RAISE EXCEPTION 'automatic worker verification failed'; END IF;
 FOR r IN SELECT p.prosecdef,pg_get_userbyid(p.proowner) owner,p.proconfig FROM pg_proc p WHERE p.oid IN ('public.submit_automatic_prescription_analysis_job_v1(uuid,jsonb)'::regprocedure,'public.meddecode_scoped_authorize_next_automatic_job_v1(text)'::regprocedure) LOOP
  IF NOT r.prosecdef OR r.owner<>'postgres' OR NOT EXISTS (SELECT FROM unnest(r.proconfig) c WHERE c IN ('search_path=""','search_path=')) THEN RAISE EXCEPTION 'automatic function owner or search path invalid'; END IF;
 END LOOP;
END $guard$;
SELECT 'AUTOMATIC_WORKER_VERIFY_OK';
ROLLBACK;
