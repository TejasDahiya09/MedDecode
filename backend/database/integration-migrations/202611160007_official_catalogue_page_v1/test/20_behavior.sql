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
\echo 'catalogue page behavior tests require the requested disposable fixture database'
SELECT 1 / 0;
\endif

BEGIN READ ONLY;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'd9000000-0000-4000-8000-000000000001', true);
DO $behavior$
DECLARE
  v_first jsonb;
  v_second jsonb;
  v_match jsonb;
BEGIN
  v_first := public.meddecode_official_catalogue_page_v1(NULL, NULL, 2, 0);
  v_second := public.meddecode_official_catalogue_page_v1(NULL, NULL, 2, 2);
  IF (v_first->>'total')::integer <> 4
     OR jsonb_array_length(v_first->'items') <> 2
     OR (v_first->'items'->0->>'id') <> 'd2000000-0000-4000-8000-000000000003'
     OR (v_first->'items'->1->>'id') <> 'd2000000-0000-4000-8000-000000000001'
     OR (v_second->>'total')::integer <> 4
     OR jsonb_array_length(v_second->'items') <> 2
     OR (v_second->'items'->0->>'id') <> 'd2000000-0000-4000-8000-000000000002'
     OR (v_second->'items'->1->>'id') <> 'd2000000-0000-4000-8000-000000000004' THEN
    RAISE EXCEPTION 'catalogue pages did not preserve the total, stable ordering, or distinct rows';
  END IF;
  IF NOT (v_first->'items'->0->'sources' ? 'synthetic_test')
     OR v_first->'items'->0 ? 'source_url'
     OR v_first->'items'->0 ? 'prices'
     OR v_first->'items'->0 ? 'original_payload' THEN
    RAISE EXCEPTION 'catalogue page omitted attribution or exposed unapproved fields';
  END IF;

  v_match := public.meddecode_official_catalogue_page_v1(
    'Synthetic Fixture Brand Alpha', NULL, 10, 0
  );
  IF (v_match->>'total')::integer <> 1
     OR (v_match->'items'->0->>'id') <> 'd2000000-0000-4000-8000-000000000001' THEN
    RAISE EXCEPTION 'brand search did not return its supported synthetic record';
  END IF;

  v_match := public.meddecode_official_catalogue_page_v1(
    'Synthetic fixture ingredient alpha', NULL, 10, 0
  );
  IF (v_match->>'total')::integer <> 3 THEN
    RAISE EXCEPTION 'ingredient search did not include all matching formulation records';
  END IF;

  v_match := public.meddecode_official_catalogue_page_v1('5 mg', NULL, 10, 0);
  IF (v_match->>'total')::integer <> 1
     OR (v_match->'items'->0->>'id') <> 'd2000000-0000-4000-8000-000000000003' THEN
    RAISE EXCEPTION 'strength search did not preserve the component-specific strength';
  END IF;

  v_match := public.meddecode_official_catalogue_page_v1(NULL, 'Tablet', 10, 0);
  IF (v_match->>'total')::integer <> 4 THEN
    RAISE EXCEPTION 'tablet category did not include all matching formulations';
  END IF;
  v_match := public.meddecode_official_catalogue_page_v1('tablet', NULL, 10, 0);
  IF (v_match->>'total')::integer <> 4 THEN
    RAISE EXCEPTION 'dosage-form search did not return matching formulation records';
  END IF;
  v_match := public.meddecode_official_catalogue_page_v1(NULL, 'Capsule', 10, 0);
  IF (v_match->>'total')::integer <> 0 THEN
    RAISE EXCEPTION 'capsule category returned non-capsule records';
  END IF;

  BEGIN
    PERFORM public.meddecode_official_catalogue_page_v1('%', NULL, 10, 0);
    RAISE EXCEPTION 'wildcard query unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM public.meddecode_official_catalogue_page_v1(NULL, 'Unknown Form', 10, 0);
    RAISE EXCEPTION 'unknown dosage category unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM public.meddecode_official_catalogue_page_v1(NULL, NULL, 51, 0);
    RAISE EXCEPTION 'oversized page unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM public.meddecode_official_catalogue_page_v1(NULL, NULL, 10, 10001);
    RAISE EXCEPTION 'oversized offset unexpectedly succeeded';
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
