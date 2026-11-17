/*
NOT FOR EXECUTION - REVIEW REQUIRED - PRODUCTION DATABASE CHANGE NOT AUTHORIZED

Retry and expired-lease reconciliation design. Internal operational errors are
not Member 1 Contract v1 errors. Contract-facing codes remain UNSUPPORTED_FILE,
DOCUMENT_ACCESS_FAILED, INVALID_REQUEST, and PROCESSING_FAILED.

BEGIN;

CREATE OR REPLACE FUNCTION public.record_prescription_analysis_failure_v1(
    p_job_id uuid, p_worker_instance_id text, p_claim_generation bigint,
    p_operational_error_code text, p_retryable boolean
)
RETURNS TABLE (job_id uuid, job_status text, attempt_count integer,
               next_available_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_job public.ai_jobs%ROWTYPE; v_retry boolean; v_backoff integer;
BEGIN
    PERFORM private.assert_meddecode_worker_authorized();
    IF p_operational_error_code NOT IN (
      'PRESCRIPTION_UNAVAILABLE', 'DOCUMENT_REFERENCE_FAILED',
      'INTELLIGENCE_TRANSPORT_FAILED', 'INTELLIGENCE_RESPONSE_INVALID',
      'RESULT_PERSISTENCE_FAILED'
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid operational failure code';
    END IF;

    SELECT j.* INTO v_job FROM public.ai_jobs AS j
     WHERE j.id = p_job_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'job not found'; END IF;
    IF v_job.status <> 'processing'
       OR v_job.lease_owner IS DISTINCT FROM p_worker_instance_id
       OR v_job.claim_generation IS DISTINCT FROM p_claim_generation
       OR v_job.lease_expires_at IS NULL
       OR v_job.lease_expires_at <= clock_timestamp() THEN
      RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'stale or expired claim';
    END IF;
    IF EXISTS (SELECT 1 FROM public.prescription_intelligence_results AS r
                WHERE r.prescription_id = v_job.prescription_id) THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'result already exists';
    END IF;

    v_retry := p_retryable AND v_job.attempt_count < v_job.max_attempts;
    v_backoff := least(900, 15 * (2 ^ greatest(v_job.attempt_count - 1, 0))::integer);
    UPDATE public.ai_jobs AS j
       SET status = CASE WHEN v_retry THEN 'queued' ELSE 'failed' END,
           available_at = CASE WHEN v_retry
             THEN clock_timestamp() + make_interval(secs => v_backoff)
             ELSE clock_timestamp() END,
           lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
           last_error_code = CASE WHEN p_retryable AND NOT v_retry
             THEN 'MAX_ATTEMPTS_EXCEEDED' ELSE p_operational_error_code END,
           error_message = CASE WHEN v_retry THEN NULL
             WHEN p_retryable THEN 'MAX_ATTEMPTS_EXCEEDED'
             ELSE p_operational_error_code END,
           completed_at = CASE WHEN v_retry THEN NULL ELSE clock_timestamp() END,
           updated_at = clock_timestamp()
     WHERE j.id = p_job_id RETURNING * INTO v_job;

    UPDATE public.prescriptions AS p
       SET status = CASE WHEN v_retry THEN 'queued' ELSE 'failed' END
     WHERE p.id = v_job.prescription_id AND p.user_id = v_job.user_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'job lineage invalid';
    END IF;
    RETURN QUERY SELECT v_job.id, v_job.status, v_job.attempt_count,
      CASE WHEN v_job.status = 'queued' THEN v_job.available_at ELSE NULL END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_expired_analysis_leases_v1(
    p_batch_size integer DEFAULT 50
)
RETURNS TABLE (requeued_count bigint, exhausted_count bigint, repaired_count bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
    v_requeue_selected bigint := 0;
    v_requeued bigint := 0;
    v_requeued_prescriptions bigint := 0;
    v_exhausted_selected bigint := 0;
    v_exhausted bigint := 0;
    v_exhausted_prescriptions bigint := 0;
    v_repaired bigint := 0;
BEGIN
    PERFORM private.assert_meddecode_worker_authorized();
    IF p_batch_size NOT BETWEEN 1 AND 200 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid batch size';
    END IF;

    -- BLOCKED repair helper: a result-bearing nonterminal job is never requeued
    -- or failed. It must verify result/job/prescription correlation and repair
    -- terminal state in one transaction. Rows with result.job_id IS NULL or
    -- mismatched lineage are quarantined for manual review, never auto-linked.
    SELECT private.repair_result_bearing_jobs_v1(p_batch_size) INTO v_repaired;

    WITH expired AS (
      SELECT j.id, j.prescription_id, j.user_id FROM public.ai_jobs AS j
       WHERE j.job_type = 'prescription_analysis' AND j.status = 'processing'
         AND j.lease_expires_at <= clock_timestamp()
         AND j.attempt_count < j.max_attempts
         AND NOT EXISTS (
           SELECT 1 FROM public.prescription_intelligence_results AS r
            WHERE r.job_id = j.id OR r.prescription_id = j.prescription_id
         )
       ORDER BY j.lease_expires_at, j.id FOR UPDATE SKIP LOCKED
       LIMIT p_batch_size
    ), updated AS (
      UPDATE public.ai_jobs AS j
         SET status = 'queued', available_at = clock_timestamp(),
             lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
             last_error_code = 'LEASE_EXPIRED', updated_at = clock_timestamp()
        FROM expired AS e WHERE j.id = e.id
      RETURNING j.prescription_id, j.user_id
    ), prescriptions_updated AS (
      UPDATE public.prescriptions AS p SET status = 'queued'
        FROM updated AS u
       WHERE p.id = u.prescription_id AND p.user_id = u.user_id RETURNING p.id
    ) SELECT (SELECT count(*) FROM expired),
             (SELECT count(*) FROM updated),
             (SELECT count(*) FROM prescriptions_updated)
        INTO v_requeue_selected, v_requeued, v_requeued_prescriptions;

    IF v_requeue_selected <> v_requeued
       OR v_requeued <> v_requeued_prescriptions THEN
      RAISE EXCEPTION USING ERRCODE = '23503',
        MESSAGE = 'requeue prescription count mismatch';
    END IF;

    WITH exhausted AS (
      SELECT j.id FROM public.ai_jobs AS j
       WHERE j.job_type = 'prescription_analysis' AND j.status = 'processing'
         AND j.lease_expires_at <= clock_timestamp()
         AND j.attempt_count >= j.max_attempts
         AND NOT EXISTS (
           SELECT 1 FROM public.prescription_intelligence_results AS r
            WHERE r.job_id = j.id OR r.prescription_id = j.prescription_id
         )
       ORDER BY j.lease_expires_at, j.id FOR UPDATE SKIP LOCKED
       LIMIT p_batch_size
    ), updated AS (
      UPDATE public.ai_jobs AS j
         SET status = 'failed', lease_owner = NULL, lease_expires_at = NULL,
             heartbeat_at = NULL, last_error_code = 'MAX_ATTEMPTS_EXCEEDED',
             error_message = 'MAX_ATTEMPTS_EXCEEDED',
             completed_at = clock_timestamp(), updated_at = clock_timestamp()
        FROM exhausted AS e WHERE j.id = e.id
      RETURNING j.prescription_id, j.user_id
    ), prescriptions_updated AS (
      UPDATE public.prescriptions AS p SET status = 'failed'
        FROM updated AS u
       WHERE p.id = u.prescription_id AND p.user_id = u.user_id RETURNING p.id
    ) SELECT (SELECT count(*) FROM exhausted),
             (SELECT count(*) FROM updated),
             (SELECT count(*) FROM prescriptions_updated)
        INTO v_exhausted_selected, v_exhausted, v_exhausted_prescriptions;

    IF v_exhausted_selected <> v_exhausted
       OR v_exhausted <> v_exhausted_prescriptions THEN
      RAISE EXCEPTION USING ERRCODE = '23503',
        MESSAGE = 'exhaustion prescription count mismatch';
    END IF;

    RETURN QUERY SELECT v_requeued, v_exhausted, v_repaired;
END;
$function$;

-- LEASE_EXPIRED and MAX_ATTEMPTS_EXCEEDED are internal versioned operational
-- codes only. They are never emitted as Member 1 Contract v1 error.code.
-- The active-job uniqueness proposal should prevent two active jobs for one
-- prescription. Until it is validated, a duplicate historical job can cause
-- job/prescription row-count mismatch; this function intentionally rolls back
-- rather than hiding the anomaly. Result-bearing jobs are excluded before any
-- lifecycle write. Lock order is selected ai_jobs rows, then prescriptions;
-- concurrency/deadlock behavior remains an isolated-test requirement.
-- Owner changes and grants remain BLOCKED pending worker identity proof.
COMMIT;
END OF INERT PROPOSAL
*/
