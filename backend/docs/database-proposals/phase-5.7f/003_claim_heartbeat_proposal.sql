/*
NOT FOR EXECUTION - REVIEW REQUIRED - PRODUCTION DATABASE CHANGE NOT AUTHORIZED

Worker claim/heartbeat design. Recommended trust model: the Python intelligence
worker authenticates to a private Node backend interface; Node validates a
rotated internal credential and invokes narrowly granted database RPCs. Python
never receives a Supabase service-role key or direct table privileges.

BLOCKED: the database execution identity used by Node, private schema creation,
function ownership, hosted Supabase grants, credential rotation, and internal
transport authentication require isolated proof. A caller worker label is not
authority. No placeholder auth.role() check is represented as implemented.

BEGIN;

CREATE OR REPLACE FUNCTION public.claim_next_prescription_analysis_job_v1(
    p_worker_instance_id text, p_lease_seconds integer DEFAULT 120
)
RETURNS TABLE (
    job_id uuid, user_id uuid, prescription_id uuid, attempt_count integer,
    claim_generation bigint, lease_expires_at timestamptz, input_reference jsonb
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_job public.ai_jobs%ROWTYPE;
BEGIN
    -- BLOCKED helper: must verify a proven backend-mediated execution identity.
    PERFORM private.assert_meddecode_worker_authorized();
    IF p_worker_instance_id IS NULL
       OR length(btrim(p_worker_instance_id)) NOT BETWEEN 8 AND 128
       OR p_worker_instance_id !~ '^[A-Za-z0-9._:-]+$' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid worker instance';
    END IF;
    IF p_lease_seconds NOT BETWEEN 30 AND 900 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid lease duration';
    END IF;

    SELECT j.* INTO v_job FROM public.ai_jobs AS j
     WHERE j.job_type = 'prescription_analysis' AND j.status = 'queued'
       AND j.available_at <= clock_timestamp()
       AND j.attempt_count < j.max_attempts
       AND NOT EXISTS (
         SELECT 1 FROM public.prescription_intelligence_results AS r
          WHERE r.prescription_id = j.prescription_id
       )
     ORDER BY j.available_at, j.created_at, j.id
     FOR UPDATE SKIP LOCKED LIMIT 1;
    IF NOT FOUND THEN RETURN; END IF;

    UPDATE public.ai_jobs AS j
       SET status = 'processing', attempt_count = j.attempt_count + 1,
           claim_generation = j.claim_generation + 1,
           lease_owner = p_worker_instance_id,
           lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
           heartbeat_at = clock_timestamp(),
           started_at = COALESCE(j.started_at, clock_timestamp()),
           updated_at = clock_timestamp(), last_error_code = NULL
     WHERE j.id = v_job.id RETURNING * INTO v_job;

    UPDATE public.prescriptions AS p SET status = 'processing'
     WHERE p.id = v_job.prescription_id AND p.user_id = v_job.user_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'job lineage invalid';
    END IF;

    RETURN QUERY SELECT v_job.id, v_job.user_id, v_job.prescription_id,
      v_job.attempt_count, v_job.claim_generation, v_job.lease_expires_at,
      v_job.input_reference;
END;
$function$;

CREATE OR REPLACE FUNCTION public.heartbeat_prescription_analysis_job_v1(
    p_job_id uuid, p_worker_instance_id text, p_claim_generation bigint,
    p_extend_seconds integer DEFAULT 120
)
RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_new_expiry timestamptz;
BEGIN
    PERFORM private.assert_meddecode_worker_authorized();
    IF p_extend_seconds NOT BETWEEN 30 AND 900 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid lease duration';
    END IF;
    UPDATE public.ai_jobs AS j
       SET heartbeat_at = clock_timestamp(),
           lease_expires_at = clock_timestamp() + make_interval(secs => p_extend_seconds),
           updated_at = clock_timestamp()
     WHERE j.id = p_job_id AND j.status = 'processing'
       AND j.lease_owner = p_worker_instance_id
       AND j.claim_generation = p_claim_generation
       AND j.lease_expires_at > clock_timestamp()
     RETURNING j.lease_expires_at INTO v_new_expiry;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'stale or expired claim';
    END IF;
    RETURN v_new_expiry;
END;
$function$;

-- BLOCKED: ALTER OWNER, revoke, and exact EXECUTE grants are intentionally
-- omitted until the backend-mediated database identity is proven.
COMMIT;
END OF INERT PROPOSAL
*/
