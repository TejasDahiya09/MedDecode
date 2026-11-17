\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- Provenance only: default privileges explain future objects, not current grants.
SELECT c.relname, r.rolname AS owner, a.grantee::regrole, a.privilege_type
FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner
CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
WHERE c.oid IN ('public.medication_reminders'::regclass,'public.medication_dose_logs'::regclass);
SELECT a.attrelid::regclass,a.attname,x.grantee::regrole,x.privilege_type
FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) x
WHERE a.attrelid IN ('public.medication_reminders'::regclass,'public.medication_dose_logs'::regclass);
SELECT m.roleid::regrole,m.member::regrole,m.inherit_option,m.set_option
FROM pg_auth_members m WHERE m.member IN ('anon'::regrole,'authenticated'::regrole);
SELECT r.rolname,r.rolsuper,r.rolinherit,r.rolbypassrls,
 has_schema_privilege(r.oid,'public','USAGE') AS schema_usage,
 has_schema_privilege(r.oid,'public','CREATE') AS schema_create
FROM pg_roles r WHERE r.rolname IN ('anon','authenticated');
SELECT defaclrole::regrole,defaclnamespace::regnamespace,defaclobjtype,defaclacl
FROM pg_default_acl WHERE defaclnamespace IN (0,'public'::regnamespace);
DO $guard$
BEGIN
 IF current_database()<>'postgres' OR session_user<>'postgres' OR current_user<>'postgres'
 OR EXISTS(SELECT FROM pg_roles WHERE rolname IN ('anon','authenticated') AND (rolsuper OR rolbypassrls))
 OR EXISTS(SELECT FROM pg_class WHERE oid IN ('public.medication_reminders'::regclass,'public.medication_dose_logs'::regclass) AND (relowner<>'postgres'::regrole OR NOT relrowsecurity))
 OR NOT EXISTS(SELECT FROM pg_policy WHERE polrelid='public.medication_reminders'::regclass AND polname='medication_reminders_owner_insert' AND pg_get_expr(polwithcheck,polrelid) LIKE '%mc.id = mc.medicine_id%')
 OR NOT EXISTS(SELECT FROM pg_policy WHERE polrelid='public.medication_reminders'::regclass AND polname='medication_reminders_owner_update' AND pg_get_expr(polwithcheck,polrelid) LIKE '%mc.id = mc.medicine_id%')
 THEN RAISE EXCEPTION 'V2 expected defective baseline or identity not confirmed'; END IF;
END $guard$;
SELECT 'MEDICATION_REMINDERS_SECURITY_FIX_V2_PREFLIGHT_OK';
ROLLBACK;
