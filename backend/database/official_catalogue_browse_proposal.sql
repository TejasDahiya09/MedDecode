-- REVIEW DRAFT ONLY. Do not deploy: this file has not been executed or audited.
-- Proposed new read-only RPC, to be created as the existing restricted
-- meddecode_catalogue_rpc_owner after separately reviewed temporary SET/CREATE
-- privileges. No catalogue rows, existing functions or policies are changed.
-- Preflight must verify the owner, wrapper and column grants, authenticated/anon
-- roles, and absence of this signature. Revoke temporary privileges afterward.
CREATE FUNCTION public.meddecode_official_catalogue_browse_v1(p_limit integer, p_offset integer)
RETURNS TABLE (
  id uuid, canonical_name text, generic_name text, brand_name text,
  dosage_form text, strength_value numeric, strength_unit text,
  manufacturer_name text, catalogue_source text, id_namespace text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  IF public.meddecode_catalogue_request_uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication required';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 51
     OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 10000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid catalogue page';
  END IF;
  RETURN QUERY
  SELECT f.formulation_id,
         COALESCE(f.canonical_name, e.evidence->>'canonical_name'),
         NULLIF(e.evidence->>'generic_name', ''),
         NULLIF(e.evidence->>'brand_name', ''),
         COALESCE(f.dosage_form, e.evidence->>'dosage_form'),
         CASE WHEN component.component_count = 1 THEN component.strength_value END,
         CASE WHEN component.component_count = 1 THEN component.strength_unit END,
         NULL::text, 'official_catalogue'::text, 'official_catalogue.formulation_id'::text
  FROM official_catalogue.catalogue_entities e
  JOIN official_catalogue.formulations f
    ON f.formulation_id = e.entity_id AND f.source_record_id = e.source_record_id
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS component_count,
           max(fi.strength_value) AS strength_value, max(fi.strength_unit) AS strength_unit
    FROM official_catalogue.formulation_ingredients fi WHERE fi.formulation_id = f.formulation_id
  ) component ON true
  WHERE e.entity_type = 'formulation'
  ORDER BY COALESCE(f.canonical_name, e.evidence->>'canonical_name'), f.formulation_id
  LIMIT p_limit OFFSET p_offset;
END
$function$;
REVOKE ALL ON FUNCTION public.meddecode_official_catalogue_browse_v1(integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meddecode_official_catalogue_browse_v1(integer, integer)
  TO authenticated;
-- Separate review must cover stable ranked search before LIMIT/OFFSET, tie-breaking
-- by formulation UUID, indexing/latency, role setup and teardown, ACLs, rollback,
-- database-backed privilege tests, and a compatible backend browse endpoint.
