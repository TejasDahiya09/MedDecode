\set ON_ERROR_STOP on

-- LOCAL INTEGRATION CANDIDATE ONLY. NOT APPROVED FOR HOSTED DEPLOYMENT.
-- This package introduces no tables or clinical fields. It relies on the
-- submission and claim/heartbeat migration candidates having been applied.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.complete_prescription_analysis_job_v1(
  p_job_id uuid,
  p_prescription_id uuid,
  p_worker_instance_id text,
  p_claim_generation bigint,
  p_result_json jsonb
)
RETURNS TABLE (job_id uuid, prescription_id uuid, result_status text, replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
#variable_conflict use_column
DECLARE
  v_job public.ai_jobs%ROWTYPE;
  v_prescription public.prescriptions%ROWTYPE;
  v_existing public.prescription_intelligence_results%ROWTYPE;
  v_result_id uuid;
  v_status text;
  v_now timestamptz := clock_timestamp();
  v_medicine jsonb;
  v_recommendation jsonb;
  v_warning jsonb;
  v_ordinal bigint;
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'meddecode_worker' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'worker authorization required';
  END IF;
  IF p_job_id IS NULL OR p_prescription_id IS NULL OR p_claim_generation IS NULL
     OR p_claim_generation < 1 OR p_worker_instance_id IS NULL
     OR length(btrim(p_worker_instance_id)) NOT BETWEEN 8 AND 128
     OR p_worker_instance_id !~ '^[A-Za-z0-9._:-]+$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid completion request';
  END IF;
  IF p_result_json IS NULL OR p_result_json = 'null'::jsonb
     OR jsonb_typeof(p_result_json) IS DISTINCT FROM 'object'
     OR octet_length(p_result_json::text) > 2097152 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid result payload';
  END IF;

  -- This is deliberately a minimum SQL structural gate. The TypeScript
  -- Contract v1 validator remains authoritative for complete clinical shape.
  IF p_result_json->>'schema_version' IS DISTINCT FROM '1.0'
     OR p_result_json->>'job_id' IS DISTINCT FROM p_job_id::text
     OR p_result_json->>'prescription_id' IS DISTINCT FROM p_prescription_id::text
     OR COALESCE(p_result_json->>'status' NOT IN ('completed', 'completed_with_warnings'), true)
     OR jsonb_typeof(p_result_json->'prescription') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_result_json->'patient') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_result_json->'medicines') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_result_json->'recommendations') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_result_json->'warnings') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_result_json->'processing_metadata') IS DISTINCT FROM 'object'
     OR jsonb_path_exists(p_result_json, '$.medicines[*].alternatives[*]') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'result structure is incompatible';
  END IF;
  v_status := p_result_json->>'status';

  -- Lock order is ai_jobs then prescriptions then result/projection rows.
  SELECT j.* INTO v_job FROM public.ai_jobs AS j WHERE j.id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'job not found'; END IF;
  IF v_job.job_type <> 'prescription_analysis'
     OR v_job.prescription_id IS DISTINCT FROM p_prescription_id THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'job correlation mismatch';
  END IF;
  SELECT p.* INTO v_prescription FROM public.prescriptions AS p
  WHERE p.id = p_prescription_id FOR UPDATE;
  IF NOT FOUND OR v_prescription.user_id IS DISTINCT FROM v_job.user_id THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ownership mismatch';
  END IF;
  SELECT r.* INTO v_existing FROM public.prescription_intelligence_results AS r
  WHERE r.prescription_id = p_prescription_id FOR UPDATE;

  -- An identical completion replay is safe only when result, terminal states,
  -- and the original worker fence metadata agree.
  IF FOUND THEN
    IF v_existing.job_id = p_job_id AND v_existing.schema_version = '1.0'
       AND v_existing.status = v_status AND v_existing.result_json = p_result_json
       AND v_job.status = 'completed' AND v_prescription.status = v_status
       AND v_job.result_reference @> jsonb_build_object(
         'result_id', v_existing.id, 'schema_version', '1.0',
         'worker_instance_id', p_worker_instance_id,
         'claim_generation', p_claim_generation
       ) THEN
      RETURN QUERY SELECT p_job_id, p_prescription_id, v_status, true;
      RETURN;
    END IF;
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'conflicting or incomplete persisted result';
  END IF;

  IF v_job.status <> 'processing'
     OR v_job.lease_owner IS DISTINCT FROM p_worker_instance_id
     OR v_job.claim_generation IS DISTINCT FROM p_claim_generation
     OR v_job.lease_expires_at IS NULL OR v_job.lease_expires_at <= v_now THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'stale or expired worker claim';
  END IF;
  IF EXISTS (SELECT 1 FROM public.prescription_medicines WHERE prescription_id = p_prescription_id)
     OR EXISTS (SELECT 1 FROM public.prescription_recommendations WHERE prescription_id = p_prescription_id)
     OR EXISTS (SELECT 1 FROM public.prescription_warnings WHERE prescription_id = p_prescription_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'existing projections conflict';
  END IF;

  -- Validate fields required by current relational projections. Existing table
  -- constraints provide a second validation layer for numeric ranges and FKs.
  FOR v_medicine, v_ordinal IN
    SELECT value, ordinality FROM jsonb_array_elements(p_result_json->'medicines') WITH ORDINALITY
  LOOP
    IF jsonb_typeof(v_medicine) IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_medicine->'sequence_number') IS DISTINCT FROM 'number'
       OR (v_medicine->>'sequence_number') !~ '^[1-9][0-9]*$'
       OR (v_medicine->>'sequence_number')::bigint <> v_ordinal
       OR jsonb_typeof(v_medicine#>'{extraction,raw_text}') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_medicine#>'{extraction,frequency,type}') IS DISTINCT FROM 'string'
        OR COALESCE(v_medicine#>>'{extraction,frequency,type}' NOT IN ('scheduled', 'as_needed', 'unknown'), true)
       OR jsonb_typeof(v_medicine#>'{medicine_match,status}') IS DISTINCT FROM 'string'
        OR COALESCE(v_medicine#>>'{medicine_match,status}' NOT IN ('matched', 'probable_match', 'ambiguous', 'unmatched', 'not_attempted'), true) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'medicine projection is incompatible';
    END IF;
  END LOOP;
  FOR v_recommendation IN SELECT value FROM jsonb_array_elements(p_result_json->'recommendations')
  LOOP
    IF jsonb_typeof(v_recommendation) IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_recommendation->'type') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_recommendation->'title') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_recommendation->'message') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'recommendation projection is incompatible';
    END IF;
  END LOOP;
  FOR v_warning IN SELECT value FROM jsonb_array_elements(p_result_json->'warnings')
  LOOP
    IF jsonb_typeof(v_warning) IS DISTINCT FROM 'object'
       OR jsonb_typeof(v_warning->'code') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_warning->'message') IS DISTINCT FROM 'string'
        OR COALESCE(v_warning->>'severity' NOT IN ('info', 'low', 'medium', 'high'), true) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'warning projection is incompatible';
    END IF;
  END LOOP;

  INSERT INTO public.prescription_intelligence_results (
    prescription_id, job_id, schema_version, status, result_json, error_json
  ) VALUES (p_prescription_id, p_job_id, '1.0', v_status, p_result_json, NULL)
  RETURNING id INTO v_result_id;

  INSERT INTO public.prescription_medicines (
    prescription_id, sequence_number, raw_text, medicine_name, medicine_name_normalized,
    strength_value, strength_unit, dosage_form, frequency_type, frequency_morning,
    frequency_afternoon, frequency_night, frequency_times_per_day, timing,
    duration_value, duration_unit, quantity_value, quantity_unit, instructions,
    extraction_confidence, medicine_name_confidence, dosage_confidence, match_status,
    match_confidence, medicine_id, units_per_day, estimated_total_units
  ) SELECT p_prescription_id, (m.value->>'sequence_number')::integer,
    m.value#>>'{extraction,raw_text}', m.value#>>'{extraction,medicine_name}',
    m.value#>>'{extraction,medicine_name_normalized}',
    (m.value#>>'{extraction,strength,value}')::numeric, m.value#>>'{extraction,strength,unit}',
    m.value#>>'{extraction,dosage_form}', m.value#>>'{extraction,frequency,type}',
    (m.value#>>'{extraction,frequency,morning}')::numeric,
    (m.value#>>'{extraction,frequency,afternoon}')::numeric,
    (m.value#>>'{extraction,frequency,night}')::numeric,
    (m.value#>>'{extraction,frequency,times_per_day}')::numeric,
    m.value#>>'{extraction,timing}', (m.value#>>'{extraction,duration,value}')::numeric,
    m.value#>>'{extraction,duration,unit}', (m.value#>>'{extraction,quantity,value}')::numeric,
    m.value#>>'{extraction,quantity,unit}', m.value#>>'{extraction,instructions}',
    (m.value#>>'{confidence,extraction}')::numeric,
    (m.value#>>'{confidence,medicine_name}')::numeric,
    (m.value#>>'{confidence,dosage}')::numeric, m.value#>>'{medicine_match,status}',
    (m.value#>>'{medicine_match,confidence}')::numeric, NULL,
    (m.value#>>'{derived,units_per_day}')::numeric,
    (m.value#>>'{derived,estimated_total_units}')::numeric
  FROM jsonb_array_elements(p_result_json->'medicines') AS m(value);

  INSERT INTO public.prescription_recommendations (
    prescription_id, type, title, message, related_medicine_sequence_number, confidence
  ) SELECT p_prescription_id, r.value->>'type', r.value->>'title', r.value->>'message',
    (r.value->>'related_medicine_sequence_number')::integer, (r.value->>'confidence')::numeric
  FROM jsonb_array_elements(p_result_json->'recommendations') AS r(value);
  INSERT INTO public.prescription_warnings (
    prescription_id, code, severity, message, related_medicine_sequence_number
  ) SELECT p_prescription_id, w.value->>'code', w.value->>'severity', w.value->>'message',
    (w.value->>'related_medicine_sequence_number')::integer
  FROM jsonb_array_elements(p_result_json->'warnings') AS w(value);

  UPDATE public.prescriptions AS p SET
    status = v_status,
    prescription_date = (p_result_json#>>'{prescription,prescription_date}')::date,
    doctor_name = p_result_json#>>'{prescription,doctor,name}',
    doctor_registration_number = p_result_json#>>'{prescription,doctor,registration_number}',
    facility_name = p_result_json#>>'{prescription,facility,name}',
    facility_address = p_result_json#>>'{prescription,facility,address}',
    facility_phone = p_result_json#>>'{prescription,facility,phone}',
    patient_name = p_result_json#>>'{patient,name}',
    patient_age = (p_result_json#>>'{patient,age}')::integer,
    patient_gender = p_result_json#>>'{patient,gender}',
    intelligence_schema_version = '1.0',
    intelligence_dataset_version = p_result_json#>>'{processing_metadata,dataset_version}',
    intelligence_model_version = p_result_json#>>'{processing_metadata,model_version}',
    overall_confidence = (p_result_json#>>'{processing_metadata,overall_confidence}')::numeric,
    processed_at = v_now
  WHERE p.id = p_prescription_id AND p.user_id = v_job.user_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'job lineage invalid'; END IF;

  UPDATE public.ai_jobs AS j SET status = 'completed', completed_at = v_now, error_message = NULL,
    result_reference = jsonb_build_object('result_id', v_result_id, 'schema_version', '1.0',
      'worker_instance_id', p_worker_instance_id, 'claim_generation', p_claim_generation),
    lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL
  WHERE j.id = p_job_id AND j.status = 'processing'
    AND j.lease_owner = p_worker_instance_id AND j.claim_generation = p_claim_generation
    AND j.lease_expires_at > v_now;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'stale finalization'; END IF;
  RETURN QUERY SELECT p_job_id, p_prescription_id, v_status, false;
END
$function$;

CREATE OR REPLACE FUNCTION public.fail_prescription_analysis_job_v1(
  p_job_id uuid, p_prescription_id uuid, p_worker_instance_id text,
  p_claim_generation bigint, p_failure_code text, p_retryable boolean,
  p_contract_code text DEFAULT NULL, p_retry_at timestamptz DEFAULT NULL
)
RETURNS TABLE (job_id uuid, prescription_id uuid, job_status text, retry_eligible boolean, terminal boolean, available_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
#variable_conflict use_column
DECLARE
  v_job public.ai_jobs%ROWTYPE;
  v_prescription public.prescriptions%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_retry boolean;
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'meddecode_worker' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'worker authorization required';
  END IF;
  IF p_job_id IS NULL OR p_prescription_id IS NULL OR p_claim_generation IS NULL
     OR p_claim_generation < 1 OR p_worker_instance_id IS NULL
     OR length(btrim(p_worker_instance_id)) NOT BETWEEN 8 AND 128
     OR p_worker_instance_id !~ '^[A-Za-z0-9._:-]+$'
      OR p_retryable IS NULL
      OR p_failure_code IS NULL
      OR p_failure_code NOT IN ('PRESCRIPTION_UNAVAILABLE', 'DOCUMENT_REFERENCE_FAILED',
       'INTELLIGENCE_TRANSPORT_FAILED', 'INTELLIGENCE_RESPONSE_INVALID',
       'INTELLIGENCE_REJECTED', 'RESULT_PERSISTENCE_FAILED')
     OR p_contract_code IS NOT NULL AND p_contract_code NOT IN ('UNSUPPORTED_FILE',
       'DOCUMENT_ACCESS_FAILED', 'INVALID_REQUEST', 'PROCESSING_FAILED') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid failure request';
  END IF;
  SELECT j.* INTO v_job FROM public.ai_jobs AS j WHERE j.id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'job not found'; END IF;
  IF v_job.job_type <> 'prescription_analysis' OR v_job.prescription_id IS DISTINCT FROM p_prescription_id THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'job correlation mismatch';
  END IF;
  SELECT p.* INTO v_prescription FROM public.prescriptions AS p
  WHERE p.id = p_prescription_id FOR UPDATE;
  IF NOT FOUND OR v_prescription.user_id IS DISTINCT FROM v_job.user_id THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'ownership mismatch';
  END IF;
  IF EXISTS (SELECT 1 FROM public.prescription_intelligence_results AS r WHERE r.prescription_id = p_prescription_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'result already exists';
  END IF;
  IF v_job.status <> 'processing' OR v_job.lease_owner IS DISTINCT FROM p_worker_instance_id
     OR v_job.claim_generation IS DISTINCT FROM p_claim_generation
     OR v_job.lease_expires_at IS NULL OR v_job.lease_expires_at <= v_now THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'stale or expired worker claim';
  END IF;
  v_retry := p_retryable AND v_job.attempt_count < v_job.max_attempts;
  IF v_retry AND (p_retry_at IS NULL OR p_retry_at <= v_now OR p_retry_at > v_now + interval '24 hours') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'retry schedule is invalid';
  END IF;
  IF NOT v_retry AND p_retry_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'terminal failure cannot schedule retry';
  END IF;
  IF v_retry THEN
    UPDATE public.ai_jobs AS j SET status = 'queued', available_at = p_retry_at,
      lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
      error_message = p_failure_code, completed_at = NULL, result_reference = NULL WHERE j.id = p_job_id;
    UPDATE public.prescriptions AS p SET status = 'queued'
      WHERE p.id = p_prescription_id AND p.user_id = v_job.user_id;
    RETURN QUERY SELECT p_job_id, p_prescription_id, 'queued'::text, true, false, p_retry_at;
    RETURN;
  END IF;
  -- Infrastructure failure is not a canonical Contract v1 failure envelope.
  -- Do not fabricate an immutable intelligence-result row.
  UPDATE public.ai_jobs AS j SET status = 'failed', completed_at = v_now, available_at = v_now,
    lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL, error_message = p_failure_code,
    result_reference = jsonb_build_object('terminal_failure_code', p_failure_code,
      'contract_code', p_contract_code, 'claim_generation', p_claim_generation) WHERE j.id = p_job_id;
  UPDATE public.prescriptions AS p SET status = 'failed'
    WHERE p.id = p_prescription_id AND p.user_id = v_job.user_id;
  RETURN QUERY SELECT p_job_id, p_prescription_id, 'failed'::text, false, true, NULL::timestamptz;
END
$function$;

CREATE OR REPLACE FUNCTION public.recover_expired_prescription_analysis_jobs_v1(p_limit integer DEFAULT 50)
RETURNS TABLE (job_id uuid, prescription_id uuid, job_status text, terminal boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
#variable_conflict use_column
DECLARE
  v_job public.ai_jobs%ROWTYPE;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'meddecode_worker' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'worker authorization required';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'recovery limit is invalid';
  END IF;
  FOR v_job IN SELECT j.* FROM public.ai_jobs AS j
    WHERE j.job_type = 'prescription_analysis' AND j.status = 'processing'
      AND j.lease_expires_at IS NOT NULL AND j.lease_expires_at <= v_now
    ORDER BY j.lease_expires_at, j.id FOR UPDATE SKIP LOCKED LIMIT p_limit
  LOOP
    IF EXISTS (SELECT 1 FROM public.prescription_intelligence_results AS r WHERE r.prescription_id = v_job.prescription_id) THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'expired job has a persisted result';
    END IF;
    PERFORM 1 FROM public.prescriptions AS p
      WHERE p.id = v_job.prescription_id AND p.user_id = v_job.user_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'job lineage invalid'; END IF;
    IF v_job.attempt_count < v_job.max_attempts THEN
      UPDATE public.ai_jobs AS j SET status = 'queued', available_at = v_now,
        lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
        claim_generation = j.claim_generation + 1, error_message = 'LEASE_EXPIRED',
        completed_at = NULL, result_reference = NULL WHERE j.id = v_job.id;
      UPDATE public.prescriptions AS p SET status = 'queued'
        WHERE p.id = v_job.prescription_id AND p.user_id = v_job.user_id;
      RETURN QUERY SELECT v_job.id, v_job.prescription_id, 'queued'::text, false;
    ELSE
      UPDATE public.ai_jobs AS j SET status = 'failed', available_at = v_now,
        lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
        claim_generation = j.claim_generation + 1, error_message = 'LEASE_EXPIRED_MAX_ATTEMPTS',
        completed_at = v_now,
        result_reference = jsonb_build_object('terminal_failure_code', 'LEASE_EXPIRED_MAX_ATTEMPTS',
          'claim_generation', j.claim_generation + 1) WHERE j.id = v_job.id;
      UPDATE public.prescriptions AS p SET status = 'failed'
        WHERE p.id = v_job.prescription_id AND p.user_id = v_job.user_id;
      RETURN QUERY SELECT v_job.id, v_job.prescription_id, 'failed'::text, true;
    END IF;
  END LOOP;
END
$function$;

ALTER FUNCTION public.complete_prescription_analysis_job_v1(uuid, uuid, text, bigint, jsonb) OWNER TO postgres;
ALTER FUNCTION public.fail_prescription_analysis_job_v1(uuid, uuid, text, bigint, text, boolean, text, timestamptz) OWNER TO postgres;
ALTER FUNCTION public.recover_expired_prescription_analysis_jobs_v1(integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.complete_prescription_analysis_job_v1(uuid, uuid, text, bigint, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_prescription_analysis_job_v1(uuid, uuid, text, bigint, text, boolean, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recover_expired_prescription_analysis_jobs_v1(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_prescription_analysis_job_v1(uuid, uuid, text, bigint, jsonb) TO meddecode_worker;
GRANT EXECUTE ON FUNCTION public.fail_prescription_analysis_job_v1(uuid, uuid, text, bigint, text, boolean, text, timestamptz) TO meddecode_worker;
GRANT EXECUTE ON FUNCTION public.recover_expired_prescription_analysis_jobs_v1(integer) TO meddecode_worker;
REVOKE ALL ON TABLE public.ai_jobs, public.prescriptions, public.prescription_intelligence_results,
  public.prescription_medicines, public.prescription_recommendations, public.prescription_warnings
  FROM meddecode_worker;
COMMIT;
