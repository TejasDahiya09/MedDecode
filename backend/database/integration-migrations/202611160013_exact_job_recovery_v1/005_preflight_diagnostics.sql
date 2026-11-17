\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';
WITH functions(signature,expected_hash) AS (VALUES
 ('public.meddecode_initialize_prescription_review_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb)','64a180563d00dfd5373756dbc33b2c359583738a8361521914badef034050930'),
 ('public.meddecode_scoped_claim_next_prescription_analysis_job_v1(text,integer)','73d680941b284635b17e793f1db1f02efdcc47c86b69f81426c7e43143de6b2f'),
 ('public.meddecode_scoped_recover_expired_prescription_analysis_jobs_v1(integer)','35c25a1e9cdd0fd70355412155b5f0784885444c69cd915987610fe3639502e8'),
 ('public.meddecode_scoped_authorize_next_automatic_job_v1(text)','4c2196da5ac99a181159ae826e3e999a5470260dbf5ee45a1402820892bf0b56')
), existing AS (
 SELECT f.*,p.oid,p.prosrc,p.prosecdef,r.rolname FROM functions f LEFT JOIN pg_proc p ON p.oid=to_regprocedure(f.signature) LEFT JOIN pg_roles r ON r.oid=p.proowner
), checks(check_name,expected,actual,passed,category) AS (
 VALUES
 ('session_user','postgres',session_user::text,session_user='postgres','authorization'),
 ('current_user','postgres',current_user::text,current_user='postgres','authorization'),
 ('permit_table_absent','absent',coalesce(to_regclass('public.meddecode_exact_job_retry_permits')::text,'absent'),to_regclass('public.meddecode_exact_job_retry_permits') IS NULL,'schema drift'),
 ('initial_completion_present','present',CASE WHEN to_regprocedure('public.meddecode_complete_initial_review_job_v1(uuid,uuid,text,integer,bigint)') IS NULL THEN 'absent' ELSE 'present' END,to_regprocedure('public.meddecode_complete_initial_review_job_v1(uuid,uuid,text,integer,bigint)') IS NOT NULL,'schema drift'),
 ('test_account_table_present','present',CASE WHEN to_regclass('public.meddecode_auto_test_account') IS NULL THEN 'absent' ELSE 'present' END,to_regclass('public.meddecode_auto_test_account') IS NOT NULL,'schema drift'),
 ('current_generation_2','matching singleton row',coalesce((SELECT current_rollout_generation::text FROM public.meddecode_auto_worker_policy WHERE singleton),'absent'),EXISTS(SELECT 1 FROM public.meddecode_auto_worker_policy WHERE singleton AND current_rollout_generation=2),'authorization'),
 ('authorize_retry_rpc_absent','absent',coalesce(to_regprocedure('public.meddecode_authorize_exact_job_retry_v1(uuid,uuid,integer,bigint)')::text,'absent'),to_regprocedure('public.meddecode_authorize_exact_job_retry_v1(uuid,uuid,integer,bigint)') IS NULL,'schema drift'),
 ('recover_claim_rpc_absent','absent',coalesce(to_regprocedure('public.meddecode_recover_claim_exact_job_v1(uuid,uuid,uuid,text,integer)')::text,'absent'),to_regprocedure('public.meddecode_recover_claim_exact_job_v1(uuid,uuid,uuid,text,integer)') IS NULL,'schema drift'),
 ('retry_core_absent','absent',coalesce(to_regprocedure('public.meddecode_initialize_retry_review_core_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb)')::text,'absent'),to_regprocedure('public.meddecode_initialize_retry_review_core_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb)') IS NULL,'schema drift'),
 ('fenced_initializer_absent','absent',coalesce(to_regprocedure('public.meddecode_initialize_exact_retry_review_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb,text,integer,bigint,uuid)')::text,'absent'),to_regprocedure('public.meddecode_initialize_exact_retry_review_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb,text,integer,bigint,uuid)') IS NULL,'schema drift')
 UNION ALL SELECT 'source_hash:'||signature,expected_hash,coalesce(encode(sha256(convert_to(replace(prosrc,E'\\r',''),'UTF8')),'hex'),'absent'),encode(sha256(convert_to(replace(prosrc,E'\\r',''),'UTF8')),'hex') IS NOT DISTINCT FROM expected_hash,'schema drift / source assumption' FROM existing
 UNION ALL SELECT 'base_owner_security_aggregate','0 invalid owners/security modes',count(*)::text||' invalid owners/security modes',count(*)=0,'authorization / ownership assumption' FROM existing WHERE oid IS NOT NULL AND (rolname<>'postgres' OR NOT prosecdef)
)
SELECT check_name,expected,actual,CASE WHEN passed THEN 'PASS' ELSE 'FAIL' END AS result,category FROM checks ORDER BY check_name;

SELECT p.oid::regprocedure::text AS signature,r.rolname AS owner,p.prosecdef AS security_definer,p.proconfig AS configuration,
 encode(sha256(convert_to(replace(p.prosrc,E'\\r',''),'UTF8')),'hex') AS exact_preflight_source_hash,
 encode(sha256(convert_to(replace(p.prosrc,chr(13),''),'UTF8')),'hex') AS cr_normalized_source_hash
 FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid IN (
 to_regprocedure('public.meddecode_initialize_prescription_review_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb)'),
 to_regprocedure('public.meddecode_scoped_claim_next_prescription_analysis_job_v1(text,integer)'),
 to_regprocedure('public.meddecode_scoped_recover_expired_prescription_analysis_jobs_v1(integer)'),
 to_regprocedure('public.meddecode_scoped_authorize_next_automatic_job_v1(text)')) ORDER BY signature;

SELECT current_database(),session_user,current_user,clock_timestamp();
SELECT enabled,current_rollout_generation,(SELECT count(*) FROM public.meddecode_auto_authorized_jobs WHERE rollout_generation=1) AS generation_1_admissions,(SELECT count(*) FROM public.meddecode_auto_authorized_jobs WHERE rollout_generation=2) AS generation_2_admissions FROM public.meddecode_auto_worker_policy WHERE singleton;
SELECT j.status,j.attempt_count,j.max_attempts,j.claim_generation,j.lease_expires_at<clock_timestamp() AS lease_expired,s.expires_at<clock_timestamp() AS scope_expired,p.user_id=j.user_id AS owner_lineage_matches,EXISTS(SELECT 1 FROM public.meddecode_auto_test_account t WHERE t.singleton AND t.user_id=j.user_id) AS owner_allowlisted FROM public.ai_jobs j JOIN public.prescriptions p ON p.id=j.prescription_id LEFT JOIN public.meddecode_scoped_worker_scope s ON s.job_id=j.id WHERE j.id='51c6cffd-ac79-4eaa-bc6d-851f20c2abab' AND j.prescription_id='2bb56f2d-df83-4132-95a4-b9552fa48dd8';
SELECT (SELECT count(*) FROM public.prescriptions) AS prescriptions,(SELECT count(*) FROM public.ai_jobs) AS jobs,(SELECT count(*) FROM public.prescription_intelligence_results) AS results,(SELECT count(*) FROM public.prescription_review_revisions) AS reviews,(SELECT count(*) FROM pg_stat_activity WHERE usename IN ('meddecode_auto_worker_login','meddecode_scoped_worker_login','meddecode_worker_login')) AS worker_sessions;
ROLLBACK;
