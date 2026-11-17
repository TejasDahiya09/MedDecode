\set ON_ERROR_STOP on
\if :{?session_id}
\else
DO $$ BEGIN RAISE EXCEPTION 'session_id must be provided'; END $$;
\endif

BEGIN;
INSERT INTO public.processing_job_concurrency_probe (session_id, backend_pid, started_at)
VALUES (:'session_id'::integer, pg_backend_pid(), clock_timestamp());

SET LOCAL ROLE meddecode_worker;
SELECT
  coalesce(claim.job_id::text, '') AS job_id,
  coalesce(claim.claim_generation::text, '') AS claim_generation
FROM (VALUES (true)) AS one(row_present)
LEFT JOIN LATERAL public.claim_next_prescription_analysis_job_v1(
  'worker-concurrent-' || :'session_id', 120
) AS claim ON true
\gset claim_

SELECT pg_sleep(1);
RESET ROLE;
UPDATE public.processing_job_concurrency_probe
SET finished_at = clock_timestamp(),
    job_id = nullif(:'claim_job_id', '')::uuid,
    created = nullif(:'claim_job_id', '') IS NOT NULL
WHERE session_id = :'session_id'::integer;
COMMIT;
\echo CLAIM_RESULT :claim_job_id :claim_claim_generation
