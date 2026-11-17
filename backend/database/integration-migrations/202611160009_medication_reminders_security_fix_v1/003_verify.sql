\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $verify$
DECLARE q text; w text;
BEGIN
 IF current_database()<>'postgres' OR current_user<>'postgres' OR session_user<>'postgres'
 OR NOT EXISTS(SELECT FROM pg_class WHERE oid='public.medication_reminders'::regclass AND relrowsecurity)
 OR NOT EXISTS(SELECT FROM pg_class WHERE oid='public.medication_dose_logs'::regclass AND relrowsecurity)
 OR has_table_privilege('anon','public.medication_reminders','SELECT')
 OR has_table_privilege('anon','public.medication_reminders','INSERT')
 OR has_table_privilege('anon','public.medication_reminders','UPDATE')
 OR has_table_privilege('anon','public.medication_reminders','DELETE')
 OR has_table_privilege('anon','public.medication_reminders','TRUNCATE')
 OR has_table_privilege('anon','public.medication_reminders','REFERENCES')
 OR has_table_privilege('anon','public.medication_reminders','TRIGGER')
 OR has_table_privilege('anon','public.medication_reminders','MAINTAIN')
 OR has_table_privilege('anon','public.medication_dose_logs','SELECT')
 OR has_table_privilege('anon','public.medication_dose_logs','INSERT')
 OR has_table_privilege('anon','public.medication_dose_logs','UPDATE')
 OR has_table_privilege('anon','public.medication_dose_logs','DELETE')
 OR has_table_privilege('anon','public.medication_dose_logs','TRUNCATE')
 OR has_table_privilege('anon','public.medication_dose_logs','REFERENCES')
 OR has_table_privilege('anon','public.medication_dose_logs','TRIGGER')
 OR has_table_privilege('anon','public.medication_dose_logs','MAINTAIN')
 OR has_any_column_privilege('anon','public.medication_reminders','SELECT')
 OR has_any_column_privilege('anon','public.medication_reminders','INSERT')
 OR has_any_column_privilege('anon','public.medication_reminders','UPDATE')
 OR has_any_column_privilege('anon','public.medication_reminders','REFERENCES')
 OR has_any_column_privilege('anon','public.medication_dose_logs','SELECT')
 OR has_any_column_privilege('anon','public.medication_dose_logs','INSERT')
 OR has_any_column_privilege('anon','public.medication_dose_logs','UPDATE')
 OR has_any_column_privilege('anon','public.medication_dose_logs','REFERENCES')
 OR NOT has_table_privilege('authenticated','public.medication_reminders','SELECT')
 OR NOT has_table_privilege('authenticated','public.medication_reminders','INSERT')
 OR NOT has_table_privilege('authenticated','public.medication_reminders','UPDATE')
 OR NOT has_table_privilege('authenticated','public.medication_reminders','DELETE')
 OR NOT has_table_privilege('authenticated','public.medication_dose_logs','SELECT')
 OR NOT has_table_privilege('authenticated','public.medication_dose_logs','INSERT')
 OR NOT has_table_privilege('authenticated','public.medication_dose_logs','UPDATE')
 OR NOT has_table_privilege('authenticated','public.medication_dose_logs','DELETE')
 OR has_table_privilege('authenticated','public.medication_reminders','TRUNCATE')
 OR has_table_privilege('authenticated','public.medication_reminders','REFERENCES')
 OR has_table_privilege('authenticated','public.medication_reminders','TRIGGER')
 OR has_table_privilege('authenticated','public.medication_reminders','MAINTAIN')
 OR has_table_privilege('authenticated','public.medication_dose_logs','TRUNCATE')
 OR has_table_privilege('authenticated','public.medication_dose_logs','REFERENCES')
 OR has_table_privilege('authenticated','public.medication_dose_logs','TRIGGER')
 OR has_table_privilege('authenticated','public.medication_dose_logs','MAINTAIN')
 OR EXISTS (
   SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
   WHERE c.oid IN ('public.medication_reminders'::regclass, 'public.medication_dose_logs'::regclass)
     AND a.grantee = 0
 )
 OR EXISTS (
   SELECT 1 FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) acl
   WHERE a.attrelid IN ('public.medication_reminders'::regclass, 'public.medication_dose_logs'::regclass)
     AND a.attnum > 0 AND NOT a.attisdropped AND acl.grantee = 0
 )
 THEN RAISE EXCEPTION 'reminders ACL verification failed'; END IF;
 SELECT pg_get_expr(polwithcheck,polrelid) INTO w FROM pg_policy WHERE polrelid='public.medication_reminders'::regclass AND polname='medication_reminders_owner_insert';
 IF w IS NULL OR w NOT LIKE '%medication_reminders.medicine_id%' OR w NOT LIKE '%mc.user_id = auth.uid()%' THEN RAISE EXCEPTION 'reminder insert Cabinet predicate invalid: %',w; END IF;
 SELECT pg_get_expr(polqual,polrelid),pg_get_expr(polwithcheck,polrelid) INTO q,w FROM pg_policy WHERE polrelid='public.medication_reminders'::regclass AND polname='medication_reminders_owner_update';
 IF q NOT LIKE '%auth.uid() = user_id%' OR w NOT LIKE '%medication_reminders.medicine_id%' OR w NOT LIKE '%mc.user_id = auth.uid()%' THEN RAISE EXCEPTION 'reminder update Cabinet predicate invalid'; END IF;
 IF NOT EXISTS(SELECT FROM pg_constraint WHERE conrelid='public.medication_dose_logs'::regclass AND conname='medication_dose_logs_reminder_user_fkey' AND pg_get_constraintdef(oid) LIKE '%REFERENCES medication_reminders(id, user_id)%')
 OR NOT EXISTS(SELECT FROM pg_constraint WHERE conrelid='public.medication_reminders'::regclass AND confrelid='public.medicine_cabinet'::regclass AND pg_get_constraintdef(oid) LIKE '%REFERENCES medicine_cabinet(id) ON DELETE SET NULL%')
 OR NOT EXISTS(SELECT FROM pg_constraint WHERE conrelid='public.medication_dose_logs'::regclass AND pg_get_constraintdef(oid) LIKE '%UNIQUE (reminder_id, dose_time)%')
 OR (SELECT count(*) FROM pg_policy WHERE polrelid='public.medication_reminders'::regclass)<>4
 OR (SELECT count(*) FROM pg_policy WHERE polrelid='public.medication_dose_logs'::regclass)<>4
 THEN RAISE EXCEPTION 'reminders constraint or policy verification failed'; END IF;
END $verify$;
SELECT 'MEDICATION_REMINDERS_SECURITY_FIX_VERIFY_OK';
ROLLBACK;
