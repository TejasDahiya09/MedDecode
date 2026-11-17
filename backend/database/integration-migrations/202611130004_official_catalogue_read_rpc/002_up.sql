\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE ROLE meddecode_catalogue_rpc_owner
  NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;

-- PostgreSQL 17 gives a non-superuser creator an immutable bootstrap ADMIN
-- membership without SET. Add a distinct grant owned by the migration actor;
-- only that temporary grant is removed after creating the RPCs.
GRANT meddecode_catalogue_rpc_owner TO CURRENT_USER
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY CURRENT_USER;

CREATE FUNCTION public.meddecode_catalogue_request_uid()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT auth.uid();
$function$;
ALTER FUNCTION public.meddecode_catalogue_request_uid() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.meddecode_catalogue_request_uid() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meddecode_catalogue_request_uid()
  TO meddecode_catalogue_rpc_owner;

GRANT USAGE ON SCHEMA official_catalogue TO meddecode_catalogue_rpc_owner;
GRANT SELECT (entity_id, source_record_id, entity_type, evidence)
  ON TABLE official_catalogue.catalogue_entities TO meddecode_catalogue_rpc_owner;
GRANT SELECT (formulation_id, source_record_id, canonical_name, dosage_form)
  ON TABLE official_catalogue.formulations TO meddecode_catalogue_rpc_owner;
GRANT SELECT (formulation_id, ingredient_id, strength_value, strength_unit)
  ON TABLE official_catalogue.formulation_ingredients TO meddecode_catalogue_rpc_owner;
GRANT SELECT (ingredient_id, normalized_name, display_name)
  ON TABLE official_catalogue.ingredients TO meddecode_catalogue_rpc_owner;
GRANT SELECT (source_record_id, release_id)
  ON TABLE official_catalogue.source_records TO meddecode_catalogue_rpc_owner;
GRANT SELECT (release_id, source_key)
  ON TABLE official_catalogue.releases TO meddecode_catalogue_rpc_owner;

