-- READ ONLY. No test account is enrolled by this verification.
\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $guard$
BEGIN
 IF current_database()<>'postgres' OR session_user<>'postgres'
 OR to_regclass('public.meddecode_auto_test_account') IS NULL
 OR NOT EXISTS(SELECT FROM pg_class WHERE oid='public.meddecode_auto_test_account'::regclass AND relrowsecurity)
 OR EXISTS(SELECT FROM public.meddecode_auto_test_account)
 OR EXISTS(SELECT FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid='public.meddecode_auto_test_account'::regclass AND a.grantee<>c.relowner)
 OR has_table_privilege('authenticated','public.meddecode_auto_test_account','SELECT')
 OR has_table_privilege('meddecode_scoped_worker','public.meddecode_auto_test_account','SELECT')
 OR (CASE WHEN to_regrole('service_role') IS NULL THEN false ELSE has_table_privilege('service_role','public.meddecode_auto_test_account','SELECT') END)
 OR NOT EXISTS(SELECT FROM public.meddecode_auto_worker_policy WHERE singleton AND NOT enabled AND activated_at IS NULL)
 OR EXISTS(SELECT FROM public.meddecode_auto_authorized_jobs)
 OR EXISTS(SELECT FROM public.meddecode_scoped_worker_scope WHERE worker_login='meddecode_auto_worker_login')
 OR coalesce((SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public.submit_automatic_prescription_analysis_job_v1(uuid,jsonb)')),'')<>'1ab13e9295f1c93ccb5ced918e85ed18'
 OR coalesce((SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public.meddecode_scoped_authorize_next_automatic_job_v1(text)')),'')<>'c6862244fa25935392995d5ac0760d77'
 OR EXISTS(SELECT FROM pg_proc p WHERE p.oid IN (to_regprocedure('public.submit_automatic_prescription_analysis_job_v1(uuid,jsonb)'),to_regprocedure('public.meddecode_scoped_authorize_next_automatic_job_v1(text)')) AND (NOT p.prosecdef OR pg_get_userbyid(p.proowner)<>'postgres' OR NOT EXISTS(SELECT FROM unnest(p.proconfig) c WHERE c IN ('search_path=""','search_path='))))
 OR NOT has_function_privilege('authenticated','public.submit_automatic_prescription_analysis_job_v1(uuid,jsonb)','EXECUTE')
 OR has_function_privilege('anon','public.submit_automatic_prescription_analysis_job_v1(uuid,jsonb)','EXECUTE')
 OR NOT has_function_privilege('meddecode_scoped_worker','public.meddecode_scoped_authorize_next_automatic_job_v1(text)','EXECUTE')
 OR has_function_privilege('authenticated','public.meddecode_scoped_authorize_next_automatic_job_v1(text)','EXECUTE')
 OR has_function_privilege('anon','public.meddecode_scoped_authorize_next_automatic_job_v1(text)','EXECUTE')
 THEN RAISE EXCEPTION 'test account isolation verification failed'; END IF;
END $guard$;
SELECT 'TEST_ACCOUNT_ISOLATION_VERIFY_OK';
ROLLBACK;