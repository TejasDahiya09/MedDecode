\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $preflight$
DECLARE
  item record;
BEGIN
  IF current_user <> 'postgres' OR session_user <> 'postgres' THEN
    RAISE EXCEPTION 'migration must execute directly as postgres';
  END IF;
  IF to_regrole('authenticated') IS NULL
     OR to_regrole('anon') IS NULL
     OR to_regrole('meddecode_catalogue_rpc_owner') IS NULL
     OR to_regprocedure('public.meddecode_catalogue_request_uid()') IS NULL
     OR to_regprocedure('pg_catalog.trim_scale(numeric)') IS NULL
     OR to_regprocedure('public.meddecode_official_catalogue_page_v1(text,text,integer,integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'required catalogue roles or functions are missing, or target function already exists';
  END IF;
  IF NOT has_schema_privilege(current_user, 'public', 'CREATE')
     OR has_schema_privilege('meddecode_catalogue_rpc_owner', 'public', 'CREATE')
     OR NOT has_schema_privilege('meddecode_catalogue_rpc_owner', 'official_catalogue', 'USAGE')
     OR NOT has_function_privilege(
       'meddecode_catalogue_rpc_owner',
       'public.meddecode_catalogue_request_uid()',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'catalogue RPC owner privileges are incompatible';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'meddecode_catalogue_rpc_owner'
      AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
      AND NOT rolcanlogin AND NOT rolinherit AND NOT rolbypassrls AND NOT rolreplication
  ) THEN
    RAISE EXCEPTION 'restricted catalogue RPC owner role is not safe for function ownership';
  END IF;

  FOR item IN
    SELECT * FROM (VALUES
      ('catalogue_entities', 'entity_id'),
      ('catalogue_entities', 'source_record_id'),
      ('catalogue_entities', 'entity_type'),
      ('catalogue_entities', 'evidence'),
      ('formulations', 'formulation_id'),
      ('formulations', 'source_record_id'),
      ('formulations', 'canonical_name'),
      ('formulations', 'dosage_form'),
      ('formulation_ingredients', 'formulation_id'),
      ('formulation_ingredients', 'ingredient_id'),
      ('formulation_ingredients', 'strength_value'),
      ('formulation_ingredients', 'strength_unit'),
      ('ingredients', 'ingredient_id'),
      ('ingredients', 'normalized_name'),
      ('ingredients', 'display_name'),
      ('source_records', 'source_record_id'),
      ('source_records', 'release_id'),
      ('releases', 'release_id'),
      ('releases', 'source_key')
    ) AS required(table_name, column_name)
  LOOP
    IF NOT has_column_privilege(
      'meddecode_catalogue_rpc_owner',
      format('official_catalogue.%I', item.table_name)::regclass,
      item.column_name,
      'SELECT'
    ) THEN
      RAISE EXCEPTION 'restricted RPC owner lacks required SELECT privilege on %.%',
        item.table_name, item.column_name;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'official_catalogue'
      AND c.relname IN (
        'catalogue_entities', 'formulations', 'formulation_ingredients',
        'ingredients', 'source_records', 'releases'
      )
      AND (c.relrowsecurity OR c.relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'official catalogue RLS state is incompatible with the restricted RPC owner';
  END IF;
  IF has_schema_privilege('anon', 'official_catalogue', 'USAGE')
     OR has_schema_privilege('authenticated', 'official_catalogue', 'USAGE')
     OR EXISTS (
       SELECT 1
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'official_catalogue'
         AND c.relname IN (
           'catalogue_entities', 'formulations', 'formulation_ingredients',
           'ingredients', 'source_records', 'releases'
         )
         AND (has_table_privilege('anon', c.oid, 'SELECT')
           OR has_table_privilege('authenticated', c.oid, 'SELECT')
           OR has_any_column_privilege('anon', c.oid, 'SELECT')
           OR has_any_column_privilege('authenticated', c.oid, 'SELECT'))
     ) THEN
    RAISE EXCEPTION 'client roles have direct access to official catalogue tables';
  END IF;
END
$preflight$;
COMMIT;
