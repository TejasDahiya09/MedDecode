\set ON_ERROR_STOP on
\if :{?session_id}
\else
  DO $missing_session_id$
  BEGIN
    RAISE EXCEPTION 'session_id must be provided by the local concurrency harness';
  END
  $missing_session_id$;
\endif

INSERT INTO public.processing_job_concurrency_probe (
  session_id,
  backend_pid,
  started_at
) VALUES (
  :session_id,
  pg_backend_pid(),
  clock_timestamp()
);

-- Keep both independently launched sessions alive long enough for their
-- execution intervals to overlap before they contend on the prescription row.
SELECT pg_sleep(1);

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001', false);
SELECT job_id, created
FROM public.submit_prescription_analysis_job_v1(
  '70000000-0000-4000-8000-000000000007',
  '{"extract_prescription":true,"match_medicines":true,"find_alternatives":false,"generate_recommendations":true}'::jsonb
)\gset submission_
RESET ROLE;

UPDATE public.processing_job_concurrency_probe
SET finished_at = clock_timestamp(),
    job_id = :'submission_job_id'::uuid,
    created = :'submission_created'::boolean
WHERE session_id = :session_id;
\echo SUBMISSION_RESULT :submission_job_id :submission_created
