\set ON_ERROR_STOP on
BEGIN READ ONLY;

DO $verify$
DECLARE
  item record;
  actual bigint;
BEGIN
  IF to_regnamespace('official_catalogue') IS NULL THEN
    RAISE EXCEPTION 'official_catalogue schema is missing';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'official_catalogue'
      AND c.relkind IN ('r', 'p')
  ) <> 13 THEN
    RAISE EXCEPTION 'official_catalogue must contain exactly the 13 snapshot tables';
  END IF;

  FOR item IN
    SELECT * FROM (VALUES
      ('sources', 12::bigint),
      ('releases', 22::bigint),
      ('import_batches', 42::bigint),
      ('source_records', 7072::bigint),
      ('ingredients', 8388::bigint),
      ('formulations', 4802::bigint),
      ('formulation_ingredients', 5079::bigint),
      ('products', 1710::bigint),
      ('product_packages', 4781::bigint),
      ('price_observations', 4781::bigint),
      ('regulatory_events', 1951::bigint),
      ('link_candidates', 9982::bigint),
      ('catalogue_entities', 26419::bigint)
    ) AS expected(table_name, row_count)
  LOOP
    EXECUTE format('SELECT count(*) FROM official_catalogue.%I', item.table_name)
      INTO actual;
    IF actual <> item.row_count THEN
      RAISE EXCEPTION 'Snapshot row-count mismatch for official_catalogue.%: expected %, found %',
        item.table_name, item.row_count, actual;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'official_catalogue'
      AND c.contype = 'f'
      AND NOT c.convalidated
  ) THEN
    RAISE EXCEPTION 'An official catalogue foreign key is not validated';
  END IF;
  IF (
    SELECT count(*)
    FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace
    WHERE n.nspname = 'official_catalogue'
      AND c.contype = 'f'
  ) <> 17 THEN
    RAISE EXCEPTION 'The snapshot foreign-key set is incomplete';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM official_catalogue.formulations f
    LEFT JOIN official_catalogue.catalogue_entities e
      ON e.entity_id = f.formulation_id
     AND e.source_record_id = f.source_record_id
     AND e.entity_type = 'formulation'
    WHERE e.entity_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Formulation UUID/evidence entity relationship is incomplete';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM official_catalogue.source_records sr
    JOIN official_catalogue.releases r USING (release_id)
    JOIN official_catalogue.sources s USING (source_key)
    WHERE coalesce(
        sr.original_payload #>> '{normalized_record,sources,0,source_dataset}',
        sr.original_payload #>> '{source,source_dataset}'
      ) IS DISTINCT FROM s.source_key
       OR coalesce(
        sr.original_payload #>> '{normalized_record,sources,0,source_record_id}',
        sr.original_payload #>> '{source,source_record_id}',
        sr.original_payload->>'event_id'
      ) IS DISTINCT FROM sr.external_record_id
       OR coalesce(
        sr.original_payload #>> '{normalized_record,sources,0,source_release}',
        sr.original_payload #>> '{source,source_release}',
        r.release_label
      ) IS DISTINCT FROM r.release_label
  ) THEN
    RAISE EXCEPTION 'Source dataset, record ID, or release provenance is inconsistent';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM official_catalogue.sources s
    JOIN official_catalogue.releases r USING (source_key)
    JOIN official_catalogue.source_records sr USING (release_id)
    GROUP BY s.source_key
    HAVING count(DISTINCT coalesce(
      sr.original_payload #>> '{normalized_record,sources,0,source_authority}',
      sr.original_payload #>> '{source,source_authority}'
    )) <> 1
       OR count(*) FILTER (WHERE coalesce(
         sr.original_payload #>> '{normalized_record,sources,0,source_authority}',
         sr.original_payload #>> '{source,source_authority}'
       ) IS NULL) > 0
  ) THEN
    RAISE EXCEPTION 'Original source-authority provenance is incomplete or inconsistent';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM official_catalogue.source_records
    GROUP BY release_id, external_record_id
    HAVING count(DISTINCT content_hash) > 1
  ) THEN
    RAISE EXCEPTION 'Conflicting content hashes exist for a source identity';
  END IF;

  IF EXISTS (
    SELECT 1 FROM official_catalogue.import_batches WHERE status <> 'completed'
  ) OR EXISTS (
    SELECT 1
    FROM official_catalogue.releases r
    LEFT JOIN official_catalogue.import_batches b USING (release_id)
    WHERE b.batch_id IS NULL
  ) OR EXISTS (
    WITH latest AS (
      SELECT DISTINCT ON (release_id) release_id, status, report
      FROM official_catalogue.import_batches
      ORDER BY release_id, completed_at DESC NULLS LAST, started_at DESC, batch_id DESC
    ), actual AS (
      SELECT release_id, count(*)::bigint AS source_records
      FROM official_catalogue.source_records
      GROUP BY release_id
    )
    SELECT 1
    FROM latest l
    JOIN actual a USING (release_id)
    WHERE l.status <> 'completed'
       OR coalesce((l.report->>'input_records')::bigint, -1) <> a.source_records
       OR coalesce((l.report->>'new_source_records')::bigint, -1)
          + coalesce((l.report->>'existing_source_records')::bigint, -1)
          <> coalesce((l.report->>'input_records')::bigint, -1)
       OR coalesce((l.report->>'conflicts')::bigint, -1) <> 0
  ) THEN
    RAISE EXCEPTION 'Import batch status or latest per-release report is inconsistent';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('ceiling_price_excluding_taxes', 915::bigint),
      ('pmbi_listed_mrp', 2453::bigint),
      ('revised_mrp', 1391::bigint),
      ('special_feature_ceiling_price', 22::bigint)
    ) AS expected(price_basis, row_count)
    FULL JOIN (
      SELECT price_basis, count(*)::bigint AS row_count
      FROM official_catalogue.price_observations
      GROUP BY price_basis
    ) actual USING (price_basis)
    WHERE expected.row_count IS DISTINCT FROM actual.row_count
  ) OR EXISTS (
    SELECT 1
    FROM official_catalogue.price_observations
    WHERE package_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Price categories or unlinked-price baseline changed';
  END IF;
  IF (
    SELECT count(*) FROM official_catalogue.regulatory_events
    WHERE event_type = 'approval'
  ) <> 1244 OR (
    SELECT count(*) FROM official_catalogue.regulatory_events
    WHERE event_type = 'regulatory-restriction-notice'
  ) <> 707 OR EXISTS (
    SELECT 1 FROM official_catalogue.regulatory_events
    WHERE establishes_current_status
  ) THEN
    RAISE EXCEPTION 'Regulatory event counts or historical-status qualifications changed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM official_catalogue.products WHERE formulation_id IS NOT NULL
  ) OR EXISTS (
    SELECT 1 FROM official_catalogue.product_packages WHERE product_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Product/package/formulation associations differ from the source snapshot';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('exact', 7200::bigint),
      ('unmatched', 2782::bigint)
    ) AS expected(match_status, row_count)
    FULL JOIN (
      SELECT match_status, count(*)::bigint AS row_count
      FROM official_catalogue.link_candidates
      GROUP BY match_status
    ) actual USING (match_status)
    WHERE expected.row_count IS DISTINCT FROM actual.row_count
  ) THEN
    RAISE EXCEPTION 'Persisted linkage status counts changed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'official_catalogue'
      AND c.relkind IN ('r', 'p')
      AND (c.relrowsecurity OR c.relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'Official catalogue RLS state differs from the verified source snapshot';
  END IF;
  IF has_schema_privilege('anon', 'official_catalogue', 'USAGE')
     OR has_schema_privilege('authenticated', 'official_catalogue', 'USAGE')
     OR EXISTS (
       SELECT 1
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'official_catalogue'
         AND c.relkind IN ('r', 'p')
         AND (has_table_privilege('anon', c.oid, 'SELECT')
           OR has_table_privilege('authenticated', c.oid, 'SELECT')
           OR has_any_column_privilege('anon', c.oid, 'SELECT')
           OR has_any_column_privilege('authenticated', c.oid, 'SELECT'))
     ) THEN
    RAISE EXCEPTION 'Catalogue client roles have direct schema/table SELECT access';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indexrelid = 'official_catalogue.link_candidates_replay_identity_idx'::regclass
      AND i.indisunique AND i.indisvalid AND i.indisready
      AND pg_get_indexdef(i.indexrelid) LIKE
        '%COALESCE(right_source_record_id, ''00000000-0000-0000-0000-000000000000''::uuid)%'
  ) THEN
    RAISE EXCEPTION 'NULL-safe linkage replay index is missing or incompatible';
  END IF;
END
$verify$;

COMMIT;
