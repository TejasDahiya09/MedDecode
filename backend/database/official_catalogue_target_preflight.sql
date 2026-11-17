\set ON_ERROR_STOP on
BEGIN READ ONLY;

SELECT current_database() AS database_name,
       current_user AS migration_role,
       current_setting('server_version') AS server_version,
       to_regclass('public.medicines') AS legacy_medicines,
       to_regnamespace('official_catalogue') AS official_catalogue_schema;

DO $preflight$
DECLARE
  v_legacy_count bigint;
BEGIN
  IF current_database() IN (
    'meddecode_job_test',
    'meddecode_worker_test',
    'meddecode_backup_restore_test',
    'meddecode_catalogue_rpc_test'
  ) THEN
    RAISE EXCEPTION 'Refusing to use a protected local or isolated test database as the hosted target';
  END IF;
  IF to_regclass('public.medicines') IS NULL THEN
    RAISE EXCEPTION 'Legacy public.medicines is missing; verify the target before deployment';
  END IF;
  SELECT count(*) INTO v_legacy_count FROM public.medicines;
  IF v_legacy_count <> 238 THEN
    RAISE EXCEPTION 'Legacy public.medicines baseline drifted: observed %, expected 238', v_legacy_count;
  END IF;
  IF to_regnamespace('official_catalogue') IS NOT NULL THEN
    RAISE EXCEPTION 'official_catalogue already exists; inspect its contents and migration history';
  END IF;
  IF to_regrole('anon') IS NULL
     OR to_regrole('authenticated') IS NULL
     OR to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'Supabase roles or auth.uid() are missing';
  END IF;
  IF to_regrole('meddecode_catalogue_rpc_owner') IS NOT NULL
     OR to_regprocedure('public.meddecode_official_catalogue_search_v1(text,integer,integer)') IS NOT NULL
     OR to_regprocedure('public.meddecode_official_catalogue_detail_v1(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'Official catalogue RPC objects already exist; inspect before proceeding';
  END IF;
  IF NOT has_database_privilege(current_user, current_database(), 'CREATE')
     OR NOT EXISTS (
       SELECT 1
       FROM pg_roles
       WHERE rolname = current_user
         AND (rolsuper OR rolcreaterole)
     )
     OR NOT has_schema_privilege(current_user, 'public', 'CREATE') THEN
    RAISE EXCEPTION 'Migration role lacks the required schema/role provisioning privileges';
  END IF;
  IF NOT has_schema_privilege(current_user, 'auth', 'USAGE')
     OR NOT has_function_privilege(current_user, 'auth.uid()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration role cannot use or verify the managed auth.uid() dependency';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_namespace n
    WHERE n.nspname = 'public'
      AND (
        pg_has_role(current_user, n.nspowner, 'USAGE')
        OR EXISTS (
          SELECT 1
          FROM pg_roles r
          WHERE r.rolname = current_user
            AND r.rolsuper
        )
      )
  ) THEN
    RAISE EXCEPTION 'Migration role cannot grant and revoke temporary CREATE on public';
  END IF;
END
$preflight$;

COMMIT;
