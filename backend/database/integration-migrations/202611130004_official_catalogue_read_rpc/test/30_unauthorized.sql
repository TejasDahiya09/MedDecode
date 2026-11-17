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
\echo 'authorization tests are restricted to the requested disposable database'
SELECT 1 / 0;
\endif

BEGIN READ ONLY;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub', 'd9000000-0000-4000-8000-000000000001', true);
DO $authorization$
BEGIN
  BEGIN
    PERFORM * FROM public.meddecode_official_catalogue_search_v1('synthetic fixture', 1, 0);
    RAISE EXCEPTION 'anon unexpectedly executed the official search RPC';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.meddecode_official_catalogue_detail_v1('d2000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'anon unexpectedly executed the official detail RPC';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM official_catalogue.catalogue_entities LIMIT 1;
    RAISE EXCEPTION 'anon read the underlying catalogue table';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$authorization$;
ROLLBACK;
