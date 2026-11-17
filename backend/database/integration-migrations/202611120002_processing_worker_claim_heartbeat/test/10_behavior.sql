\set ON_ERROR_STOP on

INSERT INTO public.prescriptions (
  id, user_id, storage_provider, storage_bucket, object_key, file_type, status
) VALUES (
  '20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001', 'aws_s3', 'local-test-bucket',
  'private/prescriptions/20000000-0000-4000-8000-000000000001/source.pdf',
  'application/pdf', 'uploaded'
);

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);
SELECT * FROM public.submit_prescription_analysis_job_v1(
  '20000000-0000-4000-8000-000000000001',
  '{"extract_prescription":true,"match_medicines":true,"find_alternatives":false,"generate_recommendations":true}'::jsonb
);
RESET ROLE;

DO $label_is_not_authorization$
BEGIN
  BEGIN
    PERFORM public.claim_next_prescription_analysis_job_v1('worker-forged-001', 120);
    RAISE EXCEPTION 'worker label unexpectedly authorized a claim';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.heartbeat_prescription_analysis_job_v1(
      '00000000-0000-4000-8000-000000000001',
      'worker-forged-001', 1, 120);
    RAISE EXCEPTION 'worker label unexpectedly authorized a heartbeat';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$label_is_not_authorization$;

SET ROLE authenticated;
DO $unauthorized$
BEGIN
  BEGIN
    PERFORM public.claim_next_prescription_analysis_job_v1('browser-user-001', 120);
    RAISE EXCEPTION 'authenticated caller unexpectedly claimed a job';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$unauthorized$;
RESET ROLE;

SET ROLE meddecode_worker;
SELECT * FROM public.claim_next_prescription_analysis_job_v1('worker-alpha-001', 120)
\gset claim_
SELECT set_config('worker_test.claim_job_id', :'claim_job_id', false);
SELECT set_config('worker_test.claim_attempt_count', :'claim_attempt_count', false);
SELECT set_config('worker_test.claim_generation', :'claim_claim_generation', false);
SELECT set_config('worker_test.claim_storage_provider', :'claim_storage_provider', false);
SELECT set_config('worker_test.claim_file_type', :'claim_file_type', false);
DO $claim_assertions$
BEGIN
  IF current_setting('worker_test.claim_job_id')::uuid IS NULL
     OR current_setting('worker_test.claim_attempt_count')::integer <> 1
     OR current_setting('worker_test.claim_generation')::bigint <> 1
     OR current_setting('worker_test.claim_storage_provider') <> 'aws_s3'
     OR current_setting('worker_test.claim_file_type') <> 'application/pdf' THEN
    RAISE EXCEPTION 'claim response is invalid';
  END IF;
END
$claim_assertions$;

SELECT * FROM public.heartbeat_prescription_analysis_job_v1(
  :'claim_job_id'::uuid, 'worker-alpha-001', :'claim_claim_generation'::bigint, 180
);

DO $stale_generation$
BEGIN
  BEGIN
    PERFORM public.heartbeat_prescription_analysis_job_v1(
      current_setting('worker_test.claim_job_id')::uuid,
      'worker-alpha-001',
      current_setting('worker_test.claim_generation')::bigint + 1,
      120);
    RAISE EXCEPTION 'stale generation unexpectedly heartbeated';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
END
$stale_generation$;
RESET ROLE;

UPDATE public.ai_jobs SET lease_expires_at = clock_timestamp() - interval '1 second'
WHERE id = current_setting('worker_test.claim_job_id')::uuid;
SET ROLE meddecode_worker;
DO $expired$
BEGIN
  BEGIN
    PERFORM public.heartbeat_prescription_analysis_job_v1(
      current_setting('worker_test.claim_job_id')::uuid,
      'worker-alpha-001',
      current_setting('worker_test.claim_generation')::bigint,
      120);
    RAISE EXCEPTION 'expired lease unexpectedly heartbeated';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
END
$expired$;
RESET ROLE;

DO $rollback_test$
DECLARE v_before bigint;
BEGIN
  SELECT claim_generation INTO v_before FROM public.ai_jobs
  WHERE id = current_setting('worker_test.claim_job_id')::uuid;
  BEGIN
    UPDATE public.ai_jobs SET claim_generation = -1
    WHERE id = current_setting('worker_test.claim_job_id')::uuid;
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF (SELECT claim_generation FROM public.ai_jobs
      WHERE id = current_setting('worker_test.claim_job_id')::uuid) <> v_before THEN
    RAISE EXCEPTION 'failed transaction did not roll back';
  END IF;
END
$rollback_test$;
