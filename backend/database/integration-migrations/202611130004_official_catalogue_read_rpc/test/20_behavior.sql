\set ON_ERROR_STOP on
\if :{?test_database}
\else
\echo 'test_database is required'
\quit 3
\endif
SELECT current_database() = :'test_database' AS guard_matches
\gset
\if :guard_matches
\else
\echo 'RPC behavior tests are restricted to the requested disposable database'
SELECT 1 / 0;
\endif

BEGIN READ ONLY;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'd9000000-0000-4000-8000-000000000001', true);
DO $behavior$
DECLARE
  v_detail jsonb;
  v_component_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.meddecode_official_catalogue_search_v1('synthetic fixture alpha', 51, 0)
    WHERE id = 'd2000000-0000-4000-8000-000000000001'
      AND strength_value = 250 AND strength_unit = 'mg'
      AND catalogue_source = 'official_catalogue'
      AND id_namespace = 'official_catalogue.formulation_id'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.meddecode_official_catalogue_search_v1('synthetic fixture alpha', 51, 0)
    WHERE id = 'd2000000-0000-4000-8000-000000000002'
      AND strength_value = 500 AND strength_unit = 'mg'
  ) THEN
    RAISE EXCEPTION 'similar synthetic formulations or their UUIDs/strengths were not preserved';
  END IF;

  v_detail := public.meddecode_official_catalogue_detail_v1('d2000000-0000-4000-8000-000000000001');
  IF v_detail->>'id' <> 'd2000000-0000-4000-8000-000000000001'
     OR v_detail->>'catalogue_source' <> 'official_catalogue'
     OR v_detail->>'id_namespace' <> 'official_catalogue.formulation_id'
     OR v_detail->>'manufacturer_name' IS NOT NULL
     OR v_detail->'prices' <> '[]'::jsonb
     OR NOT (v_detail->'sources' ? 'synthetic_test') THEN
    RAISE EXCEPTION 'single-formulation detail response or empty price behavior is invalid';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_object_keys(v_detail) AS item(key)
    WHERE item.key NOT IN (
      'id', 'catalogue_source', 'id_namespace', 'canonical_name', 'generic_name',
      'brand_name', 'dosage_form', 'strength_value', 'strength_unit',
      'manufacturer_name', 'ingredients', 'aliases', 'sources', 'prices'
    )
  ) OR (SELECT count(*) FROM jsonb_object_keys(v_detail)) <> 14 THEN
    RAISE EXCEPTION 'detail response contains an unexpected field';
  END IF;
  IF v_detail ? 'unreviewed_description' OR v_detail ? 'source_url'
     OR v_detail ? 'image_url' OR v_detail ? 'original_payload' THEN
    RAISE EXCEPTION 'detail response exposed an unreviewed field';
  END IF;

  v_detail := public.meddecode_official_catalogue_detail_v1('d2000000-0000-4000-8000-000000000003');
  SELECT count(*) INTO v_component_count
  FROM jsonb_array_elements(v_detail->'ingredients') AS component(value)
  WHERE component.value->>'strength_unit' = 'mg'
    AND component.value->>'strength_value' IN ('250', '5');
  IF jsonb_array_length(v_detail->'ingredients') <> 2 OR v_component_count <> 2
     OR v_detail->'strength_value' <> 'null'::jsonb
     OR v_detail->'strength_unit' <> 'null'::jsonb THEN
    RAISE EXCEPTION 'combination ingredient strengths were flattened or lost';
  END IF;

  v_detail := public.meddecode_official_catalogue_detail_v1('d2000000-0000-4000-8000-000000000004');
  IF v_detail->'ingredients' <> '[]'::jsonb
     OR v_detail->'strength_value' <> 'null'::jsonb THEN
    RAISE EXCEPTION 'missing formulation evidence was not preserved as unavailable';
  END IF;
  IF public.meddecode_official_catalogue_detail_v1('d8000000-0000-4000-8000-000000000001') IS NOT NULL THEN
    RAISE EXCEPTION 'missing formulation did not return NULL';
  END IF;

  BEGIN
    PERFORM * FROM public.meddecode_official_catalogue_search_v1('%', 1, 0);
    RAISE EXCEPTION 'wildcard query unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM * FROM public.meddecode_official_catalogue_search_v1('fixture', 52, 0);
    RAISE EXCEPTION 'oversized limit unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM * FROM public.meddecode_official_catalogue_search_v1('fixture', 1, 501);
    RAISE EXCEPTION 'oversized offset unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM public.meddecode_official_catalogue_detail_v1(NULL);
    RAISE EXCEPTION 'NULL formulation ID unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM official_catalogue.catalogue_entities LIMIT 1;
    RAISE EXCEPTION 'authenticated role read the underlying catalogue table';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$behavior$;
ROLLBACK;
