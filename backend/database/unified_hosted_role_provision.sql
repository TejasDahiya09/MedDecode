\set ON_ERROR_STOP on

-- Mutation stage. Execute only through the guarded operator script after
-- separate approval for both role names and secret provisioning.
-- Required psql variables:
--   python_reader_role
--   worker_group_role
--   worker_login_role
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

\if :{?python_reader_role}
\else
  SELECT 1 / 0 AS missing_python_reader_role;
\endif
\if :{?worker_group_role}
\else
  SELECT 1 / 0 AS missing_worker_group_role;
\endif
\if :{?worker_login_role}
\else
  SELECT 1 / 0 AS missing_worker_login_role;
\endif

SELECT set_config('meddecode.python_reader_role', :'python_reader_role', false),
       set_config('meddecode.worker_group_role', :'worker_group_role', false),
       set_config('meddecode.worker_login_role', :'worker_login_role', false);

DO $validate_names$
BEGIN
  IF current_setting('meddecode.python_reader_role') !~ '^[a-z][a-z0-9_]{2,62}$'
     OR current_setting('meddecode.worker_group_role') !~ '^[a-z][a-z0-9_]{2,62}$'
     OR current_setting('meddecode.worker_login_role') !~ '^[a-z][a-z0-9_]{2,62}$'
     OR current_setting('meddecode.python_reader_role') <> 'meddecode_catalogue_python_reader'
     OR current_setting('meddecode.worker_group_role') <> 'meddecode_worker'
     OR current_setting('meddecode.python_reader_role') IN ('postgres','service_role','anon','authenticated','meddecode_worker')
     OR current_setting('meddecode.worker_group_role') IN ('postgres','service_role','anon','authenticated')
     OR current_setting('meddecode.worker_login_role') IN ('postgres','service_role','anon','authenticated','meddecode_worker') THEN
    RAISE EXCEPTION 'role names are invalid or reserved';
  END IF;
END
$validate_names$;

DO $create_roles$
BEGIN
  IF to_regrole(current_setting('meddecode.python_reader_role')) IS NULL THEN
    EXECUTE format(
      'CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS',
      current_setting('meddecode.python_reader_role')
    );
  END IF;
  IF to_regrole(current_setting('meddecode.worker_group_role')) IS NULL THEN
    EXECUTE format(
      'CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS',
      current_setting('meddecode.worker_group_role')
    );
  END IF;
  IF to_regrole(current_setting('meddecode.worker_login_role')) IS NULL THEN
    EXECUTE format(
      'CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS',
      current_setting('meddecode.worker_login_role')
    );
  END IF;
END
$create_roles$;

DO $role_guard$
DECLARE
  v_role name;
BEGIN
  FOREACH v_role IN ARRAY ARRAY[
    current_setting('meddecode.python_reader_role')::name,
    current_setting('meddecode.worker_group_role')::name,
    current_setting('meddecode.worker_login_role')::name
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM pg_roles
      WHERE rolname = v_role
        AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit OR rolbypassrls)
    ) THEN
      RAISE EXCEPTION 'role has unsafe attributes: %', v_role;
    END IF;
  END LOOP;
  IF (SELECT rolcanlogin FROM pg_roles WHERE rolname = 'meddecode_catalogue_rpc_owner')
     OR NOT (SELECT rolcanlogin FROM pg_roles WHERE rolname = current_setting('meddecode.python_reader_role'))
     OR (SELECT rolcanlogin FROM pg_roles WHERE rolname = current_setting('meddecode.worker_group_role'))
     OR NOT (SELECT rolcanlogin FROM pg_roles WHERE rolname = current_setting('meddecode.worker_login_role')) THEN
    RAISE EXCEPTION 'role login attributes are incompatible';
  END IF;
END
$role_guard$;

GRANT USAGE ON SCHEMA official_catalogue
  TO :"python_reader_role";
GRANT SELECT (entity_id, evidence, identity)
  ON TABLE official_catalogue.catalogue_entities
  TO :"python_reader_role";

GRANT USAGE ON SCHEMA public TO :"worker_group_role";
GRANT :"worker_group_role" TO :"worker_login_role";

REVOKE CREATE ON SCHEMA public FROM :"worker_group_role";
REVOKE ALL ON TABLE public.ai_jobs FROM :"worker_group_role";
REVOKE ALL ON TABLE public.prescriptions FROM :"worker_group_role";
REVOKE ALL ON TABLE public.prescription_intelligence_results FROM :"worker_group_role";
REVOKE ALL ON TABLE public.prescription_medicines FROM :"worker_group_role";
REVOKE ALL ON TABLE public.prescription_medicine_alternatives FROM :"worker_group_role";
REVOKE ALL ON TABLE public.prescription_recommendations FROM :"worker_group_role";
REVOKE ALL ON TABLE public.prescription_warnings FROM :"worker_group_role";

COMMIT;
