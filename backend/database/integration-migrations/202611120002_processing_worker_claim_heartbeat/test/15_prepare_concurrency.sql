\set ON_ERROR_STOP on
TRUNCATE public.processing_job_concurrency_probe;
UPDATE public.ai_jobs
SET status = 'queued', attempt_count = 0, available_at = clock_timestamp(),
    lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
    claim_generation = 0, started_at = NULL
WHERE job_type = 'prescription_analysis';
UPDATE public.prescriptions SET status = 'queued';
