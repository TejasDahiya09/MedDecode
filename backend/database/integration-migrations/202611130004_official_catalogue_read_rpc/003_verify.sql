\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $verify$
DECLARE
  f regprocedure;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'meddecode_catalogue_rpc_owner'
      AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
      AND NOT rolcanlogin AND NOT rolinherit AND NOT rolbypassrls AND NOT rolreplication
  ) THEN
    RAISE EXCEPTION 'restricted catalogue RPC owner role is invalid';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_auth_members
    WHERE (roleid = 'meddecode_catalogue_rpc_owner'::regrole
       OR member = 'meddecode_catalogue_rpc_owner'::regrole)
      AND NOT (roleid = 'meddecode_catalogue_rpc_owner'::regrole
        AND member = 'postgres'::regrole AND grantor = 10
        AND admin_option AND NOT inherit_option AND NOT set_option)
  ) OR (
    NOT (SELECT rolsuper FROM pg_roles WHERE rolname = 'postgres')
    AND NOT EXISTS (
      SELECT 1 FROM pg_auth_members
      WHERE roleid = 'meddecode_catalogue_rpc_owner'::regrole
        AND member = 'postgres'::regrole AND grantor = 10
        AND admin_option AND NOT inherit_option AND NOT set_option
    )
  ) THEN
    RAISE EXCEPTION 'catalogue RPC owner has unexpected role membership';
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
     OR has_function_privilege(
       'public',
       'public.meddecode_catalogue_request_uid()',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.meddecode_catalogue_request_uid()',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.meddecode_catalogue_request_uid()',
       'EXECUTE'
     )
     OR EXISTS (
       SELECT 1
       FROM pg_namespace n
       CROSS JOIN LATERAL aclexplode(
         COALESCE(n.nspacl, acldefault('n', n.nspowner))
       ) acl
       WHERE n.nspname = 'auth'
         AND acl.grantee = 'meddecode_catalogue_rpc_owner'::regrole
         AND acl.privilege_type = 'USAGE'
     )
     OR EXISTS (
       SELECT 1
       FROM pg_proc p
       CROSS JOIN LATERAL aclexplode(
         COALESCE(p.proacl, acldefault('f', p.proowner))
       ) acl
       WHERE p.oid = 'auth.uid()'::regprocedure
         AND acl.grantee = 'meddecode_catalogue_rpc_owner'::regrole
         AND acl.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'restricted RPC owner auth dependency is not isolated through the locked-down wrapper';
  END IF;

  FOREACH f IN ARRAY ARRAY[
    'public.meddecode_official_catalogue_search_v1(text,integer,integer)'::regprocedure,
    'public.meddecode_official_catalogue_detail_v1(uuid)'::regprocedure
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p
      WHERE p.oid = f
        AND p.prosecdef
        AND p.proowner = 'meddecode_catalogue_rpc_owner'::regrole
        AND p.proconfig @> ARRAY['search_path=""']
    ) OR NOT has_function_privilege('authenticated', f, 'EXECUTE')
      OR has_function_privilege('anon', f, 'EXECUTE')
      OR EXISTS (
        SELECT 1
        FROM pg_proc p,
             LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
        WHERE p.oid = f
          AND acl.grantee = 0
          AND acl.privilege_type = 'EXECUTE'
      ) THEN
      RAISE EXCEPTION 'official catalogue RPC owner, search_path, or EXECUTE ACL invalid: %', f;
    END IF;
  END LOOP;

  IF pg_get_function_result(
       'public.meddecode_official_catalogue_search_v1(text,integer,integer)'::regprocedure
     ) <> 'TABLE(id uuid, canonical_name text, generic_name text, brand_name text, dosage_form text, strength_value numeric, strength_unit text, manufacturer_name text, catalogue_source text, id_namespace text)'
     OR pg_get_function_result(
       'public.meddecode_official_catalogue_detail_v1(uuid)'::regprocedure
     ) <> 'jsonb' THEN
    RAISE EXCEPTION 'official catalogue RPC result shape changed';
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
    RAISE EXCEPTION 'client roles have direct official catalogue access';
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
    RAISE EXCEPTION 'official catalogue RLS state differs from the verified RPC baseline';
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
  IF has_column_privilege(
       'meddecode_catalogue_rpc_owner',
       'official_catalogue.catalogue_entities',
       'identity',
       'SELECT'
     )
     OR has_column_privilege(
       'meddecode_catalogue_rpc_owner',
       'official_catalogue.formulations',
       'evidence',
       'SELECT'
     )
     OR has_column_privilege(
       'meddecode_catalogue_rpc_owner',
       'official_catalogue.price_observations',
       'price',
       'SELECT'
     )
     OR has_column_privilege(
       'meddecode_catalogue_rpc_owner',
       'official_catalogue.products',
       'manufacturer_name',
       'SELECT'
     ) THEN
    RAISE EXCEPTION 'restricted RPC owner has unexpected catalogue field privileges';
  END IF;
END
$verify$;
COMMIT;
