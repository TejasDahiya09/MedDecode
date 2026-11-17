\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL statement_timeout='15s';
DO $check$
BEGIN
  IF current_setting('server_version_num')::int / 10000 <> 17
    OR to_regrole('meddecode_catalogue_rpc_owner') IS NULL
    OR to_regrole('authenticated') IS NULL OR to_regrole('anon') IS NULL
    OR to_regprocedure('public.meddecode_catalogue_request_uid()') IS NULL
    OR to_regprocedure('public.meddecode_official_catalogue_search_v1(text,integer,integer)') IS NULL
    OR to_regprocedure('public.meddecode_official_catalogue_browse_v2(integer,integer,text)') IS NOT NULL
    OR NOT has_function_privilege('meddecode_catalogue_rpc_owner','public.meddecode_catalogue_request_uid()','EXECUTE')
    OR has_schema_privilege('authenticated','official_catalogue','USAGE')
    OR has_schema_privilege('anon','official_catalogue','USAGE')
    OR has_schema_privilege('meddecode_catalogue_rpc_owner','public','CREATE')
    OR has_table_privilege('authenticated','official_catalogue.formulations','SELECT')
    OR has_table_privilege('anon','official_catalogue.formulations','SELECT')
    OR EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.roleid=to_regrole('meddecode_catalogue_rpc_owner') AND m.grantor=(SELECT oid FROM pg_roles WHERE rolname=current_user) AND m.member=(SELECT oid FROM pg_roles WHERE rolname=current_user)) THEN
      RAISE EXCEPTION 'browse migration prerequisites not met';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='meddecode_catalogue_rpc_owner'
    AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolinherit AND NOT rolbypassrls) THEN
      RAISE EXCEPTION 'unexpected RPC owner attributes';
  END IF;
END $check$;
SELECT 'BROWSE_PREFLIGHT_OK';
ROLLBACK;
