\set ON_ERROR_STOP on
DO $wait$
DECLARE deadline timestamptz := clock_timestamp()+interval '10 seconds';
BEGIN
  LOOP
    IF NOT pg_try_advisory_lock(72003002) THEN EXIT; END IF;
    PERFORM pg_advisory_unlock(72003002);
    IF clock_timestamp()>deadline THEN RAISE EXCEPTION 'lock-wait rendezvous timed out'; END IF;
    PERFORM pg_sleep(0.05);
  END LOOP;
END
$wait$;
SET ROLE meddecode_worker;
DO $test$
BEGIN
  BEGIN
    PERFORM public.complete_prescription_analysis_job_v1(
      '78000000-0000-4000-8000-000000000001','88000000-0000-4000-8000-000000000001',
      'worker-lock-wait-001',1,jsonb_build_object(
        'schema_version','1.0','job_id','78000000-0000-4000-8000-000000000001',
        'prescription_id','88000000-0000-4000-8000-000000000001','status','completed',
        'prescription','{}'::jsonb,'patient','{}'::jsonb,'medicines','[]'::jsonb,
        'recommendations','[]'::jsonb,'warnings','[]'::jsonb,'processing_metadata','{}'::jsonb));
    RAISE EXCEPTION 'expired lease unexpectedly completed after lock wait';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
END
$test$;
RESET ROLE;
