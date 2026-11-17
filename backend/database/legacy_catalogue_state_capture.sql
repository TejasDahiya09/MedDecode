\set ON_ERROR_STOP on
BEGIN READ ONLY;

SELECT current_database() AS database_name,
       current_setting('server_version') AS server_version,
       c.oid AS medicines_table_oid,
       c.relowner::regrole AS medicines_owner,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS force_rls,
       pg_total_relation_size(c.oid) AS relation_size_bytes,
       (SELECT count(*) FROM public.medicines) AS medicine_rows
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'medicines'
  AND c.relkind IN ('r', 'p');

SELECT a.attnum AS ordinal,
       a.attname AS column_name,
       format_type(a.atttypid, a.atttypmod) AS data_type,
       a.attnotnull AS not_null,
       pg_get_expr(d.adbin, d.adrelid) AS default_expression
FROM pg_attribute a
LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE a.attrelid = 'public.medicines'::regclass
  AND a.attnum > 0
  AND NOT a.attisdropped
ORDER BY a.attnum;

SELECT conname, contype, convalidated, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.medicines'::regclass
ORDER BY conname;

SELECT indexrelid::regclass AS index_name,
       indisunique,
       indisvalid,
       indisready,
       pg_get_indexdef(indexrelid) AS definition
FROM pg_index
WHERE indrelid = 'public.medicines'::regclass
ORDER BY indexrelid::regclass::text;

SELECT pol.polname, pol.polpermissive, pol.polroles::regrole[] AS roles,
       pol.polcmd, pg_get_expr(pol.polqual, pol.polrelid) AS using_expression,
       pg_get_expr(pol.polwithcheck, pol.polrelid) AS check_expression
FROM pg_policy pol
WHERE pol.polrelid = 'public.medicines'::regclass
ORDER BY pol.polname;

SELECT grantee, privilege_type, is_grantable
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name = 'medicines'
ORDER BY grantee, privilege_type;

COMMIT;
