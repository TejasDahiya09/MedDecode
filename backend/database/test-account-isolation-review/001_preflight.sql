-- READ ONLY. Project identity and TLS must be verified separately.
\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $guard$
BEGIN
 IF current_database()<>'postgres' OR current_user<>'postgres' OR session_user<>'postgres'
 OR to_regclass('public.meddecode_auto_test_account') IS NOT NULL
 OR NOT has_schema_privilege(current_user,'public','CREATE')
 OR EXISTS(SELECT FROM pg_proc p WHERE p.oid IN (to_regprocedure('public.submit_automatic_prescription_analysis_job_v1(uuid,jsonb)'),to_regprocedure('public.meddecode_scoped_authorize_next_automatic_job_v1(text)')) AND (NOT p.prosecdef OR pg_get_userbyid(p.proowner)<>'postgres' OR NOT EXISTS(SELECT FROM unnest(p.proconfig) c WHERE c IN ('search_path=""','search_path='))))
 OR has_function_privilege('anon','public.submit_automatic_prescription_analysis_job_v1(uuid,jsonb)','EXECUTE')
 OR has_function_privilege('authenticated','public.meddecode_scoped_authorize_next_automatic_job_v1(text)','EXECUTE')
 OR NOT EXISTS(SELECT FROM public.meddecode_auto_worker_policy WHERE singleton AND NOT enabled AND activated_at IS NULL AND worker_login='meddecode_auto_worker_login' AND worker_instance_id='meddecode-auto-worker-001' AND scope_seconds=1200)
 OR EXISTS(SELECT FROM public.meddecode_auto_authorized_jobs)
 OR EXISTS(SELECT FROM public.meddecode_scoped_worker_scope WHERE worker_login='meddecode_auto_worker_login')
 OR coalesce((SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public.submit_automatic_prescription_analysis_job_v1(uuid,jsonb)')),'')<>'4573ca78959c8bae04bbbd0bfefd4356'
 OR coalesce((SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public.meddecode_scoped_authorize_next_automatic_job_v1(text)')),'')<>'e34d4e74cc4861c3cc008de708201ec6'
 OR NOT EXISTS(SELECT FROM public.prescriptions p JOIN public.ai_jobs j ON j.prescription_id=p.id AND j.user_id=p.user_id JOIN auth.users u ON u.id=p.user_id WHERE p.id='9cde1d1a-e036-4c07-9f5f-cc8ec06930af' AND j.id='32e120ce-38bc-431b-b11f-0953c5b1b7e3' AND j.status='completed' AND p.user_id='9a1b7896-34cd-439b-9cfd-b26411086786')
 OR NOT EXISTS(SELECT FROM public.ai_jobs WHERE id='6eb659b6-b743-42c5-81c3-c7c5d108464e' AND status='queued' AND attempt_count=0 AND lease_owner IS NULL)
 THEN RAISE EXCEPTION 'test account isolation preflight failed'; END IF;
END $guard$;
SELECT 'TEST_ACCOUNT_ISOLATION_PREFLIGHT_OK';
ROLLBACK;
