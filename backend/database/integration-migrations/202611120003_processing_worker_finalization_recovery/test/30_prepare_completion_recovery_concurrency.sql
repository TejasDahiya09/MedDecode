\set ON_ERROR_STOP on

-- Dedicated test-only probe. It is created only after the guarded reset and is
-- written outside the worker role, so worker table restrictions remain intact.
CREATE TABLE public.processing_finalization_concurrency_probe (
  session_id integer PRIMARY KEY CHECK (session_id IN (1, 2)),
  backend_pid integer NOT NULL,
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  outcome text,
  CHECK (outcome IS NULL OR outcome IN ('recovered', 'stale_completion_rejected'))
);

INSERT INTO public.prescriptions (id, user_id, storage_provider, storage_bucket, object_key, file_type, status)
VALUES ('83000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
  'aws_s3', 'local-test-bucket', 'private/prescriptions/completion-recovery/source.pdf', 'application/pdf', 'processing');
INSERT INTO public.ai_jobs (id, user_id, prescription_id, job_type, status, attempt_count, max_attempts, available_at, lease_owner, lease_expires_at, heartbeat_at, claim_generation)
VALUES ('73000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
  '83000000-0000-4000-8000-000000000001', 'prescription_analysis', 'processing', 1, 3,
  clock_timestamp(), 'worker-concurrency-001', clock_timestamp() - interval '1 second',
  clock_timestamp() - interval '2 seconds', 7);
\echo PHASE7_CONCURRENCY_FIXTURE_READY
