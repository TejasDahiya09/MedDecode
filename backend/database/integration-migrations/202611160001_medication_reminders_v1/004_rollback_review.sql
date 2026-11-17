\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';

-- Drop policies
DROP POLICY IF EXISTS medication_dose_logs_owner_delete ON public.medication_dose_logs;
DROP POLICY IF EXISTS medication_dose_logs_owner_update ON public.medication_dose_logs;
DROP POLICY IF EXISTS medication_dose_logs_owner_insert ON public.medication_dose_logs;
DROP POLICY IF EXISTS medication_dose_logs_owner_select ON public.medication_dose_logs;

DROP POLICY IF EXISTS medication_reminders_owner_delete ON public.medication_reminders;
DROP POLICY IF EXISTS medication_reminders_owner_update ON public.medication_reminders;
DROP POLICY IF EXISTS medication_reminders_owner_insert ON public.medication_reminders;
DROP POLICY IF EXISTS medication_reminders_owner_select ON public.medication_reminders;

-- Drop tables
DROP TABLE IF EXISTS public.medication_dose_logs CASCADE;
DROP TABLE IF EXISTS public.medication_reminders CASCADE;

COMMIT;
