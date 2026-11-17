-- REVIEW ONLY. Requires separate authorization; stop workers first.
-- Only for rollback of the role-only stage, before scoped migration or use.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='5s';
DO $guard$
BEGIN
  IF current_database() <> 'postgres' OR session_user <> 'postgres'
     OR to_regrole('meddecode_scoped_worker') IS NULL OR to_regrole('meddecode_scoped_worker_login') IS NULL
     OR to_regclass('public.meddecode_scoped_worker_scope') IS NOT NULL
     OR EXISTS (SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'meddecode_scoped_%prescription_analysis_job%')
     OR EXISTS (SELECT FROM pg_stat_activity WHERE usename='meddecode_scoped_worker_login') THEN
    RAISE EXCEPTION 'rollback unsafe: scoped objects or active login present';
  END IF;
END $guard$;
REVOKE meddecode_scoped_worker FROM meddecode_scoped_worker_login;
DROP ROLE meddecode_scoped_worker_login;
DROP ROLE meddecode_scoped_worker;
COMMIT;
