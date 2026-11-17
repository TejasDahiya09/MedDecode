\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $guard$
DECLARE
  bad_insert_policy text;
  bad_update_policy text;
BEGIN
 IF EXISTS(SELECT FROM pg_roles WHERE rolname IN ('anon','authenticated') AND (rolsuper OR rolbypassrls))
 OR EXISTS(SELECT FROM pg_class WHERE oid IN ('public.medication_reminders'::regclass,'public.medication_dose_logs'::regclass) AND (relowner<>'postgres'::regrole OR NOT relrowsecurity))
 OR NOT EXISTS(SELECT FROM pg_constraint WHERE conrelid='public.medication_dose_logs'::regclass AND convalidated AND pg_get_constraintdef(oid) LIKE '%FOREIGN KEY (reminder_id, user_id) REFERENCES medication_reminders(id, user_id)%')
 OR NOT EXISTS(SELECT FROM pg_constraint WHERE conrelid='public.medication_dose_logs'::regclass AND contype='u' AND pg_get_constraintdef(oid) LIKE '%UNIQUE (reminder_id, dose_time)%')
 THEN RAISE EXCEPTION 'V2 baseline security or constraints unexpected'; END IF;
 IF current_database()<>'postgres' OR current_user<>'postgres' OR session_user<>'postgres'
 OR to_regclass('public.medication_reminders') IS NULL
 OR to_regclass('public.medication_dose_logs') IS NULL
 OR to_regclass('public.medicine_cabinet') IS NULL
 OR (SELECT count(*) FROM pg_policy WHERE polrelid='public.medication_reminders'::regclass)<>4
 OR (SELECT count(*) FROM pg_policy WHERE polrelid='public.medication_dose_logs'::regclass)<>4
 THEN RAISE EXCEPTION 'reminders security-fix deployment preconditions failed'; END IF;
 SELECT pg_get_expr(polwithcheck, polrelid) INTO bad_insert_policy
 FROM pg_policy
 WHERE polrelid='public.medication_reminders'::regclass
   AND polname='medication_reminders_owner_insert';
 SELECT pg_get_expr(polwithcheck, polrelid) INTO bad_update_policy
 FROM pg_policy
 WHERE polrelid='public.medication_reminders'::regclass
   AND polname='medication_reminders_owner_update';
 IF bad_insert_policy IS NULL OR bad_update_policy IS NULL OR bad_insert_policy NOT LIKE '%mc.id = mc.medicine_id%'
    OR bad_update_policy NOT LIKE '%mc.id = mc.medicine_id%' THEN
   RAISE EXCEPTION 'reminders security-fix expected deployed Cabinet policy defect is absent';
 END IF;
END $guard$;

-- Remove inherited/default anonymous access and leave authenticated with only
-- the API operations required by the existing repository contract.
REVOKE ALL PRIVILEGES ON TABLE public.medication_reminders FROM PUBLIC, anon, authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.medication_dose_logs FROM PUBLIC, anon, authenticated;
DO $revoke_column_privileges$
DECLARE
  target_table regclass;
  target_column record;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'public.medication_reminders'::regclass,
    'public.medication_dose_logs'::regclass
  ] LOOP
    FOR target_column IN
      SELECT attname
      FROM pg_attribute
      WHERE attrelid = target_table
        AND attnum > 0
        AND NOT attisdropped
    LOOP
      EXECUTE format(
        'REVOKE SELECT (%1$I), INSERT (%1$I), UPDATE (%1$I), REFERENCES (%1$I) ON TABLE %2$s FROM PUBLIC, anon, authenticated',
        target_column.attname,
        target_table
      );
    END LOOP;
  END LOOP;
END $revoke_column_privileges$;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.medication_reminders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.medication_dose_logs TO authenticated;

DROP POLICY medication_reminders_owner_insert ON public.medication_reminders;
DROP POLICY medication_reminders_owner_update ON public.medication_reminders;

-- The target table is qualified deliberately.  An unqualified medicine_id in
-- the EXISTS subquery resolves to medicine_cabinet.medicine_id on the hosted
-- schema, not to the new reminder row.
CREATE POLICY medication_reminders_owner_insert
  ON public.medication_reminders FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND (medicine_id IS NULL OR EXISTS (
      SELECT 1 FROM public.medicine_cabinet AS mc
      WHERE mc.id = public.medication_reminders.medicine_id
        AND mc.user_id = (SELECT auth.uid())
    ))
  );
CREATE POLICY medication_reminders_owner_update
  ON public.medication_reminders FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND (medicine_id IS NULL OR EXISTS (
      SELECT 1 FROM public.medicine_cabinet AS mc
      WHERE mc.id = public.medication_reminders.medicine_id
        AND mc.user_id = (SELECT auth.uid())
    ))
  );

-- Verify effective privileges before commit: inherited/global drift aborts all changes.
DO $effective$
DECLARE t regclass; r text; p text;
BEGIN
 FOREACH t IN ARRAY ARRAY['public.medication_reminders'::regclass,'public.medication_dose_logs'::regclass] LOOP
  FOREACH r IN ARRAY ARRAY['anon','meddecode_worker','meddecode_scoped_worker','meddecode_auto_worker_login'] LOOP
   IF to_regrole(r) IS NOT NULL THEN
    FOREACH p IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
     IF has_table_privilege(r,t,p) THEN RAISE EXCEPTION 'unexpected effective privilege for role %, table %, privilege %; broader change requires review',r,t,p; END IF;
    END LOOP;
    FOREACH p IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES'] LOOP
     IF has_any_column_privilege(r,t,p) THEN RAISE EXCEPTION 'unexpected effective column privilege for role %; broader change requires review',r; END IF;
    END LOOP;
   END IF;
  END LOOP;
  FOREACH p IN ARRAY ARRAY['TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
   IF has_table_privilege('authenticated',t,p) THEN RAISE EXCEPTION 'authenticated inherited excess privilege; broader change requires review'; END IF;
  END LOOP;
 END LOOP;
END $effective$;
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
COMMIT;
