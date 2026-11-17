\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
GRANT meddecode_catalogue_rpc_owner TO CURRENT_USER WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY CURRENT_USER;
GRANT CREATE ON SCHEMA public TO meddecode_catalogue_rpc_owner;
SET LOCAL ROLE meddecode_catalogue_rpc_owner;
CREATE FUNCTION public.meddecode_official_catalogue_browse_v2(p_limit integer, p_offset integer, p_form text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_total bigint; v_items jsonb;
BEGIN
  IF public.meddecode_catalogue_request_uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='authentication required';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 10000
     OR (p_form IS NOT NULL AND (length(p_form) NOT BETWEEN 1 AND 40 OR p_form !~ '^[[:alpha:] -]+$')) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid catalogue page';
  END IF;
  SELECT count(*) INTO v_total FROM official_catalogue.catalogue_entities e
  JOIN official_catalogue.formulations f ON f.formulation_id=e.entity_id AND f.source_record_id=e.source_record_id
  WHERE e.entity_type='formulation' AND (p_form IS NULL OR lower(coalesce(f.dosage_form,e.evidence->>'dosage_form','')) = lower(p_form));
  SELECT coalesce(jsonb_agg(to_jsonb(page) ORDER BY page.canonical_name, page.id), '[]'::jsonb) INTO v_items FROM (
    SELECT f.formulation_id AS id, COALESCE(f.canonical_name,e.evidence->>'canonical_name') AS canonical_name,
      NULLIF(e.evidence->>'generic_name','') AS generic_name, NULLIF(e.evidence->>'brand_name','') AS brand_name,
      COALESCE(f.dosage_form,e.evidence->>'dosage_form') AS dosage_form,
      CASE WHEN component.component_count=1 THEN component.strength_value END AS strength_value,
      CASE WHEN component.component_count=1 THEN component.strength_unit END AS strength_unit,
      NULL::text AS manufacturer_name, 'official_catalogue'::text AS catalogue_source,
      'official_catalogue.formulation_id'::text AS id_namespace
    FROM official_catalogue.catalogue_entities e
    JOIN official_catalogue.formulations f ON f.formulation_id=e.entity_id AND f.source_record_id=e.source_record_id
    LEFT JOIN LATERAL (SELECT count(*)::integer AS component_count, max(fi.strength_value) AS strength_value,
      max(fi.strength_unit) AS strength_unit FROM official_catalogue.formulation_ingredients fi WHERE fi.formulation_id=f.formulation_id) component ON true
    WHERE e.entity_type='formulation' AND (p_form IS NULL OR lower(coalesce(f.dosage_form,e.evidence->>'dosage_form','')) = lower(p_form))
    ORDER BY canonical_name, id LIMIT p_limit OFFSET p_offset
  ) page;
  RETURN jsonb_build_object('items',v_items,'total',v_total);
END $function$;
REVOKE ALL ON FUNCTION public.meddecode_official_catalogue_browse_v2(integer,integer,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meddecode_official_catalogue_browse_v2(integer,integer,text) TO authenticated;


RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM meddecode_catalogue_rpc_owner;
REVOKE meddecode_catalogue_rpc_owner FROM CURRENT_USER GRANTED BY CURRENT_USER;
COMMIT;
