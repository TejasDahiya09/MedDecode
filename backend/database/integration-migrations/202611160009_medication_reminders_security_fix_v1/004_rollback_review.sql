-- REVIEW ONLY. Reintroducing anonymous access or the mis-correlated Cabinet
-- predicate is not an acceptable rollback.  Use a forward corrective migration.
\set ON_ERROR_STOP on
BEGIN;
DO $guard$
BEGIN
 IF EXISTS(SELECT FROM public.medication_reminders) OR EXISTS(SELECT FROM public.medication_dose_logs) THEN
   RAISE EXCEPTION 'security-fix rollback is unsafe once reminder data exists';
 END IF;
 RAISE EXCEPTION 'security-fix rollback intentionally unsupported; use a reviewed forward migration';
END $guard$;
ROLLBACK;
