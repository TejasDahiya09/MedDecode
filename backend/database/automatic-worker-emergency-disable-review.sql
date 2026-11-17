-- REVIEW ONLY. Emergency hosted execution requires explicit authorization.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $guard$
BEGIN
  IF current_user <> 'postgres' OR session_user <> 'postgres'
    OR to_regclass('public.meddecode_auto_worker_policy') IS NULL
    OR to_regclass('public.meddecode_scoped_worker_scope') IS NULL
    OR NOT EXISTS (SELECT FROM public.meddecode_auto_worker_policy WHERE singleton AND worker_login='meddecode_auto_worker_login')
  THEN RAISE EXCEPTION 'automatic shutdown preconditions failed'; END IF;
END $guard$;
UPDATE public.meddecode_auto_worker_policy SET enabled=false WHERE singleton AND worker_login='meddecode_auto_worker_login';
UPDATE public.meddecode_scoped_worker_scope SET enabled=false WHERE worker_login='meddecode_auto_worker_login' AND enabled;
DO $verify$ BEGIN
 IF EXISTS (SELECT FROM public.meddecode_auto_worker_policy WHERE singleton AND enabled)
   OR EXISTS (SELECT FROM public.meddecode_scoped_worker_scope WHERE worker_login='meddecode_auto_worker_login' AND enabled)
 THEN RAISE EXCEPTION 'automatic shutdown verification failed'; END IF;
END $verify$;
COMMIT;
