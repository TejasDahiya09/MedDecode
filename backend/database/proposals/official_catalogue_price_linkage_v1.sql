-- DRAFT ONLY: local proposal. Do not execute or deploy without separate approval.
-- Adds typed price evidence and source-record-consistent linkage constraints.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE official_catalogue.price_observations
  ADD COLUMN IF NOT EXISTS formulation_id uuid,
  ADD COLUMN IF NOT EXISTS price_unit text,
  ADD COLUMN IF NOT EXISTS notification_number text,
  ADD COLUMN IF NOT EXISTS notification_on date,
  ADD COLUMN IF NOT EXISTS published_on date,
  ADD COLUMN IF NOT EXISTS previous_price numeric,
  ADD COLUMN IF NOT EXISTS special_feature_qualifier text;

ALTER TABLE official_catalogue.product_packages
  ADD COLUMN IF NOT EXISTS formulation_id uuid,
  ADD COLUMN IF NOT EXISTS package_quantity numeric,
  ADD COLUMN IF NOT EXISTS package_quantity_unit text,
  ADD COLUMN IF NOT EXISTS special_feature_qualifier text;

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'official_catalogue.formulations'::regclass
      AND conname = 'formulations_id_source_record_uq'
  ) THEN
    ALTER TABLE official_catalogue.formulations
      ADD CONSTRAINT formulations_id_source_record_uq
      UNIQUE (formulation_id, source_record_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'official_catalogue.products'::regclass
      AND conname = 'products_id_formulation_source_record_uq'
  ) THEN
    ALTER TABLE official_catalogue.products
      ADD CONSTRAINT products_id_formulation_source_record_uq
      UNIQUE (product_id, formulation_id, source_record_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'official_catalogue.product_packages'::regclass
      AND conname = 'product_packages_id_formulation_source_record_uq'
  ) THEN
    ALTER TABLE official_catalogue.product_packages
      ADD CONSTRAINT product_packages_id_formulation_source_record_uq
      UNIQUE (package_id, formulation_id, source_record_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'official_catalogue.price_observations'::regclass
      AND conname = 'price_observations_previous_price_nonnegative'
  ) THEN
    ALTER TABLE official_catalogue.price_observations
      ADD CONSTRAINT price_observations_previous_price_nonnegative
      CHECK (previous_price IS NULL OR previous_price >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'official_catalogue.price_observations'::regclass
      AND conname = 'price_observations_previous_price_basis'
  ) THEN
    ALTER TABLE official_catalogue.price_observations
      ADD CONSTRAINT price_observations_previous_price_basis
      CHECK (previous_price IS NULL OR price_basis = 'revised_mrp') NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'official_catalogue.price_observations'::regclass
      AND conname = 'price_observations_special_qualifier_basis'
  ) THEN
    ALTER TABLE official_catalogue.price_observations
      ADD CONSTRAINT price_observations_special_qualifier_basis
      CHECK (
        special_feature_qualifier IS NULL
        OR (
          price_basis = 'special_feature_ceiling_price'
          AND NULLIF(btrim(special_feature_qualifier), '') IS NOT NULL
        )
      ) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'official_catalogue.product_packages'::regclass
      AND conname = 'product_packages_quantity_pair'
  ) THEN
    ALTER TABLE official_catalogue.product_packages
      ADD CONSTRAINT product_packages_quantity_pair
      CHECK (
        (package_quantity IS NULL AND package_quantity_unit IS NULL)
        OR (
          package_quantity IS NOT NULL
          AND package_quantity > 0
          AND package_quantity_unit IS NOT NULL
          AND NULLIF(btrim(package_quantity_unit), '') IS NOT NULL
        )
      ) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'official_catalogue.product_packages'::regclass
      AND conname = 'product_packages_special_qualifier_nonempty'
  ) THEN
    ALTER TABLE official_catalogue.product_packages
      ADD CONSTRAINT product_packages_special_qualifier_nonempty
      CHECK (
        special_feature_qualifier IS NULL
        OR NULLIF(btrim(special_feature_qualifier), '') IS NOT NULL
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'official_catalogue.product_packages'::regclass
      AND conname = 'product_packages_formulation_same_source_fk'
  ) THEN
    ALTER TABLE official_catalogue.product_packages
      ADD CONSTRAINT product_packages_formulation_same_source_fk
      FOREIGN KEY (formulation_id, source_record_id)
      REFERENCES official_catalogue.formulations(formulation_id, source_record_id)
      NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'official_catalogue.product_packages'::regclass
      AND conname = 'product_packages_product_formulation_same_source_fk'
  ) THEN
    ALTER TABLE official_catalogue.product_packages
      ADD CONSTRAINT product_packages_product_formulation_same_source_fk
      FOREIGN KEY (product_id, formulation_id, source_record_id)
      REFERENCES official_catalogue.products(product_id, formulation_id, source_record_id)
      NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'official_catalogue.price_observations'::regclass
      AND conname = 'price_observations_formulation_same_source_fk'
  ) THEN
    ALTER TABLE official_catalogue.price_observations
      ADD CONSTRAINT price_observations_formulation_same_source_fk
      FOREIGN KEY (formulation_id, source_record_id)
      REFERENCES official_catalogue.formulations(formulation_id, source_record_id)
      NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'official_catalogue.price_observations'::regclass
      AND conname = 'price_observations_package_formulation_same_source_fk'
  ) THEN
    ALTER TABLE official_catalogue.price_observations
      ADD CONSTRAINT price_observations_package_formulation_same_source_fk
      FOREIGN KEY (package_id, formulation_id, source_record_id)
      REFERENCES official_catalogue.product_packages(package_id, formulation_id, source_record_id)
      NOT VALID;
  END IF;
END
$constraints$;

-- A future authenticated SECURITY DEFINER RPC should accept one formulation ID,
-- return only non-null exact price/package/formulation links, and join source,
-- release, product and package metadata. It must filter by price_basis, return
-- MRP/ceiling/special-feature labels distinctly, omit raw payload/evidence,
-- use a fixed search_path and verify auth.uid(). Do not grant table access to
-- anon/authenticated clients or create links in this migration.
GRANT SELECT (
  price_id, source_record_id, package_id, formulation_id, price, currency,
  price_basis, effective_on, price_unit, notification_number, notification_on,
  published_on, previous_price, special_feature_qualifier
) ON TABLE official_catalogue.price_observations
  TO meddecode_catalogue_rpc_owner;
GRANT SELECT (
  package_id, source_record_id, product_id, formulation_id, package_description,
  package_unit, package_quantity, package_quantity_unit, special_feature_qualifier
) ON TABLE official_catalogue.product_packages
  TO meddecode_catalogue_rpc_owner;
GRANT SELECT (
  product_id, source_record_id, formulation_id, product_name, manufacturer_name,
  product_kind
) ON TABLE official_catalogue.products
  TO meddecode_catalogue_rpc_owner;
GRANT SELECT (
  source_record_id, release_id, external_record_id
) ON TABLE official_catalogue.source_records
  TO meddecode_catalogue_rpc_owner;
GRANT SELECT (
  release_id, source_key, release_label, retrieved_on
) ON TABLE official_catalogue.releases
  TO meddecode_catalogue_rpc_owner;
GRANT SELECT (
  source_key, authority, acquisition_url
) ON TABLE official_catalogue.sources
  TO meddecode_catalogue_rpc_owner;

COMMIT;
