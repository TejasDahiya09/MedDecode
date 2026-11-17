\set ON_ERROR_STOP on

INSERT INTO public.processing_finalization_concurrency_probe (session_id, backend_pid, started_at)
VALUES (2, pg_backend_pid(), clock_timestamp());

-- Wait until session 1 has acquired its test rendezvous lock. A timeout proves
-- this is not silently degraded into a sequential test.
DO $wait_for_recovery_lock$
DECLARE v_deadline timestamptz := clock_timestamp() + interval '10 seconds';
BEGIN
  LOOP
    IF NOT pg_try_advisory_lock(72003001) THEN EXIT; END IF;
    PERFORM pg_advisory_unlock(72003001);
    IF clock_timestamp() >= v_deadline THEN
      RAISE EXCEPTION 'recovery session did not acquire the concurrency rendezvous lock';
    END IF;
    PERFORM pg_sleep(0.05);
  END LOOP;
END
$wait_for_recovery_lock$;

BEGIN;
SET LOCAL ROLE meddecode_worker;
DO $stale_completion$
BEGIN
  BEGIN
    PERFORM public.complete_prescription_analysis_job_v1(
      '73000000-0000-4000-8000-000000000001', '83000000-0000-4000-8000-000000000001',
      'worker-concurrency-001', 7,
      jsonb_build_object(
        'schema_version', '1.0', 'job_id', '73000000-0000-4000-8000-000000000001',
        'prescription_id', '83000000-0000-4000-8000-000000000001', 'status', 'completed',
        'prescription', jsonb_build_object('prescription_date', null, 'doctor', jsonb_build_object('name', null, 'registration_number', null), 'facility', jsonb_build_object('name', null, 'address', null, 'phone', null)),
        'patient', jsonb_build_object('name', null, 'age', null, 'gender', null),
        'medicines', '[]'::jsonb, 'recommendations', '[]'::jsonb, 'warnings', '[]'::jsonb,
        'processing_metadata', jsonb_build_object('overall_confidence', null)
      ));
    RAISE EXCEPTION 'stale worker unexpectedly completed an expired recovered job';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
END
$stale_completion$;
RESET ROLE;
UPDATE public.processing_finalization_concurrency_probe
SET finished_at = clock_timestamp(), outcome = 'stale_completion_rejected'
WHERE session_id = 2;
COMMIT;
\echo PHASE7_CONCURRENT_COMPLETION_PASS
