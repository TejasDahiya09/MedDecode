/*
NOT FOR EXECUTION - REVIEW REQUIRED - PRODUCTION DATABASE CHANGE NOT AUTHORIZED

Authenticated submission design. Direct authenticated ai_jobs writes must be
removed before this function becomes the only submission boundary. The current
backend dependency matrix must be approved first.

BEGIN;

CREATE OR REPLACE FUNCTION public.submit_prescription_analysis_job_v1(
    p_prescription_id uuid,
    p_requested_analysis jsonb
)
RETURNS TABLE (job_id uuid, prescription_id uuid, job_status text, created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
    v_user_id uuid;
    v_prescription public.prescriptions%ROWTYPE;
    v_existing public.ai_jobs%ROWTYPE;
    v_job public.ai_jobs%ROWTYPE;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'authentication required';
    END IF;
    IF p_prescription_id IS NULL OR p_requested_analysis IS NULL
       OR jsonb_typeof(p_requested_analysis) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid submission';
    END IF;

    -- Current product decision: alternatives are disabled and the other three
    -- analyses are enabled. Broader Contract v1 flag combinations are BLOCKED
    -- until approved; no unsupported combination is silently accepted.
    IF p_requested_analysis IS DISTINCT FROM jsonb_build_object(
         'extract_prescription', true, 'match_medicines', true,
         'find_alternatives', false, 'generate_recommendations', true
       ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid requested analysis';
    END IF;

    SELECT p.* INTO v_prescription FROM public.prescriptions AS p
     WHERE p.id = p_prescription_id AND p.user_id = v_user_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'prescription not found';
    END IF;
    IF v_prescription.storage_provider <> 'aws_s3'
       OR v_prescription.storage_bucket IS NULL
       OR btrim(v_prescription.storage_bucket) = ''
       OR v_prescription.object_key IS NULL
       OR btrim(v_prescription.object_key) = '' THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'prescription not processable';
    END IF;
    IF EXISTS (SELECT 1 FROM public.prescription_intelligence_results AS r
                WHERE r.prescription_id = p_prescription_id) THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'result already exists';
    END IF;

    SELECT j.* INTO v_existing FROM public.ai_jobs AS j
     WHERE j.prescription_id = p_prescription_id
       AND j.job_type = 'prescription_analysis'
       AND j.status IN ('queued', 'processing')
     ORDER BY j.created_at, j.id LIMIT 1;
    IF FOUND THEN
      RETURN QUERY SELECT v_existing.id, v_existing.prescription_id,
                          v_existing.status, false;
      RETURN;
    END IF;

    BEGIN
      INSERT INTO public.ai_jobs (
        user_id, prescription_id, job_type, status, input_reference,
        attempt_count, max_attempts, available_at, claim_generation
      ) VALUES (
        v_user_id, p_prescription_id, 'prescription_analysis', 'queued',
        jsonb_build_object('requested_analysis', p_requested_analysis,
                           'contract_version', '1.0'),
        0, 3, clock_timestamp(), 0
      ) RETURNING * INTO v_job;
    EXCEPTION WHEN unique_violation THEN
      SELECT j.* INTO v_existing FROM public.ai_jobs AS j
       WHERE j.prescription_id = p_prescription_id AND j.user_id = v_user_id
         AND j.job_type = 'prescription_analysis'
         AND j.status IN ('queued', 'processing')
       ORDER BY j.created_at, j.id LIMIT 1;
      IF FOUND THEN
        RETURN QUERY SELECT v_existing.id, v_existing.prescription_id,
                            v_existing.status, false;
        RETURN;
      END IF;
      RAISE;
    END;

    UPDATE public.prescriptions AS p SET status = 'queued'
     WHERE p.id = p_prescription_id AND p.user_id = v_user_id;
    RETURN QUERY SELECT v_job.id, v_job.prescription_id, v_job.status, true;
END;
$function$;

-- BLOCKED: owner alteration and grants require proven hosted role provisioning.
-- Default PUBLIC/anon execution must be revoked before authenticated receives
-- execution on this exact signature.

COMMIT;
END OF INERT PROPOSAL
*/
