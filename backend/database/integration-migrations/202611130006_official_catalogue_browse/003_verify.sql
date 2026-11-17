\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $check$ DECLARE f regprocedure := to_regprocedure('public.meddecode_official_catalogue_browse_v2(integer,integer,text)');
BEGIN
  IF f IS NULL OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=f AND pg_get_userbyid(proowner)='meddecode_catalogue_rpc_owner'
      AND prosecdef AND proconfig @> ARRAY['search_path=""'])
    OR NOT has_function_privilege('authenticated',f,'EXECUTE') OR has_function_privilege('anon',f,'EXECUTE')
    OR EXISTS (SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
       WHERE p.oid=f AND a.grantee=0 AND a.privilege_type='EXECUTE')
    OR has_schema_privilege('authenticated','official_catalogue','USAGE') OR has_schema_privilege('anon','official_catalogue','USAGE')
    OR has_table_privilege('authenticated','official_catalogue.formulations','SELECT') OR has_table_privilege('anon','official_catalogue.formulations','SELECT')
    OR EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.roleid=to_regrole('meddecode_catalogue_rpc_owner') AND m.grantor=(SELECT oid FROM pg_roles WHERE rolname=current_user) AND m.member=(SELECT oid FROM pg_roles WHERE rolname=current_user))
    OR has_schema_privilege('meddecode_catalogue_rpc_owner','public','CREATE') THEN
      RAISE EXCEPTION 'browse security verification failed';
  END IF;
END $check$;
SELECT 'BROWSE_VERIFY_OK';
ROLLBACK;
