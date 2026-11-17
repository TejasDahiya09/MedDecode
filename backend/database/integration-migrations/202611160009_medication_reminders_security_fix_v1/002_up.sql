\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $guard$
DECLARE
  bad_insert_policy text;
  bad_update_policy text;
BEGIN
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
 IF bad_insert_policy NOT LIKE '%mc.id = mc.medicine_id%'
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
    auth.uid() = user_id
    AND (medicine_id IS NULL OR EXISTS (
      SELECT 1 FROM public.medicine_cabinet AS mc
      WHERE mc.id = public.medication_reminders.medicine_id
        AND mc.user_id = auth.uid()
    ))
  );
CREATE POLICY medication_reminders_owner_update
  ON public.medication_reminders FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND (medicine_id IS NULL OR EXISTS (
      SELECT 1 FROM public.medicine_cabinet AS mc
      WHERE mc.id = public.medication_reminders.medicine_id
        AND mc.user_id = auth.uid()
    ))
  );
COMMIT;
