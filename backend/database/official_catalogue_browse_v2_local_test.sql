-- Transactional synthetic test: runner must validate the exact local target first.
DO $guard$ BEGIN
  IF current_database() <> 'meddecode_catalogue_rpc_runtime_20261113_01'
     OR inet_server_addr() <> '127.0.0.1'::inet OR inet_server_port() <> 5433
     OR current_setting('server_version_num')::int / 10000 <> 17 THEN
    RAISE EXCEPTION 'unexpected test target';
  END IF;
END $guard$;
BEGIN;
-- The older isolated fixture predates the deployed auth wrapper. Model it
-- transactionally without changing hosted auth or persistent local objects.
CREATE FUNCTION public.meddecode_catalogue_request_uid() RETURNS uuid
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS 'SELECT auth.uid()';
REVOKE ALL ON FUNCTION public.meddecode_catalogue_request_uid() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meddecode_catalogue_request_uid() TO meddecode_catalogue_rpc_owner;
GRANT CREATE ON SCHEMA public TO meddecode_catalogue_rpc_owner;
SET LOCAL ROLE meddecode_catalogue_rpc_owner;
\i backend/database/official_catalogue_browse_v2_review.sql
RESET ROLE;
REVOKE CREATE ON SCHEMA public FROM meddecode_catalogue_rpc_owner;
DO $privileges$ BEGIN
  IF (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid='public.meddecode_official_catalogue_browse_v2(integer,integer,text)'::regprocedure) <> 'meddecode_catalogue_rpc_owner'
     OR NOT has_function_privilege('authenticated','public.meddecode_official_catalogue_browse_v2(integer,integer,text)','EXECUTE')
     OR has_function_privilege('anon','public.meddecode_official_catalogue_browse_v2(integer,integer,text)','EXECUTE')
     OR has_table_privilege('authenticated','official_catalogue.formulations','SELECT')
     OR has_table_privilege('anon','official_catalogue.formulations','SELECT')
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.meddecode_official_catalogue_browse_v2(integer,integer,text)'::regprocedure AND prosecdef AND proconfig @> ARRAY['search_path=""']) THEN
    RAISE EXCEPTION 'privilege, ownership, or search_path check failed';
  END IF;
END $privileges$;
SET LOCAL ROLE anon;
DO $anonymous$ BEGIN
  BEGIN PERFORM public.meddecode_official_catalogue_browse_v2(1,0,NULL); RAISE EXCEPTION 'anonymous RPC unexpectedly succeeded'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM * FROM official_catalogue.formulations; RAISE EXCEPTION 'anonymous table access unexpectedly succeeded'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $anonymous$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','d9000000-0000-4000-8000-000000000001',true) IS NOT NULL;
DO $behavior$
DECLARE first_page jsonb; second_page jsonb; all_page jsonb; empty_page jsonb; filtered jsonb;
BEGIN
  first_page := public.meddecode_official_catalogue_browse_v2(1,0,NULL);
  second_page := public.meddecode_official_catalogue_browse_v2(1,1,NULL);
  all_page := public.meddecode_official_catalogue_browse_v2(50,0,NULL);
  empty_page := public.meddecode_official_catalogue_browse_v2(24,0,'Nonexistent');
  filtered := public.meddecode_official_catalogue_browse_v2(24,0,'Tablet');
  IF (first_page->>'total')::int < 2 OR (first_page->>'total')::int <> (all_page->>'total')::int
     OR first_page->'items'->0->>'id' = second_page->'items'->0->>'id'
     OR first_page->'items'->0 <> all_page->'items'->0
     OR second_page->'items'->0 <> all_page->'items'->1
     OR first_page->'items'->0->>'catalogue_source' <> 'official_catalogue'
     OR first_page->'items'->0->>'id_namespace' <> 'official_catalogue.formulation_id'
     OR first_page->'items'->0->>'id' !~ '^[0-9a-f-]{36}$'
     OR (empty_page->>'total')::int <> 0 OR jsonb_array_length(empty_page->'items') <> 0
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(filtered->'items') x WHERE lower(x->>'dosage_form') <> 'tablet') THEN
    RAISE EXCEPTION 'browse ordering, count, identity or filter failure';
  END IF;
  BEGIN PERFORM public.meddecode_official_catalogue_browse_v2(51,0,NULL); RAISE EXCEPTION 'invalid limit accepted'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM public.meddecode_official_catalogue_browse_v2(1,-1,NULL); RAISE EXCEPTION 'invalid offset accepted'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM public.meddecode_official_catalogue_browse_v2(1,0,'%'); RAISE EXCEPTION 'invalid form accepted'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM public.meddecode_official_catalogue_browse_v2(NULL,0,NULL); RAISE EXCEPTION 'null limit accepted'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
  BEGIN PERFORM * FROM official_catalogue.formulations; RAISE EXCEPTION 'direct table access unexpectedly succeeded'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $behavior$;
EXPLAIN (ANALYZE, TIMING OFF, SUMMARY ON) SELECT public.meddecode_official_catalogue_browse_v2(24,0,NULL);
RESET ROLE;
-- The target contains synthetic fixture records only; deletion is rolled back.
DO $fixture_guard$ BEGIN
  IF EXISTS (SELECT 1 FROM official_catalogue.catalogue_entities e
    LEFT JOIN official_catalogue.source_records s ON s.source_record_id=e.source_record_id
    LEFT JOIN official_catalogue.releases r ON r.release_id=s.release_id
    WHERE r.source_key IS DISTINCT FROM 'synthetic_test') THEN
    RAISE EXCEPTION 'non-synthetic catalogue evidence found';
  END IF;
END $fixture_guard$;
DELETE FROM official_catalogue.catalogue_entities;
SET LOCAL ROLE authenticated;
DO $empty$ DECLARE result jsonb; BEGIN
  result := public.meddecode_official_catalogue_browse_v2(24,0,NULL);
  IF (result->>'total')::int <> 0 OR jsonb_array_length(result->'items') <> 0 THEN RAISE EXCEPTION 'empty catalogue returned records'; END IF;
END $empty$;
RESET ROLE;
ROLLBACK;
SELECT to_regprocedure('public.meddecode_official_catalogue_browse_v2(integer,integer,text)') IS NULL AS rollback_verified;
