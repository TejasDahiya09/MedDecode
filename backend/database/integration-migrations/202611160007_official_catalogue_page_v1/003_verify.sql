\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $verify$
DECLARE
  f regprocedure := 'public.meddecode_official_catalogue_page_v1(text,text,integer,integer)'::regprocedure;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'meddecode_catalogue_rpc_owner'
      AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
      AND NOT rolcanlogin AND NOT rolinherit AND NOT rolbypassrls AND NOT rolreplication
  ) THEN
    RAISE EXCEPTION 'restricted catalogue RPC owner role is invalid';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    WHERE p.oid = 'public.meddecode_catalogue_request_uid()'::regprocedure
      AND p.prosecdef
      AND p.proowner = 'postgres'::regrole
      AND p.proconfig @> ARRAY['search_path=""']
  )
     OR NOT has_function_privilege(
       'meddecode_catalogue_rpc_owner',
       'public.meddecode_catalogue_request_uid()',
       'EXECUTE'
     )
     OR has_function_privilege('anon', 'public.meddecode_catalogue_request_uid()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.meddecode_catalogue_request_uid()', 'EXECUTE')
     OR EXISTS (
       SELECT 1
       FROM pg_proc p,
            LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
       WHERE p.oid = 'public.meddecode_catalogue_request_uid()'::regprocedure
         AND acl.grantee = 0
         AND acl.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'catalogue auth wrapper ownership, search_path, or EXECUTE ACL is invalid';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    WHERE p.oid = f
      AND p.prosecdef
      AND p.proowner = 'meddecode_catalogue_rpc_owner'::regrole
      AND p.proconfig @> ARRAY['search_path=""']
  )
     OR NOT has_function_privilege('authenticated', f, 'EXECUTE')
     OR has_function_privilege('anon', f, 'EXECUTE')
     OR EXISTS (
       SELECT 1
       FROM pg_proc p,
            LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
       WHERE p.oid = f
         AND acl.grantee = 0
         AND acl.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'official catalogue page RPC owner, search_path, or EXECUTE ACL invalid';
  END IF;
  IF has_schema_privilege('meddecode_catalogue_rpc_owner', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'restricted catalogue RPC owner retained temporary CREATE privilege';
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
    RAISE EXCEPTION 'official catalogue RLS state changed from the verified RPC baseline';
  END IF;
  IF pg_get_function_result(f) <> 'jsonb' THEN
    RAISE EXCEPTION 'official catalogue page RPC result shape changed';
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
  IF has_column_privilege(
       'meddecode_catalogue_rpc_owner',
       'official_catalogue.source_records',
       'original_payload',
       'SELECT'
     )
     OR has_column_privilege(
       'meddecode_catalogue_rpc_owner',
       'official_catalogue.catalogue_entities',
       'identity_hash',
       'SELECT'
     ) THEN
    RAISE EXCEPTION 'restricted RPC owner can read unneeded source payload or identity hash';
  END IF;
END
$verify$;
COMMIT;
