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
\echo 'synthetic catalogue fixtures are restricted to the requested disposable database'
SELECT 1 / 0;
\endif

BEGIN;
INSERT INTO official_catalogue.sources (source_key, authority)
VALUES ('synthetic_test', 'Synthetic test fixture only');

INSERT INTO official_catalogue.releases (release_id, source_key, release_label, dataset_hash)
VALUES ('d1000000-0000-4000-8000-000000000001', 'synthetic_test', 'fixture-v1', 'synthetic-fixture-only');

INSERT INTO official_catalogue.source_records
  (source_record_id, release_id, external_record_id, content_hash, parser_version, record_kind, original_payload)
VALUES
  ('d0000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'fixture-alpha-250', 'fixture-hash-alpha-250', 'rpc-test', 'formulation', '{"synthetic":true}'::jsonb),
  ('d0000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000001', 'fixture-alpha-500', 'fixture-hash-alpha-500', 'rpc-test', 'formulation', '{"synthetic":true}'::jsonb),
  ('d0000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000001', 'fixture-combination', 'fixture-hash-combination', 'rpc-test', 'formulation', '{"synthetic":true}'::jsonb),
  ('d0000000-0000-4000-8000-000000000004', 'd1000000-0000-4000-8000-000000000001', 'fixture-incomplete', 'fixture-hash-incomplete', 'rpc-test', 'formulation', '{"synthetic":true}'::jsonb);

INSERT INTO official_catalogue.ingredients
  (ingredient_id, source_record_id, normalized_name, display_name, evidence)
VALUES
  ('d3000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'fixture alpha', 'Synthetic fixture ingredient alpha', '{"synthetic":true}'::jsonb),
  ('d3000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002', 'fixture alpha', 'Synthetic fixture ingredient alpha', '{"synthetic":true}'::jsonb),
  ('d3000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000003', 'fixture alpha', 'Synthetic fixture ingredient alpha', '{"synthetic":true}'::jsonb),
  ('d3000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000003', 'fixture beta', 'Synthetic fixture ingredient beta', '{"synthetic":true}'::jsonb);

INSERT INTO official_catalogue.formulations
  (formulation_id, source_record_id, canonical_name, dosage_form, identity, evidence)
VALUES
  ('d2000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'Synthetic Fixture Alpha 250 mg Tablet', 'tablet',
   '{"ingredients":[{"name":"fixture alpha","strength_value":250,"strength_unit":"mg"}],"dosage_form":"tablet","release_type":null}'::jsonb,
   '{"canonical_name":"Synthetic Fixture Alpha 250 mg Tablet","normalized_name":"synthetic fixture alpha 250 mg tablet","generic_name":"Synthetic fixture ingredient alpha","brand_name":"Synthetic Fixture Brand Alpha","dosage_form":"tablet","unreviewed_description":"must not be returned","source_url":"must not be returned","image_url":"must not be returned"}'::jsonb),
  ('d2000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002', 'Synthetic Fixture Alpha 500 mg Tablet', 'tablet',
   '{"ingredients":[{"name":"fixture alpha","strength_value":500,"strength_unit":"mg"}],"dosage_form":"tablet","release_type":null}'::jsonb,
   '{"canonical_name":"Synthetic Fixture Alpha 500 mg Tablet","normalized_name":"synthetic fixture alpha 500 mg tablet","generic_name":"Synthetic fixture ingredient alpha","brand_name":null,"dosage_form":"tablet","unreviewed_description":"must not be returned"}'::jsonb),
  ('d2000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000003', 'Synthetic Fixture Alpha + Beta Tablet', 'tablet',
   '{"ingredients":[{"name":"fixture alpha","strength_value":250,"strength_unit":"mg"},{"name":"fixture beta","strength_value":5,"strength_unit":"mg"}],"dosage_form":"tablet","release_type":null}'::jsonb,
   '{"canonical_name":"Synthetic Fixture Alpha + Beta Tablet","normalized_name":"synthetic fixture alpha beta tablet","generic_name":"Synthetic fixture combination","brand_name":null,"dosage_form":"tablet"}'::jsonb),
  ('d2000000-0000-4000-8000-000000000004', 'd0000000-0000-4000-8000-000000000004', 'Synthetic Fixture Incomplete Tablet', 'tablet',
   '{"ingredients":[],"dosage_form":"tablet","release_type":null}'::jsonb,
   '{"canonical_name":"Synthetic Fixture Incomplete Tablet","normalized_name":"synthetic fixture incomplete tablet","generic_name":null,"brand_name":null,"dosage_form":"tablet"}'::jsonb);

INSERT INTO official_catalogue.formulation_ingredients
  (formulation_id, ingredient_id, strength_value, strength_unit, evidence)
VALUES
  ('d2000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000001', 250, 'mg', '{"synthetic":true}'::jsonb),
  ('d2000000-0000-4000-8000-000000000002', 'd3000000-0000-4000-8000-000000000002', 500, 'mg', '{"synthetic":true}'::jsonb),
  ('d2000000-0000-4000-8000-000000000003', 'd3000000-0000-4000-8000-000000000003', 250, 'mg', '{"synthetic":true}'::jsonb),
  ('d2000000-0000-4000-8000-000000000003', 'd3000000-0000-4000-8000-000000000004', 5, 'mg', '{"synthetic":true}'::jsonb);

INSERT INTO official_catalogue.catalogue_entities
  (entity_id, source_record_id, entity_type, identity, evidence, identity_hash)
SELECT formulation_id, source_record_id, 'formulation', identity, evidence,
       'synthetic-formulation-identity-' || right(formulation_id::text, 12)
FROM official_catalogue.formulations;

INSERT INTO official_catalogue.price_observations
  (price_id, source_record_id, package_id, price, currency, price_basis, evidence)
VALUES
  ('d4000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', NULL, 123.45, 'XXX', 'unknown',
   '{"synthetic":true,"unlinked":true}'::jsonb);
COMMIT;
