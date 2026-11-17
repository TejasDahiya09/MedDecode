\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $guard$
DECLARE
  bad_insert_policy text;
  bad_update_policy text;
BEGIN
 IF current_database()<>'postgres' OR current_user<>'postgres' OR session_user<>'postgres'
 OR to_regclass('public.medication_reminders') IS NULL
 OR to_regclass('public.medication_dose_logs') IS NULL
 OR to_regclass('public.medicine_cabinet') IS NULL
 OR NOT EXISTS(SELECT FROM pg_class WHERE oid='public.medication_reminders'::regclass AND relrowsecurity)
 OR NOT EXISTS(SELECT FROM pg_class WHERE oid='public.medication_dose_logs'::regclass AND relrowsecurity)
 OR (SELECT count(*) FROM pg_policy WHERE polrelid='public.medication_reminders'::regclass)<>4
 OR (SELECT count(*) FROM pg_policy WHERE polrelid='public.medication_dose_logs'::regclass)<>4
 OR NOT has_table_privilege('anon','public.medication_reminders','SELECT')
 OR NOT has_table_privilege('anon','public.medication_reminders','INSERT')
 OR NOT has_table_privilege('anon','public.medication_reminders','UPDATE')
 OR NOT has_table_privilege('anon','public.medication_reminders','DELETE')
 OR NOT has_table_privilege('anon','public.medication_reminders','TRUNCATE')
 OR NOT has_table_privilege('anon','public.medication_reminders','REFERENCES')
 OR NOT has_table_privilege('anon','public.medication_reminders','TRIGGER')
 OR NOT has_table_privilege('anon','public.medication_reminders','MAINTAIN')
 OR NOT has_table_privilege('anon','public.medication_dose_logs','SELECT')
 OR NOT has_table_privilege('anon','public.medication_dose_logs','INSERT')
 OR NOT has_table_privilege('anon','public.medication_dose_logs','UPDATE')
 OR NOT has_table_privilege('anon','public.medication_dose_logs','DELETE')
 OR NOT has_table_privilege('anon','public.medication_dose_logs','TRUNCATE')
 OR NOT has_table_privilege('anon','public.medication_dose_logs','REFERENCES')
 OR NOT has_table_privilege('anon','public.medication_dose_logs','TRIGGER')
 OR NOT has_table_privilege('anon','public.medication_dose_logs','MAINTAIN')
 THEN RAISE EXCEPTION 'reminders security-fix preflight failed'; END IF;
 SELECT pg_get_expr(polwithcheck, polrelid) INTO bad_insert_policy
 FROM pg_policy
 WHERE polrelid='public.medication_reminders'::regclass
   AND polname='medication_reminders_owner_insert';
 SELECT pg_get_expr(polwithcheck, polrelid) INTO bad_update_policy
 FROM pg_policy
 WHERE polrelid='public.medication_reminders'::regclass
   AND polname='medication_reminders_owner_update';
 IF bad_insert_policy NOT LIKE '%mc.id = mc.medicine_id%'
    OR bad_update_policy NOT LIKE '%mc.id = mc.medicine_id%' THEN
   RAISE EXCEPTION 'reminders security-fix expected deployed Cabinet policy defect is absent';
 END IF;
END $guard$;
SELECT 'MEDICATION_REMINDERS_SECURITY_FIX_PREFLIGHT_OK';
ROLLBACK;
