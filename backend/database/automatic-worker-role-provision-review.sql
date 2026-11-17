-- REVIEW ONLY. Hosted execution requires separate explicit approval.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $guard$
BEGIN
  IF current_user <> 'postgres' OR session_user <> 'postgres'
    OR current_setting('server_version_num')::integer / 10000 <> 17
    OR to_regrole('meddecode_auto_worker_login') IS NOT NULL
    OR to_regrole('meddecode_scoped_worker') IS NULL
    OR NOT EXISTS (SELECT FROM pg_auth_members WHERE roleid='meddecode_scoped_worker'::regrole AND member='postgres'::regrole AND admin_option AND NOT inherit_option AND NOT set_option)
  THEN RAISE EXCEPTION 'automatic worker role preconditions failed'; END IF;
END $guard$;
CREATE ROLE meddecode_auto_worker_login LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT meddecode_scoped_worker TO meddecode_auto_worker_login WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
DO $verify$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='meddecode_auto_worker_login' AND rolcanlogin AND NOT (rolsuper OR rolinherit OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls))
    OR NOT EXISTS (SELECT FROM pg_auth_members WHERE roleid='meddecode_scoped_worker'::regrole AND member='meddecode_auto_worker_login'::regrole AND set_option AND NOT inherit_option AND NOT admin_option)
    OR EXISTS (SELECT FROM pg_auth_members WHERE member='meddecode_auto_worker_login'::regrole AND roleid<>'meddecode_scoped_worker'::regrole)
    OR EXISTS (SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p(priv) WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f') AND (has_table_privilege('meddecode_auto_worker_login',c.oid,p.priv) OR (p.priv IN ('SELECT','INSERT','UPDATE','REFERENCES') AND has_any_column_privilege('meddecode_auto_worker_login',c.oid,p.priv))))
    OR has_function_privilege('meddecode_auto_worker_login','public.claim_next_prescription_analysis_job_v1(text,integer)','EXECUTE')
    OR has_function_privilege('meddecode_auto_worker_login','public.recover_expired_prescription_analysis_jobs_v1(integer)','EXECUTE')
  THEN RAISE EXCEPTION 'automatic worker role verification failed'; END IF;
END $verify$;
COMMIT;
