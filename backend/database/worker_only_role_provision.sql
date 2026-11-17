\set ON_ERROR_STOP on
-- REVIEW CANDIDATE ONLY. Hosted execution requires explicit approval.
-- Creates worker identities only; no catalogue-reader grants or passwords.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $guard$
BEGIN
  IF current_user <> 'postgres' OR session_user <> 'postgres'
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='postgres' AND (rolcreaterole OR rolsuper)) THEN
    RAISE EXCEPTION 'expected direct postgres migration identity';
  END IF;
  IF to_regrole('meddecode_worker') IS NOT NULL OR to_regrole('meddecode_worker_login') IS NOT NULL THEN
    RAISE EXCEPTION 'worker role already exists; stop for review';
  END IF;
END $guard$;
CREATE ROLE meddecode_worker NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE meddecode_worker_login LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT meddecode_worker TO meddecode_worker_login WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
DO $verify$
DECLARE r text; t text;
BEGIN
  FOREACH r IN ARRAY ARRAY['meddecode_worker','meddecode_worker_login'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolreplication OR rolbypassrls)) THEN
      RAISE EXCEPTION 'worker role attributes unsafe';
    END IF;
    FOREACH t IN ARRAY ARRAY['ai_jobs','prescriptions','prescription_intelligence_results','prescription_medicines','prescription_medicine_alternatives','prescription_recommendations','prescription_warnings'] LOOP
      IF to_regclass('public.'||t) IS NULL OR has_table_privilege(r, to_regclass('public.'||t), 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
        OR has_any_column_privilege(r, to_regclass('public.'||t), 'SELECT,INSERT,UPDATE,REFERENCES') THEN
        RAISE EXCEPTION 'worker direct application-table access exists or table missing';
      END IF;
    END LOOP;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE roleid='meddecode_worker'::regrole AND member='meddecode_worker_login'::regrole AND set_option AND NOT inherit_option AND NOT admin_option)
     OR EXISTS (SELECT 1 FROM pg_auth_members WHERE roleid='meddecode_worker'::regrole AND member='meddecode_worker_login'::regrole AND (NOT set_option OR inherit_option OR admin_option)) THEN
    RAISE EXCEPTION 'worker membership invalid';
  END IF;
END $verify$;
COMMIT;
