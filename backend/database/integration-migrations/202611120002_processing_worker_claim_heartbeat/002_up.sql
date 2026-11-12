\set ON_ERROR_STOP on

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.ai_jobs
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS available_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS lease_owner text,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS claim_generation bigint NOT NULL DEFAULT 0;

DO $column_guard$
DECLARE v_bad bigint;
BEGIN
  SELECT count(*) INTO v_bad
  FROM pg_catalog.pg_attribute AS a
  WHERE a.attrelid = 'public.ai_jobs'::regclass
    AND a.attname IN ('attempt_count', 'max_attempts', 'available_at', 'lease_owner',
                      'lease_expires_at', 'heartbeat_at', 'claim_generation')
    AND NOT a.attisdropped
    AND ((a.attname IN ('attempt_count', 'max_attempts') AND a.atttypid <> 'integer'::regtype)
      OR (a.attname = 'claim_generation' AND a.atttypid <> 'bigint'::regtype)
      OR (a.attname IN ('available_at', 'lease_expires_at', 'heartbeat_at')
          AND a.atttypid <> 'timestamptz'::regtype)
      OR (a.attname = 'lease_owner' AND a.atttypid <> 'text'::regtype));
  IF v_bad <> 0 THEN RAISE EXCEPTION 'worker lease columns have incompatible types'; END IF;
END
$column_guard$;

DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.ai_jobs'::regclass AND conname = 'ai_jobs_attempt_bounds_check') THEN
    ALTER TABLE public.ai_jobs ADD CONSTRAINT ai_jobs_attempt_bounds_check
      CHECK (attempt_count >= 0 AND max_attempts BETWEEN 1 AND 20
             AND attempt_count <= max_attempts) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.ai_jobs'::regclass AND conname = 'ai_jobs_claim_generation_check') THEN
    ALTER TABLE public.ai_jobs ADD CONSTRAINT ai_jobs_claim_generation_check
      CHECK (claim_generation >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.ai_jobs'::regclass AND conname = 'ai_jobs_lease_state_check') THEN
    ALTER TABLE public.ai_jobs ADD CONSTRAINT ai_jobs_lease_state_check CHECK (
      job_type <> 'prescription_analysis'
      OR (status = 'processing' AND lease_owner IS NOT NULL
        AND lease_expires_at IS NOT NULL AND heartbeat_at IS NOT NULL)
      OR (status <> 'processing' AND lease_owner IS NULL
        AND lease_expires_at IS NULL AND heartbeat_at IS NULL)
    ) NOT VALID;
  END IF;
END
$constraints$;

ALTER TABLE public.ai_jobs VALIDATE CONSTRAINT ai_jobs_attempt_bounds_check;
ALTER TABLE public.ai_jobs VALIDATE CONSTRAINT ai_jobs_claim_generation_check;
ALTER TABLE public.ai_jobs VALIDATE CONSTRAINT ai_jobs_lease_state_check;

CREATE INDEX IF NOT EXISTS ai_jobs_worker_available_idx
  ON public.ai_jobs (available_at, created_at, id)
  WHERE job_type = 'prescription_analysis' AND status = 'queued';
CREATE INDEX IF NOT EXISTS ai_jobs_worker_lease_expiry_idx
  ON public.ai_jobs (lease_expires_at, id)
  WHERE job_type = 'prescription_analysis' AND status = 'processing';

CREATE OR REPLACE FUNCTION public.claim_next_prescription_analysis_job_v1(
  p_worker_instance_id text, p_lease_seconds integer DEFAULT 120
)
RETURNS TABLE (
  job_id uuid, user_id uuid, prescription_id uuid, attempt_count integer,
  claim_generation bigint, lease_expires_at timestamptz,
  storage_provider text, storage_bucket text, object_key text, file_type text,
  input_reference jsonb
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
#variable_conflict use_column
DECLARE
  v_job public.ai_jobs%ROWTYPE;
  v_prescription public.prescriptions%ROWTYPE;
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'meddecode_worker' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'worker authorization required';
  END IF;
  IF p_worker_instance_id IS NULL
     OR length(btrim(p_worker_instance_id)) NOT BETWEEN 8 AND 128
     OR p_worker_instance_id !~ '^[A-Za-z0-9._:-]+$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid worker instance';
  END IF;
  IF p_lease_seconds NOT BETWEEN 30 AND 300 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid lease duration';
  END IF;

  SELECT j.* INTO v_job
  FROM public.ai_jobs AS j
  JOIN public.prescriptions AS candidate_prescription
    ON candidate_prescription.id = j.prescription_id
   AND candidate_prescription.user_id = j.user_id
   AND candidate_prescription.status = 'queued'
   AND candidate_prescription.storage_provider = 'aws_s3'
   AND nullif(btrim(candidate_prescription.storage_bucket), '') IS NOT NULL
   AND nullif(btrim(candidate_prescription.object_key), '') IS NOT NULL
  WHERE j.job_type = 'prescription_analysis' AND j.status = 'queued'
    AND j.available_at <= clock_timestamp() AND j.attempt_count < j.max_attempts
  ORDER BY j.available_at, j.created_at, j.id
  FOR UPDATE OF j SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT p.* INTO STRICT v_prescription
  FROM public.prescriptions AS p
  WHERE p.id = v_job.prescription_id AND p.user_id = v_job.user_id
    AND p.status = 'queued' AND p.storage_provider = 'aws_s3'
    AND nullif(btrim(p.storage_bucket), '') IS NOT NULL
    AND nullif(btrim(p.object_key), '') IS NOT NULL
  FOR UPDATE;

  UPDATE public.ai_jobs AS j
  SET status = 'processing', attempt_count = j.attempt_count + 1,
      claim_generation = j.claim_generation + 1,
      lease_owner = p_worker_instance_id,
      lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
      heartbeat_at = clock_timestamp(),
      started_at = coalesce(j.started_at, clock_timestamp()), completed_at = NULL
  WHERE j.id = v_job.id RETURNING j.* INTO v_job;

  UPDATE public.prescriptions AS p SET status = 'processing'
  WHERE p.id = v_job.prescription_id AND p.user_id = v_job.user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'prescription disappeared during claim'; END IF;

  RETURN QUERY SELECT v_job.id, v_job.user_id, v_job.prescription_id,
    v_job.attempt_count, v_job.claim_generation, v_job.lease_expires_at,
    v_prescription.storage_provider, v_prescription.storage_bucket,
    v_prescription.object_key, v_prescription.file_type, v_job.input_reference;
END
$function$;

CREATE OR REPLACE FUNCTION public.heartbeat_prescription_analysis_job_v1(
  p_job_id uuid, p_worker_instance_id text, p_claim_generation bigint,
  p_extend_seconds integer DEFAULT 120
)
RETURNS TABLE (job_id uuid, claim_generation bigint, lease_expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
#variable_conflict use_column
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'meddecode_worker' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'worker authorization required';
  END IF;
  IF p_job_id IS NULL OR p_claim_generation IS NULL OR p_claim_generation < 1
     OR p_worker_instance_id IS NULL
     OR length(btrim(p_worker_instance_id)) NOT BETWEEN 8 AND 128
     OR p_worker_instance_id !~ '^[A-Za-z0-9._:-]+$'
     OR p_extend_seconds NOT BETWEEN 30 AND 300 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid heartbeat request';
  END IF;
  RETURN QUERY UPDATE public.ai_jobs AS j
  SET heartbeat_at = clock_timestamp(),
      lease_expires_at = clock_timestamp() + make_interval(secs => p_extend_seconds)
  WHERE j.id = p_job_id AND j.job_type = 'prescription_analysis'
    AND j.status = 'processing' AND j.lease_owner = p_worker_instance_id
    AND j.claim_generation = p_claim_generation
    AND j.lease_expires_at > clock_timestamp()
  RETURNING j.id, j.claim_generation, j.lease_expires_at;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'stale or expired worker claim';
  END IF;
END
$function$;

ALTER FUNCTION public.claim_next_prescription_analysis_job_v1(text, integer) OWNER TO postgres;
ALTER FUNCTION public.heartbeat_prescription_analysis_job_v1(uuid, text, bigint, integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_next_prescription_analysis_job_v1(text, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.heartbeat_prescription_analysis_job_v1(uuid, text, bigint, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE CREATE ON SCHEMA public FROM meddecode_worker;
GRANT USAGE ON SCHEMA public TO meddecode_worker;
GRANT EXECUTE ON FUNCTION public.claim_next_prescription_analysis_job_v1(text, integer)
  TO meddecode_worker;
GRANT EXECUTE ON FUNCTION public.heartbeat_prescription_analysis_job_v1(uuid, text, bigint, integer)
  TO meddecode_worker;
REVOKE ALL ON TABLE public.ai_jobs FROM meddecode_worker;
REVOKE ALL ON TABLE public.prescriptions FROM meddecode_worker;
COMMIT;
