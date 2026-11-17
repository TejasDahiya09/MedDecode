-- Local-only candidate: additive source-aware official medicine catalogue.
-- It intentionally does not alter public application tables.
BEGIN;
CREATE SCHEMA IF NOT EXISTS official_catalogue;

CREATE TABLE IF NOT EXISTS official_catalogue.sources (source_key text PRIMARY KEY, authority text NOT NULL, acquisition_url text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS official_catalogue.releases (
  release_id uuid PRIMARY KEY, source_key text NOT NULL REFERENCES official_catalogue.sources(source_key), release_label text NOT NULL, dataset_hash text NOT NULL, retrieved_on date,
  UNIQUE (source_key, release_label, dataset_hash));
CREATE TABLE IF NOT EXISTS official_catalogue.import_batches (
  batch_id uuid PRIMARY KEY, release_id uuid NOT NULL REFERENCES official_catalogue.releases(release_id), parser_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('started','completed','failed','dry_run')), started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, report jsonb NOT NULL DEFAULT '{}'::jsonb);
-- A changed hash for the same official source record is retained, never overwritten.
CREATE TABLE IF NOT EXISTS official_catalogue.source_records (
  source_record_id uuid PRIMARY KEY, release_id uuid NOT NULL REFERENCES official_catalogue.releases(release_id), external_record_id text NOT NULL,
  content_hash text NOT NULL, parser_version text NOT NULL, record_kind text NOT NULL, original_payload jsonb NOT NULL, imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (release_id, external_record_id, content_hash));
CREATE INDEX IF NOT EXISTS source_records_identity_idx ON official_catalogue.source_records (release_id, external_record_id);
CREATE TABLE IF NOT EXISTS official_catalogue.ingredients (
  ingredient_id uuid PRIMARY KEY, source_record_id uuid NOT NULL REFERENCES official_catalogue.source_records(source_record_id), normalized_name text NOT NULL, display_name text NOT NULL, evidence jsonb NOT NULL,
  UNIQUE (source_record_id, normalized_name));
CREATE TABLE IF NOT EXISTS official_catalogue.formulations (
  formulation_id uuid PRIMARY KEY, source_record_id uuid NOT NULL REFERENCES official_catalogue.source_records(source_record_id), canonical_name text, dosage_form text, release_type text, identity jsonb NOT NULL, evidence jsonb NOT NULL,
  UNIQUE (source_record_id, identity));
CREATE TABLE IF NOT EXISTS official_catalogue.formulation_ingredients (
  formulation_id uuid NOT NULL REFERENCES official_catalogue.formulations(formulation_id), ingredient_id uuid NOT NULL REFERENCES official_catalogue.ingredients(ingredient_id), strength_value numeric, strength_unit text, evidence jsonb NOT NULL,
  PRIMARY KEY (formulation_id, ingredient_id));
CREATE TABLE IF NOT EXISTS official_catalogue.products (
  product_id uuid PRIMARY KEY, source_record_id uuid NOT NULL REFERENCES official_catalogue.source_records(source_record_id), formulation_id uuid REFERENCES official_catalogue.formulations(formulation_id), product_name text NOT NULL, manufacturer_name text,
  product_kind text NOT NULL CHECK (product_kind IN ('medicine','surgical_medical_consumable','unknown')), evidence jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS official_catalogue.product_packages (
  package_id uuid PRIMARY KEY, source_record_id uuid NOT NULL REFERENCES official_catalogue.source_records(source_record_id), product_id uuid REFERENCES official_catalogue.products(product_id), package_description text, package_unit text, evidence jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS official_catalogue.price_observations (
  price_id uuid PRIMARY KEY, source_record_id uuid NOT NULL REFERENCES official_catalogue.source_records(source_record_id), package_id uuid REFERENCES official_catalogue.product_packages(package_id), price numeric NOT NULL CHECK (price >= 0), currency text NOT NULL,
  price_basis text NOT NULL CHECK (price_basis IN ('ceiling_price_excluding_taxes','special_feature_ceiling_price','revised_mrp','pmbi_listed_mrp','unknown')), effective_on date, evidence jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS official_catalogue.regulatory_events (
  event_id uuid PRIMARY KEY, source_record_id uuid NOT NULL REFERENCES official_catalogue.source_records(source_record_id), event_type text NOT NULL, event_date date, qualification text, establishes_current_status boolean NOT NULL DEFAULT false, evidence jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS official_catalogue.link_candidates (
  linkage_id uuid PRIMARY KEY, left_source_record_id uuid NOT NULL REFERENCES official_catalogue.source_records(source_record_id), right_source_record_id uuid REFERENCES official_catalogue.source_records(source_record_id),
  match_status text NOT NULL CHECK (match_status IN ('exact','uncertain','unmatched','conflict')), reason text NOT NULL, identity_signature text,
  UNIQUE (left_source_record_id, right_source_record_id, match_status, reason));
-- Every prepared candidate is retained even when it cannot safely be promoted
-- to a canonical medicine entity. This is the Layer 4 lookup boundary.
CREATE TABLE IF NOT EXISTS official_catalogue.catalogue_entities (
  entity_id uuid PRIMARY KEY,
  source_record_id uuid NOT NULL REFERENCES official_catalogue.source_records(source_record_id),
  entity_type text NOT NULL,
  identity jsonb NOT NULL,
  evidence jsonb NOT NULL,
  identity_hash text NOT NULL,
  UNIQUE (source_record_id, entity_type, identity_hash));
CREATE INDEX IF NOT EXISTS catalogue_entities_exact_lookup_idx
  ON official_catalogue.catalogue_entities (entity_type, identity_hash);
COMMIT;
