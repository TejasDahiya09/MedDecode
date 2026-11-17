-- REVIEW ONLY. No hosted activation without separate explicit approval.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $guard$
BEGIN
 IF current_database()<>'postgres' OR session_user<>'postgres' OR current_user<>'postgres'
 OR current_setting('server_version_num')::integer / 10000<>17
 OR to_regrole('meddecode_auto_worker_login') IS NULL
 OR NOT EXISTS (SELECT FROM pg_auth_members WHERE roleid='meddecode_scoped_worker'::regrole AND member='meddecode_auto_worker_login'::regrole AND set_option AND NOT inherit_option AND NOT admin_option)
 OR NOT EXISTS (SELECT FROM public.meddecode_auto_worker_policy WHERE singleton AND NOT enabled AND activated_at IS NULL AND worker_login='meddecode_auto_worker_login' AND worker_instance_id='meddecode-auto-worker-001' AND scope_seconds=1200)
 OR EXISTS (SELECT FROM public.meddecode_auto_authorized_jobs)
 OR EXISTS (SELECT FROM public.meddecode_scoped_worker_scope WHERE worker_login='meddecode_auto_worker_login' AND enabled)
 THEN RAISE EXCEPTION 'automatic activation preconditions failed'; END IF;
END $guard$;
UPDATE public.meddecode_auto_worker_policy SET enabled=true,activated_at=clock_timestamp() WHERE singleton;
DO $verify$ BEGIN
 IF NOT EXISTS (SELECT FROM public.meddecode_auto_worker_policy WHERE singleton AND enabled AND activated_at IS NOT NULL) THEN RAISE EXCEPTION 'automatic activation failed'; END IF;
END $verify$;
COMMIT;
