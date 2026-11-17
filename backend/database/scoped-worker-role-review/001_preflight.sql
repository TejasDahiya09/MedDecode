-- READ ONLY. Review only; no hosted changes are authorized by this file.
\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $check$
BEGIN
  IF current_database() <> 'postgres' OR current_user <> 'postgres' OR session_user <> 'postgres'
     OR current_setting('server_version_num')::integer / 10000 <> 17
     OR NOT EXISTS (SELECT FROM pg_roles WHERE rolname='postgres' AND rolcreaterole)
     OR to_regrole('meddecode_worker') IS NULL OR to_regrole('meddecode_worker_login') IS NULL
     OR to_regrole('meddecode_scoped_worker') IS NOT NULL OR to_regrole('meddecode_scoped_worker_login') IS NOT NULL
     OR to_regclass('public.meddecode_scoped_worker_scope') IS NOT NULL
     OR to_regprocedure('public.claim_next_prescription_analysis_job_v1(text,integer)') IS NULL
     OR to_regprocedure('public.recover_expired_prescription_analysis_jobs_v1(integer)') IS NULL
     OR EXISTS (SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'meddecode_scoped_%prescription_analysis_job%') THEN
    RAISE EXCEPTION 'role provisioning prerequisites not met';
  END IF;
END $check$;
SELECT 'SCOPED_ROLE_PREFLIGHT_OK';
ROLLBACK;
