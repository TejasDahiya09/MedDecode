\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='2s';
SET LOCAL search_path=pg_catalog,public;
DO $verify$
DECLARE e record; actual record; t regclass; role_row record; privilege text;
BEGIN
 IF current_database()<>'postgres' OR session_user<>'postgres' OR current_user<>'postgres'
 THEN RAISE EXCEPTION 'verification identity failure'; END IF;
 FOREACH t IN ARRAY ARRAY['public.medication_reminders'::regclass,'public.medication_dose_logs'::regclass] LOOP
  IF NOT EXISTS(SELECT FROM pg_class WHERE oid=t AND relowner='postgres'::regrole AND relrowsecurity)
  OR (SELECT count(*) FROM pg_policy WHERE polrelid=t)<>4 THEN RAISE EXCEPTION 'verification owner, RLS or policy count failure'; END IF;
  IF EXISTS(SELECT FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid=t AND a.grantee=0)
  OR EXISTS(SELECT FROM pg_attribute c CROSS JOIN LATERAL aclexplode(c.attacl) a WHERE c.attrelid=t AND a.grantee=0)
  THEN RAISE EXCEPTION 'verification PUBLIC ACL failure'; END IF;
  FOR role_row IN SELECT r.oid,r.rolname FROM pg_roles r WHERE
    r.rolname IN ('anon','authenticated') OR
    (r.rolname<>'postgres' AND
      (r.rolname LIKE 'meddecode%worker%' OR r.rolname='meddecode_scoped_login'
       OR (NOT r.rolsuper AND EXISTS(SELECT FROM pg_roles w WHERE w.rolname IN ('meddecode_worker','meddecode_scoped_worker') AND pg_has_role(r.oid,w.oid,'MEMBER')))))
  LOOP
   FOREACH privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
    IF has_table_privilege(role_row.oid,t,privilege) IS DISTINCT FROM
       (role_row.rolname='authenticated' AND privilege IN ('SELECT','INSERT','UPDATE','DELETE'))
    THEN RAISE EXCEPTION 'verification effective table privilege failure: %, %, %',role_row.rolname,t,privilege; END IF;
   END LOOP;
   FOREACH privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES'] LOOP
    IF has_any_column_privilege(role_row.oid,t,privilege) IS DISTINCT FROM
       (role_row.rolname='authenticated' AND privilege IN ('SELECT','INSERT','UPDATE'))
    THEN RAISE EXCEPTION 'verification effective column privilege failure: %, %, %',role_row.rolname,t,privilege; END IF;
   END LOOP;
   IF EXISTS(SELECT FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE c.oid=t AND a.grantee=role_row.oid AND
      (role_row.rolname<>'authenticated' OR a.privilege_type NOT IN ('SELECT','INSERT','UPDATE','DELETE') OR a.is_grantable))
   OR EXISTS(SELECT FROM pg_attribute c CROSS JOIN LATERAL aclexplode(c.attacl) a WHERE c.attrelid=t AND a.grantee=role_row.oid AND
      (role_row.rolname<>'authenticated' OR a.privilege_type NOT IN ('SELECT','INSERT','UPDATE') OR a.is_grantable))
   THEN RAISE EXCEPTION 'verification direct ACL failure'; END IF;
  END LOOP;
 END LOOP;
 FOR e IN SELECT * FROM (VALUES
('medication_reminders','medication_reminders_owner_select','r','(auth.uid() = user_id)',NULL),
('medication_reminders','medication_reminders_owner_insert','a',NULL,'((( SELECT auth.uid() AS uid) = user_id) AND ((medicine_id IS NULL) OR (EXISTS ( SELECT 1 FROM medicine_cabinet mc WHERE ((mc.id = medication_reminders.medicine_id) AND (mc.user_id = ( SELECT auth.uid() AS uid)))))))'),
('medication_reminders','medication_reminders_owner_update','w','(( SELECT auth.uid() AS uid) = user_id)','((( SELECT auth.uid() AS uid) = user_id) AND ((medicine_id IS NULL) OR (EXISTS ( SELECT 1 FROM medicine_cabinet mc WHERE ((mc.id = medication_reminders.medicine_id) AND (mc.user_id = ( SELECT auth.uid() AS uid)))))))'),
('medication_reminders','medication_reminders_owner_delete','d','(auth.uid() = user_id)',NULL),
('medication_dose_logs','medication_dose_logs_owner_select','r','(auth.uid() = user_id)',NULL),
('medication_dose_logs','medication_dose_logs_owner_insert','a',NULL,'((auth.uid() = user_id) AND (EXISTS ( SELECT 1 FROM medication_reminders r WHERE ((r.id = medication_dose_logs.reminder_id) AND (r.user_id = auth.uid())))))'),
('medication_dose_logs','medication_dose_logs_owner_update','w','(auth.uid() = user_id)','((auth.uid() = user_id) AND (EXISTS ( SELECT 1 FROM medication_reminders r WHERE ((r.id = medication_dose_logs.reminder_id) AND (r.user_id = auth.uid())))))'),
('medication_dose_logs','medication_dose_logs_owner_delete','d','(auth.uid() = user_id)',NULL)
 ) expected(table_name,policy_name,command,using_expr,check_expr)
 LOOP
  SELECT * INTO actual FROM pg_policy WHERE polrelid=('public.'||e.table_name)::regclass AND polname=e.policy_name;
  IF NOT FOUND THEN RAISE EXCEPTION 'verification missing policy: %',e.policy_name; END IF;
  IF actual.polcmd::text IS DISTINCT FROM e.command OR actual.polpermissive IS DISTINCT FROM true
   OR actual.polroles IS DISTINCT FROM ARRAY['authenticated'::regrole::oid]
   OR regexp_replace(pg_get_expr(actual.polqual,actual.polrelid),'\s+','','g') IS DISTINCT FROM regexp_replace(e.using_expr,'\s+','','g')
   OR regexp_replace(pg_get_expr(actual.polwithcheck,actual.polrelid),'\s+','','g') IS DISTINCT FROM regexp_replace(e.check_expr,'\s+','','g')
  THEN RAISE EXCEPTION 'verification exact policy mismatch: %',e.policy_name; END IF;
 END LOOP;
 IF NOT EXISTS(SELECT FROM pg_constraint WHERE conrelid='public.medication_dose_logs'::regclass AND convalidated AND contype='f' AND pg_get_constraintdef(oid)='FOREIGN KEY (reminder_id, user_id) REFERENCES medication_reminders(id, user_id) ON DELETE CASCADE')
 OR NOT EXISTS(SELECT FROM pg_constraint WHERE conrelid='public.medication_dose_logs'::regclass AND convalidated AND contype='u' AND pg_get_constraintdef(oid)='UNIQUE (reminder_id, dose_time)')
 THEN RAISE EXCEPTION 'verification dose-log constraints failure'; END IF;
END $verify$;
-- Diagnostic metadata, no patient records; no membership/default changes.
SELECT roleid::regrole,member::regrole,inherit_option,set_option FROM pg_auth_members
WHERE member IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon','authenticated') OR rolname LIKE 'meddecode%worker%');
SELECT rolname,rolinherit,rolsuper,rolbypassrls,has_schema_privilege(oid,'public','USAGE') AS schema_usage,has_schema_privilege(oid,'public','CREATE') AS schema_create
FROM pg_roles WHERE rolname IN ('anon','authenticated') OR rolname LIKE 'meddecode%worker%';
SELECT defaclrole::regrole,defaclnamespace::regnamespace,defaclobjtype,defaclacl FROM pg_default_acl WHERE defaclnamespace IN (0,'public'::regnamespace);
SELECT 'MEDICATION_REMINDERS_SECURITY_FIX_V2_VERIFY_OK';
ROLLBACK;
