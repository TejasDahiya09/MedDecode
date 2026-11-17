\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $check$
BEGIN
  IF to_regprocedure('auth.uid()') IS NULL OR to_regprocedure('public.submit_prescription_analysis_job_v1(uuid,jsonb)') IS NULL
     OR to_regclass('public.prescription_intelligence_results') IS NULL OR to_regrole('authenticated') IS NULL
     OR to_regrole('anon') IS NULL THEN RAISE EXCEPTION 'cancellation prerequisites missing'; END IF;
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.ai_jobs'::regclass
      AND conname='ai_jobs_status_check' AND contype='c') IS DISTINCT FROM
     'CHECK ((status = ANY (ARRAY[''queued''::text, ''processing''::text, ''completed''::text, ''failed''::text])))'
     OR has_column_privilege('authenticated','public.ai_jobs','status','UPDATE')
     OR has_column_privilege('anon','public.ai_jobs','status','UPDATE')
     OR to_regclass('public.prescription_job_cancellations') IS NOT NULL
     OR to_regprocedure('public.cancel_prescription_analysis_job_v1(uuid,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'unexpected cancellation deployment state';
  END IF;
END
$check$;
COMMIT;
SELECT 'CANCELLATION_PREFLIGHT_OK' AS marker;
