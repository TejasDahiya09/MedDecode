-- PREPARED ONLY. Separate approval required before hosted execution.
-- Use libpq service meddecode_hosted_admin with sslmode=verify-full and trusted CA.
-- Independently inspect psql \conninfo: project routing and client TLS cannot be
-- proven by database/session names or pg_stat_ssl behind Supavisor.
\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='5s';
SELECT current_database(),session_user,current_user,
 current_setting('server_version') AS server_version,
 (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS backend_hop_ssl;
DO $identity$
BEGIN
 IF current_database()<>'postgres' OR session_user<>'postgres' OR current_user<>'postgres'
 THEN RAISE EXCEPTION 'unexpected database/session identity'; END IF;
END $identity$;

SELECT n.nspname,c.relname,r.rolname AS owner,c.relrowsecurity,c.relforcerowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
JOIN pg_roles r ON r.oid=c.relowner
WHERE c.oid IN ('public.medication_reminders'::regclass,'public.medication_dose_logs'::regclass);
SELECT c.relname,CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS grantee,
 a.grantor::regrole AS grantor,a.privilege_type,a.is_grantable
FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
WHERE c.oid IN ('public.medication_reminders'::regclass,'public.medication_dose_logs'::regclass)
ORDER BY 1,2,4;
SELECT a.attrelid::regclass AS table_name,a.attname,
 CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE x.grantee::regrole::text END AS grantee,
 x.grantor::regrole,x.privilege_type,x.is_grantable
FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) x
WHERE a.attrelid IN ('public.medication_reminders'::regclass,'public.medication_dose_logs'::regclass)
 AND a.attnum>0 AND NOT a.attisdropped ORDER BY 1,2,3;

WITH roles AS (
 SELECT oid,rolname FROM pg_roles WHERE rolname IN
 ('anon','authenticated','meddecode_worker','meddecode_scoped_worker','meddecode_auto_worker_login','meddecode_scoped_worker_login')
), targets AS (
 SELECT unnest(ARRAY['public.medication_reminders'::regclass,'public.medication_dose_logs'::regclass]) AS t
)
SELECT rolname,t,privilege,has_table_privilege(oid,t,privilege) AS effective
FROM roles CROSS JOIN targets CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) privilege
ORDER BY 1,2,3;
WITH targets AS (
 SELECT unnest(ARRAY['public.medication_reminders'::regclass,'public.medication_dose_logs'::regclass]) t
)
SELECT r.rolname,t,privilege,has_any_column_privilege(r.oid,t,privilege) AS effective
FROM pg_roles r CROSS JOIN targets CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) privilege
WHERE r.rolname IN ('anon','authenticated','meddecode_worker','meddecode_scoped_worker','meddecode_auto_worker_login','meddecode_scoped_worker_login')
ORDER BY 1,2,3;

-- Transitive membership paths: distinguish automatic inheritance from SET ROLE.
WITH RECURSIVE paths AS (
 SELECT r.oid AS origin,r.oid AS reached,ARRAY[r.oid] AS path
 FROM pg_roles r WHERE r.rolname IN ('anon','authenticated')
 UNION ALL
 SELECT p.origin,m.roleid,p.path||m.roleid FROM paths p
 JOIN pg_auth_members m ON m.member=p.reached WHERE NOT m.roleid=ANY(p.path)
)
SELECT origin::regrole,reached::regrole,pg_has_role(origin,reached,'USAGE') AS inherits_now,
 pg_has_role(origin,reached,'SET') AS can_set_role,
 ARRAY(SELECT x::regrole::text FROM unnest(path) x) AS membership_path
FROM paths ORDER BY 1,2;
SELECT roleid::regrole,member::regrole,grantor::regrole,admin_option,inherit_option,set_option
FROM pg_auth_members ORDER BY 1,2;
SELECT rolname,rolsuper,rolinherit,rolbypassrls,rolcanlogin,
 has_schema_privilege(oid,'public','USAGE') AS public_usage,
 has_schema_privilege(oid,'public','CREATE') AS public_create
FROM pg_roles WHERE rolname IN ('anon','authenticated','postgres','meddecode_scoped_worker','meddecode_auto_worker_login');
SELECT d.defaclrole::regrole,d.defaclnamespace::regnamespace,d.defaclobjtype,
 CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END AS grantee,
 a.privilege_type,a.is_grantable
FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
WHERE d.defaclnamespace IN (0,'public'::regnamespace) ORDER BY 1,2,3,4;

SELECT p.polrelid::regclass,p.polname,p.polcmd,p.polpermissive,
 ARRAY(SELECT x::regrole::text FROM unnest(p.polroles) x) AS roles,
 pg_get_expr(p.polqual,p.polrelid) AS using_expression,
 pg_get_expr(p.polwithcheck,p.polrelid) AS with_check_expression
FROM pg_policy p WHERE p.polrelid IN
 ('public.medication_reminders'::regclass,'public.medication_dose_logs'::regclass)
ORDER BY 1,2;
-- Cabinet SELECT policies/grants determine whether authenticated EXISTS can see
-- the current user's linked row. No Cabinet records are returned.
SELECT polname,polcmd,pg_get_expr(polqual,polrelid) AS using_expression
FROM pg_policy WHERE polrelid='public.medicine_cabinet'::regclass;
SELECT has_table_privilege('authenticated','public.medicine_cabinet','SELECT') AS authenticated_cabinet_select;
SELECT conrelid::regclass,conname,contype,convalidated,pg_get_constraintdef(oid,true)
FROM pg_constraint WHERE conrelid IN
 ('public.medication_reminders'::regclass,'public.medication_dose_logs'::regclass)
ORDER BY 1,2;
SELECT 'medication_reminders' AS table_name,count(*) AS rows FROM public.medication_reminders
UNION ALL SELECT 'medication_dose_logs',count(*) FROM public.medication_dose_logs;
SELECT polname,
 pg_get_expr(polwithcheck,polrelid) LIKE '%mc.id = mc.medicine_id%' AS defective_correlation_observed,
 pg_get_expr(polwithcheck,polrelid) LIKE '%mc.id = medication_reminders.medicine_id%' AS corrected_correlation_observed
FROM pg_policy WHERE polrelid='public.medication_reminders'::regclass
 AND polname IN ('medication_reminders_owner_insert','medication_reminders_owner_update');
ROLLBACK;

