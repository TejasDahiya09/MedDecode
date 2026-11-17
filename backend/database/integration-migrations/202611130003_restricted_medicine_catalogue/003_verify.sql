\set ON_ERROR_STOP on
DO $verify$
DECLARE f regprocedure;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.meddecode_catalogue_search_v1(text,integer,integer)'::regprocedure,
                           'public.meddecode_catalogue_detail_v1(uuid)'::regprocedure] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=f AND p.prosecdef
      AND p.proowner='postgres'::regrole AND p.proconfig @> ARRAY['search_path=""'])
      OR NOT has_function_privilege('authenticated', f, 'EXECUTE')
      OR has_function_privilege('anon', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'catalogue RPC owner, search path or grant invalid: %', f;
    END IF;
  END LOOP;
END
$verify$;
-- Metadata checks do not replace real JWT and anonymous PostgREST tests.
