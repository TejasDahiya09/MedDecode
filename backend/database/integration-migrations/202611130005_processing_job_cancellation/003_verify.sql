\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $check$
DECLARE f oid := to_regprocedure('public.cancel_prescription_analysis_job_v1(uuid,uuid)');
BEGIN
  IF f IS NULL OR NOT (SELECT prosecdef AND proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid=f)
     OR NOT has_function_privilege('authenticated',f,'EXECUTE') OR has_function_privilege('anon',f,'EXECUTE')
     OR has_table_privilege('authenticated','public.prescription_job_cancellations','SELECT')
     OR has_table_privilege('authenticated','public.prescription_job_cancellations','INSERT')
     OR has_table_privilege('anon','public.prescription_job_cancellations','SELECT')
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.prescription_job_cancellations'::regclass)
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.ai_jobs'::regclass
       AND conname='ai_jobs_status_check' AND pg_get_constraintdef(oid) LIKE '%cancelled%') THEN
    RAISE EXCEPTION 'cancellation verification failed';
  END IF;
END
$check$;
COMMIT;
SELECT 'CANCELLATION_VERIFY_OK' AS marker;
