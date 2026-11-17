-- READ-ONLY hosted discovery. This script reads schema metadata and public
-- catalogue medicine fields only; it does not read Cabinet rows or user data.
-- The candidate list is capped at 250 records and omits price fields.

BEGIN READ ONLY;
SET LOCAL statement_timeout = '15s';

SELECT
  'public.medicines'::text AS table_name,
  to_regclass('public.medicines') IS NOT NULL AS table_exists
UNION ALL
SELECT
  'public.medicine_cabinet',
  to_regclass('public.medicine_cabinet') IS NOT NULL;

SELECT
  table_name,
  column_name,
  ordinal_position,
  data_type,
  udt_name,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'medicines',
    'medicine_cabinet',
    'manufacturers',
    'medicine_ingredients',
    'active_ingredients',
    'medicine_sources'
  )
ORDER BY table_name, ordinal_position;

SELECT
  c.conrelid::regclass::text AS table_name,
  c.conname AS constraint_name,
  c.contype AS constraint_type,
  c.convalidated AS is_validated,
  CASE
    WHEN c.confrelid = 0 THEN NULL
    ELSE c.confrelid::regclass::text
  END AS referenced_table,
  pg_get_constraintdef(c.oid, true) AS definition
FROM pg_constraint AS c
WHERE c.conrelid IN (
    to_regclass('public.medicines'),
    to_regclass('public.medicine_cabinet')
  )
  OR (
    c.contype = 'f'
    AND c.confrelid = to_regclass('public.medicines')
  )
ORDER BY table_name, constraint_name;

SELECT
  COALESCE(
    EXISTS (
      SELECT 1
      FROM pg_constraint AS c
      WHERE c.contype = 'f'
        AND c.conrelid = to_regclass('public.medicine_cabinet')
        AND c.confrelid = to_regclass('public.medicines')
        AND cardinality(c.conkey) = 1
        AND cardinality(c.confkey) = 1
        AND c.conkey[1] = (
          SELECT a.attnum
          FROM pg_attribute AS a
          WHERE a.attrelid = c.conrelid
            AND a.attname = 'medicine_id'
            AND NOT a.attisdropped
        )
        AND c.confkey[1] = (
          SELECT a.attnum
          FROM pg_attribute AS a
          WHERE a.attrelid = c.confrelid
            AND a.attname = 'id'
            AND NOT a.attisdropped
        )
    ),
    false
  ) AS cabinet_medicine_id_references_medicines_id;

SELECT
  tbl.relname AS table_name,
  idx.relname AS index_name,
  i.indisprimary AS is_primary,
  i.indisunique AS is_unique,
  i.indisvalid AS is_valid,
  pg_get_indexdef(i.indexrelid) AS definition
FROM pg_index AS i
JOIN pg_class AS tbl ON tbl.oid = i.indrelid
JOIN pg_namespace AS ns ON ns.oid = tbl.relnamespace
JOIN pg_class AS idx ON idx.oid = i.indexrelid
WHERE ns.nspname = 'public'
  AND tbl.relname IN ('medicines', 'medicine_cabinet')
ORDER BY tbl.relname, idx.relname;

-- Only these allowlisted public-catalogue fields are returned. JSON access
-- keeps the projection usable even when deployed column names differ.
SELECT
  jsonb_strip_nulls(
    jsonb_build_object(
      'id', to_jsonb(m)->'id',
      'canonical_name', to_jsonb(m)->'canonical_name',
      'name', to_jsonb(m)->'name',
      'medicine_name', to_jsonb(m)->'medicine_name',
      'generic_name', to_jsonb(m)->'generic_name',
      'brand_name', to_jsonb(m)->'brand_name',
      'dosage_form', to_jsonb(m)->'dosage_form',
      'strength_value', to_jsonb(m)->'strength_value',
      'strength_unit', to_jsonb(m)->'strength_unit',
      'manufacturer_id', to_jsonb(m)->'manufacturer_id',
      'manufacturer_name', to_jsonb(m)->'manufacturer_name',
      'active_ingredient', to_jsonb(m)->'active_ingredient',
      'salt', to_jsonb(m)->'salt',
      'composition', to_jsonb(m)->'composition',
      'ingredients', to_jsonb(m)->'ingredients',
      'source_dataset', to_jsonb(m)->'source_dataset',
      'source_key', to_jsonb(m)->'source_key',
      'source', to_jsonb(m)->'source'
    )
  ) AS public_medicine
FROM public.medicines AS m
ORDER BY
  COALESCE(
    to_jsonb(m)->>'canonical_name',
    to_jsonb(m)->>'name',
    to_jsonb(m)->>'medicine_name',
    ''
  ),
  COALESCE(to_jsonb(m)->>'id', '')
LIMIT 250;

ROLLBACK;
