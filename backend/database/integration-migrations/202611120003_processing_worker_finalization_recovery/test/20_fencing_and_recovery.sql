\set ON_ERROR_STOP on

-- DISPOSABLE LOCAL TEST ONLY. These rows are created after the guarded reset.
-- Test setup runs as postgres; every finalization/recovery call below runs as
-- meddecode_worker, which has EXECUTE only and no application-table rights.
INSERT INTO public.prescriptions (id, user_id, storage_provider, storage_bucket, object_key, file_type, status)
VALUES
  ('81000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'aws_s3', 'local-test-bucket', 'private/prescriptions/failure-retry/source.pdf', 'application/pdf', 'processing'),
  ('81000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'aws_s3', 'local-test-bucket', 'private/prescriptions/failure-terminal/source.pdf', 'application/pdf', 'processing'),
  ('81000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'aws_s3', 'local-test-bucket', 'private/prescriptions/failure-exhausted/source.pdf', 'application/pdf', 'processing'),
  ('81000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 'aws_s3', 'local-test-bucket', 'private/prescriptions/failure-invalid/source.pdf', 'application/pdf', 'processing'),
  ('81000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', 'aws_s3', 'local-test-bucket', 'private/prescriptions/failure-wrong-worker/source.pdf', 'application/pdf', 'processing'),
  ('81000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001', 'aws_s3', 'local-test-bucket', 'private/prescriptions/failure-stale/source.pdf', 'application/pdf', 'processing'),
  ('81000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000001', 'aws_s3', 'local-test-bucket', 'private/prescriptions/failure-expired/source.pdf', 'application/pdf', 'processing'),
  ('82000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'aws_s3', 'local-test-bucket', 'private/prescriptions/recoverable/source.pdf', 'application/pdf', 'processing'),
  ('82000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', 'aws_s3', 'local-test-bucket', 'private/prescriptions/exhausted/source.pdf', 'application/pdf', 'processing'),
  ('82000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', 'aws_s3', 'local-test-bucket', 'private/prescriptions/healthy/source.pdf', 'application/pdf', 'processing'),
  ('82000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', 'aws_s3', 'local-test-bucket', 'private/prescriptions/batch-one/source.pdf', 'application/pdf', 'processing'),
  ('82000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', 'aws_s3', 'local-test-bucket', 'private/prescriptions/batch-two/source.pdf', 'application/pdf', 'processing');

INSERT INTO public.ai_jobs (id, user_id, prescription_id, job_type, status, attempt_count, max_attempts, available_at, lease_owner, lease_expires_at, heartbeat_at, claim_generation)
VALUES
  ('71000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', 'prescription_analysis', 'processing', 1, 3, clock_timestamp(), 'worker-failure-001', clock_timestamp() + interval '10 minutes', clock_timestamp(), 1),
  ('71000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000002', 'prescription_analysis', 'processing', 1, 3, clock_timestamp(), 'worker-failure-002', clock_timestamp() + interval '10 minutes', clock_timestamp(), 1),
  ('71000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000003', 'prescription_analysis', 'processing', 3, 3, clock_timestamp(), 'worker-failure-003', clock_timestamp() + interval '10 minutes', clock_timestamp(), 1),
  ('71000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000004', 'prescription_analysis', 'processing', 1, 3, clock_timestamp(), 'worker-failure-004', clock_timestamp() + interval '10 minutes', clock_timestamp(), 1),
  ('71000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000005', 'prescription_analysis', 'processing', 1, 3, clock_timestamp(), 'worker-failure-005', clock_timestamp() + interval '10 minutes', clock_timestamp(), 1),
  ('71000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000006', 'prescription_analysis', 'processing', 1, 3, clock_timestamp(), 'worker-failure-006', clock_timestamp() + interval '10 minutes', clock_timestamp(), 3),
  ('71000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000007', 'prescription_analysis', 'processing', 1, 3, clock_timestamp(), 'worker-failure-007', clock_timestamp() - interval '1 second', clock_timestamp() - interval '2 seconds', 1),
  ('72000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000001', 'prescription_analysis', 'processing', 1, 3, clock_timestamp(), 'worker-expired-001', clock_timestamp() - interval '1 minute', clock_timestamp() - interval '2 minutes', 4),
  ('72000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000002', 'prescription_analysis', 'processing', 3, 3, clock_timestamp(), 'worker-expired-002', clock_timestamp() - interval '1 minute', clock_timestamp() - interval '2 minutes', 8),
  ('72000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000003', 'prescription_analysis', 'processing', 1, 3, clock_timestamp(), 'worker-healthy-001', clock_timestamp() + interval '10 minutes', clock_timestamp(), 3),
  ('72000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000004', 'prescription_analysis', 'processing', 1, 3, clock_timestamp(), 'worker-batch-001', clock_timestamp() - interval '2 minutes', clock_timestamp() - interval '3 minutes', 2),
  ('72000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000001', '82000000-0000-4000-8000-000000000005', 'prescription_analysis', 'processing', 1, 3, clock_timestamp(), 'worker-batch-002', clock_timestamp() - interval '3 minutes', clock_timestamp() - interval '4 minutes', 2);

SET ROLE meddecode_worker;
SELECT * FROM public.fail_prescription_analysis_job_v1('71000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000001', 'worker-failure-001', 1, 'INTELLIGENCE_TRANSPORT_FAILED', true, NULL, clock_timestamp() + interval '5 minutes');
SELECT * FROM public.fail_prescription_analysis_job_v1('71000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000002', 'worker-failure-002', 1, 'INTELLIGENCE_REJECTED', false, 'PROCESSING_FAILED', NULL);
SELECT * FROM public.fail_prescription_analysis_job_v1('71000000-0000-4000-8000-000000000003', '81000000-0000-4000-8000-000000000003', 'worker-failure-003', 1, 'INTELLIGENCE_TRANSPORT_FAILED', true, NULL, NULL);

DO $expected_failures$
BEGIN
  BEGIN
    PERFORM public.fail_prescription_analysis_job_v1('71000000-0000-4000-8000-000000000004', '81000000-0000-4000-8000-000000000004', 'worker-failure-004', 1, 'INTELLIGENCE_TRANSPORT_FAILED', NULL, NULL, NULL);
    RAISE EXCEPTION 'NULL retryable flag unexpectedly accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.fail_prescription_analysis_job_v1('71000000-0000-4000-8000-000000000004', '81000000-0000-4000-8000-000000000004', 'worker-failure-004', 1, 'UNSAFE_PROVIDER_MESSAGE', false, NULL, NULL);
    RAISE EXCEPTION 'unsafe failure code unexpectedly accepted';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.fail_prescription_analysis_job_v1('71000000-0000-4000-8000-000000000005', '81000000-0000-4000-8000-000000000005', 'worker-not-owner-001', 1, 'INTELLIGENCE_REJECTED', false, NULL, NULL);
    RAISE EXCEPTION 'wrong worker unexpectedly finalized';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
  BEGIN
    PERFORM public.fail_prescription_analysis_job_v1('71000000-0000-4000-8000-000000000006', '81000000-0000-4000-8000-000000000006', 'worker-failure-006', 2, 'INTELLIGENCE_REJECTED', false, NULL, NULL);
    RAISE EXCEPTION 'stale generation unexpectedly finalized';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
  BEGIN
    PERFORM public.fail_prescription_analysis_job_v1('71000000-0000-4000-8000-000000000007', '81000000-0000-4000-8000-000000000007', 'worker-failure-007', 1, 'INTELLIGENCE_REJECTED', false, NULL, NULL);
    RAISE EXCEPTION 'expired lease unexpectedly finalized';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
END
$expected_failures$;

SELECT * FROM public.recover_expired_prescription_analysis_jobs_v1(1);
RESET ROLE;

-- The expired-lease rejection case is intentionally not a recovery fixture.
-- Restore its test-only lease so the following batch proves only its own rows.
UPDATE public.ai_jobs
SET lease_expires_at = clock_timestamp() + interval '10 minutes', heartbeat_at = clock_timestamp()
WHERE id = '71000000-0000-4000-8000-000000000007';

SELECT 1 / CASE WHEN
  (SELECT count(*) FROM public.ai_jobs WHERE id IN ('72000000-0000-4000-8000-000000000004', '72000000-0000-4000-8000-000000000005') AND status = 'queued') = 1
  AND (SELECT count(*) FROM public.ai_jobs WHERE id IN ('72000000-0000-4000-8000-000000000004', '72000000-0000-4000-8000-000000000005') AND status = 'processing') = 1
  THEN 1 ELSE 0 END AS recovery_batch_limit_assertion;

SET ROLE meddecode_worker;
SELECT * FROM public.recover_expired_prescription_analysis_jobs_v1(50);
SELECT * FROM public.recover_expired_prescription_analysis_jobs_v1(50);
RESET ROLE;

SELECT 1 / CASE WHEN
  (SELECT status FROM public.ai_jobs WHERE id = '71000000-0000-4000-8000-000000000001') = 'queued'
  AND (SELECT available_at > clock_timestamp() FROM public.ai_jobs WHERE id = '71000000-0000-4000-8000-000000000001')
  AND (SELECT lease_owner IS NULL AND lease_expires_at IS NULL FROM public.ai_jobs WHERE id = '71000000-0000-4000-8000-000000000001')
  AND (SELECT status FROM public.prescriptions WHERE id = '81000000-0000-4000-8000-000000000001') = 'queued'
  AND (SELECT status FROM public.ai_jobs WHERE id = '71000000-0000-4000-8000-000000000002') = 'failed'
  AND (SELECT status FROM public.ai_jobs WHERE id = '71000000-0000-4000-8000-000000000003') = 'failed'
  AND (SELECT count(*) FROM public.prescription_intelligence_results WHERE prescription_id IN ('81000000-0000-4000-8000-000000000001', '81000000-0000-4000-8000-000000000002', '81000000-0000-4000-8000-000000000003')) = 0
  AND (SELECT count(*) FROM public.ai_jobs WHERE id IN ('71000000-0000-4000-8000-000000000004', '71000000-0000-4000-8000-000000000005', '71000000-0000-4000-8000-000000000006', '71000000-0000-4000-8000-000000000007') AND status = 'processing') = 4
  AND (SELECT status = 'queued' AND claim_generation = 5 AND lease_owner IS NULL FROM public.ai_jobs WHERE id = '72000000-0000-4000-8000-000000000001')
  AND (SELECT status = 'failed' AND claim_generation = 9 AND lease_owner IS NULL FROM public.ai_jobs WHERE id = '72000000-0000-4000-8000-000000000002')
  AND (SELECT status = 'processing' AND claim_generation = 3 AND lease_owner = 'worker-healthy-001' FROM public.ai_jobs WHERE id = '72000000-0000-4000-8000-000000000003')
  AND (SELECT count(*) FROM public.ai_jobs WHERE id IN ('72000000-0000-4000-8000-000000000004', '72000000-0000-4000-8000-000000000005') AND status = 'queued' AND claim_generation = 3) = 2
  THEN 1 ELSE 0 END AS failure_and_recovery_assertion;

SET ROLE authenticated;
DO $authenticated_denied$
BEGIN
  BEGIN
    PERFORM public.recover_expired_prescription_analysis_jobs_v1(1);
    RAISE EXCEPTION 'authenticated role unexpectedly recovered a job';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$authenticated_denied$;
RESET ROLE;
\echo PHASE7_FAILURE_AND_RECOVERY_PASS
