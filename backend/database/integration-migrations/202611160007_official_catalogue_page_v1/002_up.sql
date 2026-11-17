\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
GRANT meddecode_catalogue_rpc_owner TO CURRENT_USER
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY CURRENT_USER;
GRANT CREATE ON SCHEMA public TO meddecode_catalogue_rpc_owner;
SET LOCAL ROLE meddecode_catalogue_rpc_owner;

CREATE FUNCTION public.meddecode_official_catalogue_page_v1(
  p_query text, p_form text, p_limit integer, p_offset integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_query text;
  v_compact_query text;
  v_result jsonb;
BEGIN
  IF public.meddecode_catalogue_request_uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication required';
  END IF;
  IF (p_query IS NOT NULL AND (
        length(btrim(p_query)) NOT BETWEEN 2 AND 80
        OR position(chr(37) IN p_query) > 0
        OR position(chr(95) IN p_query) > 0
        OR position(chr(92) IN p_query) > 0
        OR p_query ~ '[[:cntrl:]]'
      ))
     OR (p_form IS NOT NULL AND p_form NOT IN (
       'Tablet', 'Capsule', 'Syrup', 'Injection', 'Ointment', 'Drops'
     ))
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50
     OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 10000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid catalogue page';
  END IF;

  v_query := lower(btrim(p_query));
  v_compact_query := regexp_replace(v_query, '[[:space:]]+', '', 'g');

  WITH matching AS MATERIALIZED (
    SELECT
      f.formulation_id AS id,
      COALESCE(f.canonical_name, e.evidence->>'canonical_name') AS canonical_name,
      NULLIF(e.evidence->>'generic_name', '') AS generic_name,
      NULLIF(e.evidence->>'brand_name', '') AS brand_name,
      COALESCE(f.dosage_form, e.evidence->>'dosage_form') AS dosage_form,
      CASE WHEN component.component_count = 1 THEN component.strength_value END AS strength_value,
      CASE WHEN component.component_count = 1 THEN component.strength_unit END AS strength_unit,
      NULL::text AS manufacturer_name,
      'official_catalogue'::text AS catalogue_source,
      'official_catalogue.formulation_id'::text AS id_namespace,
      COALESCE((
        SELECT jsonb_agg(source_row.source_key ORDER BY source_row.source_key)
        FROM (
          SELECT DISTINCT r.source_key
          FROM official_catalogue.source_records sr
          JOIN official_catalogue.releases r ON r.release_id = sr.release_id
          WHERE sr.source_record_id = f.source_record_id
        ) source_row
      ), '[]'::jsonb) AS sources
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
        p_form IS NULL
        OR CASE p_form
          WHEN 'Tablet' THEN lower(COALESCE(f.dosage_form, e.evidence->>'dosage_form', '')) ~ '(tablet|caplet)'
          WHEN 'Capsule' THEN lower(COALESCE(f.dosage_form, e.evidence->>'dosage_form', '')) ~ 'capsule'
          WHEN 'Syrup' THEN lower(COALESCE(f.dosage_form, e.evidence->>'dosage_form', '')) ~ '(syrup|suspension|elixir|liquid|oral solution)'
          WHEN 'Injection' THEN lower(COALESCE(f.dosage_form, e.evidence->>'dosage_form', '')) ~ '(inject|infusion|vial)'
          WHEN 'Ointment' THEN lower(COALESCE(f.dosage_form, e.evidence->>'dosage_form', '')) ~ '(cream|ointment|gel|lotion|topical)'
          WHEN 'Drops' THEN lower(COALESCE(f.dosage_form, e.evidence->>'dosage_form', '')) ~ '(drop|spray|nasal|ophthalmic|otic)'
          ELSE false
        END
      )
      AND (
        v_query IS NULL
        OR lower(COALESCE(e.evidence->>'normalized_name', '')) LIKE '%' || v_query || '%'
        OR lower(COALESCE(f.canonical_name, e.evidence->>'canonical_name', '')) LIKE '%' || v_query || '%'
        OR lower(COALESCE(e.evidence->>'generic_name', '')) LIKE '%' || v_query || '%'
        OR lower(COALESCE(e.evidence->>'brand_name', '')) LIKE '%' || v_query || '%'
        OR lower(COALESCE(f.dosage_form, e.evidence->>'dosage_form', '')) LIKE '%' || v_query || '%'
        OR EXISTS (
          SELECT 1
          FROM official_catalogue.formulation_ingredients fi
          JOIN official_catalogue.ingredients i ON i.ingredient_id = fi.ingredient_id
          WHERE fi.formulation_id = f.formulation_id
            AND (
              lower(COALESCE(i.normalized_name, '')) LIKE '%' || v_query || '%'
              OR lower(COALESCE(i.display_name, '')) LIKE '%' || v_query || '%'
            )
        )
        OR EXISTS (
          SELECT 1
          FROM official_catalogue.formulation_ingredients fi
          WHERE fi.formulation_id = f.formulation_id
            AND regexp_replace(
              lower(trim_scale(fi.strength_value)::text || COALESCE(fi.strength_unit, '')),
              '[[:space:]]+', '', 'g'
            ) LIKE '%' || v_compact_query || '%'
        )
      )
  )
  SELECT jsonb_build_object(
    'items', COALESCE((
      SELECT jsonb_agg(to_jsonb(page) ORDER BY page.canonical_name COLLATE "C", page.id)
      FROM (
        SELECT matching.*
        FROM matching
        ORDER BY matching.canonical_name COLLATE "C", matching.id
        LIMIT p_limit OFFSET p_offset
      ) page
    ), '[]'::jsonb),
    'total', (SELECT count(*) FROM matching)
  )
  INTO v_result;

  RETURN v_result;
END
$function$;
REVOKE ALL ON FUNCTION public.meddecode_official_catalogue_page_v1(text, text, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meddecode_official_catalogue_page_v1(text, text, integer, integer)
  TO authenticated;

RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM meddecode_catalogue_rpc_owner;
REVOKE meddecode_catalogue_rpc_owner FROM CURRENT_USER GRANTED BY CURRENT_USER;
COMMIT;
