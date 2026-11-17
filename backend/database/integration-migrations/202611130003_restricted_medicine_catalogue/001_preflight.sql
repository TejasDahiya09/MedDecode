\set ON_ERROR_STOP on
-- Read-only prerequisites. No application data is inspected.
DO $preflight$
DECLARE t text;
BEGIN
  IF to_regrole('authenticated') IS NULL OR to_regrole('anon') IS NULL OR to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'authentication prerequisites missing';
  END IF;
  FOREACH t IN ARRAY ARRAY['medicines','medicine_aliases','active_ingredients','medicine_ingredients','manufacturers','medicine_sources','medicine_prices'] LOOP
    IF to_regclass('public.' || t) IS NULL OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=t AND c.relrowsecurity AND c.relkind IN ('r','p')
    ) THEN RAISE EXCEPTION 'required RLS catalogue table missing: %', t; END IF;
  END LOOP;
  IF to_regprocedure('public.meddecode_catalogue_search_v1(text,integer,integer)') IS NOT NULL
     OR to_regprocedure('public.meddecode_catalogue_detail_v1(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'target function name already exists';
  END IF;
END
$preflight$;
