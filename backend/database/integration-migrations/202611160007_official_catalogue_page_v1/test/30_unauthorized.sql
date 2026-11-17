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
\echo 'catalogue authorization tests require the requested disposable fixture database'
SELECT 1 / 0;
\endif

BEGIN READ ONLY;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub', 'd9000000-0000-4000-8000-000000000001', true);
DO $authorization$
BEGIN
  BEGIN
    PERFORM public.meddecode_official_catalogue_page_v1(NULL, NULL, 10, 0);
    RAISE EXCEPTION 'anon unexpectedly executed the official catalogue page RPC';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM official_catalogue.catalogue_entities LIMIT 1;
    RAISE EXCEPTION 'anon read the underlying official catalogue table';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$authorization$;
ROLLBACK;