DO $auth_dependency$
BEGIN
  IF NOT has_function_privilege(
       'meddecode_catalogue_rpc_owner',
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
    RAISE EXCEPTION
      'restricted RPC owner auth dependency is not isolated through the locked-down wrapper';
  END IF;
END
$auth_dependency$;

-- CREATE is temporary so the non-login role can own the public RPCs.
GRANT CREATE ON SCHEMA public TO meddecode_catalogue_rpc_owner;
SET LOCAL ROLE meddecode_catalogue_rpc_owner;

CREATE FUNCTION public.meddecode_official_catalogue_search_v1(
  p_query text, p_limit integer, p_offset integer
)
RETURNS TABLE (
  id uuid,
  canonical_name text,
  generic_name text,
  brand_name text,
  dosage_form text,
  strength_value numeric,
  strength_unit text,
  manufacturer_name text,
  catalogue_source text,
  id_namespace text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_query text;
BEGIN
  IF public.meddecode_catalogue_request_uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication required';
  END IF;
  IF p_query IS NULL
     OR length(btrim(p_query)) NOT BETWEEN 2 AND 80
     OR position(chr(37) IN p_query) > 0
     OR position(chr(95) IN p_query) > 0
     OR position(chr(92) IN p_query) > 0
     OR p_query ~ '[[:cntrl:]]'
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 51
     OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 500 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid catalogue query';
  END IF;

  v_query := lower(btrim(p_query));
  RETURN QUERY
  SELECT
    f.formulation_id,
    COALESCE(f.canonical_name, e.evidence->>'canonical_name'),
    NULLIF(e.evidence->>'generic_name', ''),
    NULLIF(e.evidence->>'brand_name', ''),
    COALESCE(f.dosage_form, e.evidence->>'dosage_form'),
    CASE WHEN component.component_count = 1 THEN component.strength_value END,
    CASE WHEN component.component_count = 1 THEN component.strength_unit END,
    NULL::text,
    'official_catalogue'::text,
    'official_catalogue.formulation_id'::text
  FROM official_catalogue.catalogue_entities e
  JOIN official_catalogue.formulations f
    ON f.formulation_id = e.entity_id
   AND f.source_record_id = e.source_record_id
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS component_count,
           max(fi.strength_value) AS strength_value,
           max(fi.strength_unit) AS strength_unit
    FROM official_catalogue.formulation_ingredients fi
    WHERE fi.formulation_id = f.formulation_id
  ) component ON true
  WHERE e.entity_type = 'formulation'
    AND (
      lower(COALESCE(e.evidence->>'normalized_name', '')) LIKE '%' || v_query || '%'
      OR lower(COALESCE(f.canonical_name, e.evidence->>'canonical_name', '')) LIKE '%' || v_query || '%'
      OR lower(COALESCE(e.evidence->>'generic_name', '')) LIKE '%' || v_query || '%'
      OR lower(COALESCE(e.evidence->>'brand_name', '')) LIKE '%' || v_query || '%'
    )
  ORDER BY COALESCE(f.canonical_name, e.evidence->>'canonical_name'), f.formulation_id
  LIMIT p_limit OFFSET p_offset;
END
$function$;

CREATE FUNCTION public.meddecode_official_catalogue_detail_v1(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF public.meddecode_catalogue_request_uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication required';
  END IF;
  IF p_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid formulation id';
  END IF;

  SELECT jsonb_build_object(
    'id', f.formulation_id,
    'catalogue_source', 'official_catalogue',
    'id_namespace', 'official_catalogue.formulation_id',
    'canonical_name', COALESCE(f.canonical_name, e.evidence->>'canonical_name'),
    'generic_name', NULLIF(e.evidence->>'generic_name', ''),
    'brand_name', NULLIF(e.evidence->>'brand_name', ''),
    'dosage_form', COALESCE(f.dosage_form, e.evidence->>'dosage_form'),
    'strength_value', CASE WHEN component.component_count = 1 THEN component.strength_value END,
    'strength_unit', CASE WHEN component.component_count = 1 THEN component.strength_unit END,
    'manufacturer_name', NULL::text,
    'ingredients', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'name', i.display_name,
        'strength_value', fi.strength_value,
        'strength_unit', fi.strength_unit
      ) ORDER BY i.normalized_name, i.ingredient_id)
      FROM official_catalogue.formulation_ingredients fi
      JOIN official_catalogue.ingredients i ON i.ingredient_id = fi.ingredient_id
      WHERE fi.formulation_id = f.formulation_id
    ), '[]'::jsonb),
    'aliases', '[]'::jsonb,
    'sources', COALESCE((
      SELECT jsonb_agg(source_row.source_key ORDER BY source_row.source_key)
      FROM (
        SELECT DISTINCT r.source_key
        FROM official_catalogue.source_records sr
        JOIN official_catalogue.releases r ON r.release_id = sr.release_id
        WHERE sr.source_record_id = f.source_record_id
      ) source_row
    ), '[]'::jsonb),
    'prices', '[]'::jsonb
  )
  INTO v_result
  FROM official_catalogue.formulations f
  JOIN official_catalogue.catalogue_entities e
    ON e.entity_id = f.formulation_id
   AND e.source_record_id = f.source_record_id
   AND e.entity_type = 'formulation'
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS component_count,
           max(fi.strength_value) AS strength_value,
           max(fi.strength_unit) AS strength_unit
    FROM official_catalogue.formulation_ingredients fi
    WHERE fi.formulation_id = f.formulation_id
  ) component ON true
  WHERE f.formulation_id = p_id;

  RETURN v_result;
END
$function$;

-- The non-superuser migration actor cannot change an RPC owner's ACL after
-- resetting role. Lock down and grant the functions while acting as owner.
REVOKE ALL ON FUNCTION public.meddecode_official_catalogue_search_v1(text, integer, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.meddecode_official_catalogue_detail_v1(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meddecode_official_catalogue_search_v1(text, integer, integer)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.meddecode_official_catalogue_detail_v1(uuid)
  TO authenticated;

RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM meddecode_catalogue_rpc_owner;
REVOKE meddecode_catalogue_rpc_owner FROM CURRENT_USER GRANTED BY CURRENT_USER;

DO $membership_guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members m
    WHERE (m.roleid = 'meddecode_catalogue_rpc_owner'::regrole
           OR m.member = 'meddecode_catalogue_rpc_owner'::regrole)
      AND NOT (m.roleid = 'meddecode_catalogue_rpc_owner'::regrole
        AND m.member = 'postgres'::regrole AND m.grantor = 10
        AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option)
  ) OR (
    NOT (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = 'postgres')
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_auth_members m
      WHERE m.roleid = 'meddecode_catalogue_rpc_owner'::regrole
        AND m.member = 'postgres'::regrole AND m.grantor = 10
        AND m.admin_option AND NOT m.inherit_option AND NOT m.set_option
    )
  ) THEN
    RAISE EXCEPTION 'unexpected catalogue RPC owner role membership';
  END IF;
END
$membership_guard$;

COMMIT;
