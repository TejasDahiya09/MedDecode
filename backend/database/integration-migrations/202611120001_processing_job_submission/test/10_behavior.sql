\set ON_ERROR_STOP on

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001', false);

DO $tests$
DECLARE
  v_first record;
  v_second record;
  v_status record;
BEGIN
  SELECT * INTO v_first
  FROM public.submit_prescription_analysis_job_v1(
    '30000000-0000-4000-8000-000000000003',
    '{"extract_prescription":true,"match_medicines":true,"find_alternatives":false,"generate_recommendations":true}'::jsonb
  );
  IF v_first.created IS DISTINCT FROM true OR v_first.job_status <> 'queued' THEN
    RAISE EXCEPTION 'owner submission did not create a queued job';
  END IF;

  SELECT * INTO v_second
  FROM public.submit_prescription_analysis_job_v1(
    '30000000-0000-4000-8000-000000000003',
    '{"extract_prescription":true,"match_medicines":true,"find_alternatives":false,"generate_recommendations":true}'::jsonb
  );
  IF v_second.created IS DISTINCT FROM false OR v_second.job_id <> v_first.job_id THEN
    RAISE EXCEPTION 'active job was not reused';
  END IF;

  SELECT * INTO v_status
  FROM public.get_prescription_analysis_status_v1(
    '30000000-0000-4000-8000-000000000003'
  );
  IF v_status.job_id <> v_first.job_id OR v_status.job_status <> 'queued' THEN
    RAISE EXCEPTION 'queued status read was inaccurate';
  END IF;

  SELECT * INTO v_status
  FROM public.get_prescription_analysis_status_v1(
    '60000000-0000-4000-8000-000000000006'
  );
  IF NOT FOUND OR v_status.job_id IS NOT NULL OR v_status.job_status IS NOT NULL THEN
    RAISE EXCEPTION 'no-job status was inaccurate';
  END IF;

  BEGIN
    PERFORM public.submit_prescription_analysis_job_v1(
      '40000000-0000-4000-8000-000000000004',
      '{"extract_prescription":true,"match_medicines":true,"find_alternatives":false,"generate_recommendations":true}'::jsonb
    );
    RAISE EXCEPTION 'non-owner submission unexpectedly succeeded';
  EXCEPTION WHEN no_data_found THEN
    NULL;
  END;

  BEGIN
    PERFORM public.submit_prescription_analysis_job_v1(
      '50000000-0000-4000-8000-000000000005',
      '{"extract_prescription":true,"match_medicines":true,"find_alternatives":false,"generate_recommendations":true}'::jsonb
    );
    RAISE EXCEPTION 'immutable-result submission unexpectedly succeeded';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.ai_jobs (user_id, prescription_id, job_type)
    VALUES (
      '10000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000006',
      'prescription_analysis'
    );
    RAISE EXCEPTION 'direct authenticated insertion unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$tests$;

RESET ROLE;

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '', false);
DO $missing_auth$
BEGIN
  BEGIN
    PERFORM public.submit_prescription_analysis_job_v1(
      '60000000-0000-4000-8000-000000000006',
      '{"extract_prescription":true,"match_medicines":true,"find_alternatives":false,"generate_recommendations":true}'::jsonb
    );
    RAISE EXCEPTION 'missing-authentication submission unexpectedly succeeded';
  EXCEPTION WHEN invalid_authorization_specification THEN
    NULL;
  END;
END
$missing_auth$;
RESET ROLE;

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000001', true);
SELECT * FROM public.submit_prescription_analysis_job_v1(
  '60000000-0000-4000-8000-000000000006',
  '{"extract_prescription":true,"match_medicines":true,"find_alternatives":false,"generate_recommendations":true}'::jsonb
);
ROLLBACK;

DO $rollback_check$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.ai_jobs
    WHERE prescription_id = '60000000-0000-4000-8000-000000000006'
  ) THEN
    RAISE EXCEPTION 'transaction rollback left a job behind';
  END IF;
END
$rollback_check$;
