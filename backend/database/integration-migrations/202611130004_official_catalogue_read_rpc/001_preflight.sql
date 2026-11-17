\set ON_ERROR_STOP on
-- Read-only schema, identity, and privilege checks. No rows are modified.
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
     OR to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'Supabase role or auth.uid() prerequisite missing';
  END IF;
  IF to_regrole('meddecode_catalogue_rpc_owner') IS NOT NULL THEN
    RAISE EXCEPTION 'catalogue RPC owner role already exists; inspect before proceeding';
  END IF;
  IF to_regprocedure('public.meddecode_official_catalogue_search_v1(text,integer,integer)') IS NOT NULL
     OR to_regprocedure('public.meddecode_official_catalogue_detail_v1(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'official catalogue RPC name already exists';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = current_user AND (rolsuper OR rolcreaterole)
  ) OR NOT has_schema_privilege(current_user, 'public', 'CREATE') THEN
    RAISE EXCEPTION 'migration role cannot provision the restricted RPC owner';
  END IF;
  IF NOT has_schema_privilege(current_user, 'auth', 'USAGE')
     OR NOT has_function_privilege(current_user, 'auth.uid()', 'EXECUTE') THEN
    RAISE EXCEPTION 'migration role cannot verify the auth.uid() dependency';
  END IF;
  IF to_regnamespace('official_catalogue') IS NULL THEN
    RAISE EXCEPTION 'official_catalogue schema is missing';
  END IF;

  FOR item IN
    SELECT * FROM (VALUES
      ('catalogue_entities', 'entity_id', 'uuid'),
      ('catalogue_entities', 'source_record_id', 'uuid'),
      ('catalogue_entities', 'entity_type', 'text'),
      ('catalogue_entities', 'evidence', 'jsonb'),
      ('formulations', 'formulation_id', 'uuid'),
      ('formulations', 'source_record_id', 'uuid'),
      ('formulations', 'canonical_name', 'text'),
      ('formulations', 'dosage_form', 'text'),
      ('formulation_ingredients', 'formulation_id', 'uuid'),
      ('formulation_ingredients', 'ingredient_id', 'uuid'),
      ('formulation_ingredients', 'strength_value', 'numeric'),
      ('formulation_ingredients', 'strength_unit', 'text'),
      ('ingredients', 'ingredient_id', 'uuid'),
      ('ingredients', 'normalized_name', 'text'),
      ('ingredients', 'display_name', 'text'),
      ('source_records', 'source_record_id', 'uuid'),
      ('source_records', 'release_id', 'uuid'),
      ('releases', 'release_id', 'uuid'),
      ('releases', 'source_key', 'text')
    ) AS required(table_name, column_name, type_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
      WHERE n.nspname = 'official_catalogue'
        AND c.relname = item.table_name
        AND c.relkind IN ('r', 'p')
        AND a.attname = item.column_name
        AND a.attnum > 0
        AND NOT a.attisdropped
        AND a.atttypid = to_regtype(item.type_name)
    ) THEN
      RAISE EXCEPTION 'official catalogue prerequisite missing or incompatible: %.%',
        item.table_name, item.column_name;
    END IF;
  END LOOP;

  FOR item IN
    SELECT * FROM (VALUES
      ('catalogue_entities', 'catalogue_entities_source_record_id_fkey', 'source_records'),
      ('formulations', 'formulations_source_record_id_fkey', 'source_records'),
      ('formulation_ingredients', 'formulation_ingredients_formulation_id_fkey', 'formulations'),
      ('formulation_ingredients', 'formulation_ingredients_ingredient_id_fkey', 'ingredients'),
      ('source_records', 'source_records_release_id_fkey', 'releases')
    ) AS required(table_name, constraint_name, referenced_table)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint c
      WHERE c.conrelid = to_regclass(format('official_catalogue.%I', item.table_name))
        AND c.conname = item.constraint_name
        AND c.contype = 'f'
        AND c.confrelid = to_regclass(format('official_catalogue.%I', item.referenced_table))
    ) THEN
      RAISE EXCEPTION 'official catalogue relationship missing or incompatible: %',
        item.constraint_name;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM official_catalogue.formulations f
    LEFT JOIN official_catalogue.catalogue_entities e
      ON e.entity_id = f.formulation_id
     AND e.source_record_id = f.source_record_id
     AND e.entity_type = 'formulation'
    WHERE e.entity_id IS NULL
  ) THEN
    RAISE EXCEPTION 'formulation/entity UUID or source-record relationship is inconsistent';
  END IF;

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
     OR has_schema_privilege('authenticated', 'official_catalogue', 'USAGE') THEN
    RAISE EXCEPTION 'client roles have direct official_catalogue schema access';
  END IF;
  IF EXISTS (
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
    RAISE EXCEPTION 'client roles have direct SELECT on official catalogue tables';
  END IF;
END
$preflight$;
COMMIT;
