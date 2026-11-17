\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';
DO $guard$
BEGIN
 IF session_user <> 'postgres' OR current_user <> 'postgres'
 OR to_regclass('public.meddecode_exact_job_retry_permits') IS NOT NULL
 OR to_regprocedure('public.meddecode_complete_initial_review_job_v1(uuid,uuid,text,integer,bigint)') IS NULL
 OR to_regclass('public.meddecode_auto_test_account') IS NULL
 OR NOT EXISTS (SELECT 1 FROM public.meddecode_auto_worker_policy WHERE singleton AND current_rollout_generation=2)
 OR (SELECT encode(sha256(convert_to(replace(prosrc,E'\r',''),'UTF8')),'hex') FROM pg_proc
     WHERE oid=to_regprocedure('public.meddecode_initialize_prescription_review_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb)')) IS DISTINCT FROM 'INITIALIZER_SOURCE_SHA256'
 OR (SELECT encode(sha256(convert_to(replace(prosrc,E'\r',''),'UTF8')),'hex') FROM pg_proc
     WHERE oid=to_regprocedure('public.meddecode_scoped_claim_next_prescription_analysis_job_v1(text,integer)')) IS DISTINCT FROM 'CLAIM_SOURCE_SHA256'
 OR (SELECT encode(sha256(convert_to(replace(prosrc,E'\r',''),'UTF8')),'hex') FROM pg_proc
     WHERE oid=to_regprocedure('public.meddecode_scoped_recover_expired_prescription_analysis_jobs_v1(integer)')) IS DISTINCT FROM 'RECOVERY_SOURCE_SHA256'
 OR (SELECT encode(sha256(convert_to(replace(prosrc,E'\r',''),'UTF8')),'hex') FROM pg_proc
     WHERE oid=to_regprocedure('public.meddecode_scoped_authorize_next_automatic_job_v1(text)')) IS DISTINCT FROM 'ISSUER_SOURCE_SHA256'
 OR to_regprocedure('public.meddecode_authorize_exact_job_retry_v1(uuid,uuid,integer,bigint)') IS NOT NULL
 OR to_regprocedure('public.meddecode_recover_claim_exact_job_v1(uuid,uuid,uuid,text,integer)') IS NOT NULL
 OR to_regprocedure('public.meddecode_initialize_retry_review_core_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb)') IS NOT NULL
 OR to_regprocedure('public.meddecode_initialize_exact_retry_review_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb,text,integer,bigint,uuid)') IS NOT NULL
 OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid IN (
    to_regprocedure('public.meddecode_initialize_prescription_review_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb)'),
    to_regprocedure('public.meddecode_scoped_claim_next_prescription_analysis_job_v1(text,integer)'),
    to_regprocedure('public.meddecode_scoped_recover_expired_prescription_analysis_jobs_v1(integer)'),
    to_regprocedure('public.meddecode_scoped_authorize_next_automatic_job_v1(text)')) AND (r.rolname<>'postgres' OR NOT p.prosecdef))
 THEN RAISE EXCEPTION 'exact retry deployment preflight failed'; END IF;
END $guard$;
SELECT 'EXACT_JOB_RETRY_PREFLIGHT_OK';
ROLLBACK;
