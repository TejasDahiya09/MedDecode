-- REVIEW ONLY. Do not run on hosted Supabase without separate approval.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='5s';
DO $guard$
BEGIN
 IF current_database()<>'postgres' OR current_user<>'postgres' OR session_user<>'postgres'
 OR EXISTS(SELECT FROM public.meddecode_auto_authorized_jobs WHERE rollout_generation=2)
 OR EXISTS(SELECT FROM public.meddecode_scoped_worker_scope WHERE worker_login='meddecode_auto_worker_login' AND enabled)
 THEN RAISE EXCEPTION 'rollout generation rollback is unsafe'; END IF;
END $guard$;
-- Restoring the exact predecessor RPC bodies is required before any DDL rollback.
ROLLBACK;
