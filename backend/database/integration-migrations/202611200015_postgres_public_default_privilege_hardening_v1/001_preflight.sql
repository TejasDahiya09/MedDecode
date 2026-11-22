\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';

DO $preflight$
BEGIN
  IF current_database() IS DISTINCT FROM 'postgres'
     OR session_user IS DISTINCT FROM 'postgres'
     OR current_user IS DISTINCT FROM 'postgres'
     OR current_setting('transaction_read_only') IS DISTINCT FROM 'on'
     OR current_setting('server_version_num')::integer < 170000 THEN
    RAISE EXCEPTION 'postgres public default privilege preflight identity failure';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(ARRAY[
      'anon','authenticated','service_role','meddecode_scoped_worker','meddecode_worker','supabase_admin'
    ]) r(role_name) WHERE to_regrole(r.role_name) IS NULL
  ) THEN RAISE EXCEPTION 'required role is missing'; END IF;
  IF EXISTS (
    WITH actual AS (
      SELECT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END grantee,a.privilege_type
      FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
      WHERE d.defaclrole='postgres'::regrole AND d.defaclnamespace='public'::regnamespace AND d.defaclobjtype='r'
    ), expected AS (
      SELECT r.role_name,p.privilege_name FROM unnest(ARRAY['anon','authenticated','postgres','service_role']) r(role_name)
      CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p(privilege_name)
    )
    (SELECT * FROM actual EXCEPT SELECT * FROM expected)
    UNION ALL
    (SELECT * FROM expected EXCEPT SELECT * FROM actual)
  ) THEN RAISE EXCEPTION 'postgres public table default ACL drift'; END IF;
  IF EXISTS (
    WITH actual AS (
      SELECT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END grantee,a.privilege_type
      FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
      WHERE d.defaclrole='postgres'::regrole AND d.defaclnamespace='public'::regnamespace AND d.defaclobjtype='S'
    ), expected AS (
      SELECT r.role_name,p.privilege_name FROM unnest(ARRAY['anon','authenticated','postgres','service_role']) r(role_name)
      CROSS JOIN unnest(ARRAY['SELECT','UPDATE','USAGE']) p(privilege_name)
    )
    (SELECT * FROM actual EXCEPT SELECT * FROM expected)
    UNION ALL
    (SELECT * FROM expected EXCEPT SELECT * FROM actual)
  ) THEN RAISE EXCEPTION 'postgres public sequence default ACL drift'; END IF;
  IF EXISTS (
    WITH actual AS (
      SELECT CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END grantee,a.privilege_type
      FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
      WHERE d.defaclrole='postgres'::regrole AND d.defaclnamespace='public'::regnamespace AND d.defaclobjtype='f'
    ), expected AS (
      SELECT role_name,'EXECUTE'::text FROM unnest(ARRAY['anon','authenticated','postgres','service_role']) role_name
    )
    (SELECT * FROM actual EXCEPT SELECT * FROM expected)
    UNION ALL
    (SELECT * FROM expected EXCEPT SELECT * FROM actual)
  ) THEN RAISE EXCEPTION 'postgres public function default ACL drift'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_default_acl d
    WHERE d.defaclrole='postgres'::regrole
      AND (d.defaclnamespace=0 OR d.defaclobjtype='T')
  ) THEN RAISE EXCEPTION 'unexpected postgres global or type default ACL'; END IF;
END
$preflight$;

SELECT 'POSTGRES_PUBLIC_DEFAULT_PRIVILEGE_PREFLIGHT_OK' AS marker;
ROLLBACK;
