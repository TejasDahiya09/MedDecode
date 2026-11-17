-- REVIEW ONLY. Requires separate hosted approval; only before any scope/job admission.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $guard$
BEGIN
 IF current_database()<>'postgres' OR current_user<>'postgres' OR session_user<>'postgres'
 OR to_regrole('meddecode_auto_worker_login') IS NULL
 OR to_regclass('public.meddecode_auto_worker_policy') IS NULL
 OR to_regclass('public.meddecode_auto_authorized_jobs') IS NULL
 OR NOT EXISTS(SELECT FROM public.meddecode_auto_worker_policy WHERE singleton AND NOT enabled AND activated_at IS NULL AND worker_login='meddecode_auto_worker_login')
 OR EXISTS(SELECT FROM public.meddecode_auto_authorized_jobs)
 OR EXISTS(SELECT FROM public.meddecode_scoped_worker_scope WHERE worker_login='meddecode_auto_worker_login')
 THEN RAISE EXCEPTION 'automatic worker rollback guard failed'; END IF;
END $guard$;
DROP FUNCTION public.meddecode_scoped_authorize_next_automatic_job_v1(text);
DROP FUNCTION public.submit_automatic_prescription_analysis_job_v1(uuid,jsonb);
DROP TABLE public.meddecode_auto_authorized_jobs;
DROP TABLE public.meddecode_auto_worker_policy;
DROP ROLE meddecode_auto_worker_login;
DO $verify$
BEGIN
 IF to_regrole('meddecode_auto_worker_login') IS NOT NULL
 OR to_regclass('public.meddecode_auto_worker_policy') IS NOT NULL
 OR to_regclass('public.meddecode_auto_authorized_jobs') IS NOT NULL
 OR to_regprocedure('public.meddecode_scoped_authorize_next_automatic_job_v1(text)') IS NOT NULL
 OR to_regprocedure('public.submit_automatic_prescription_analysis_job_v1(uuid,jsonb)') IS NOT NULL
 THEN RAISE EXCEPTION 'automatic worker rollback verification failed'; END IF;
END $verify$;
COMMIT;
