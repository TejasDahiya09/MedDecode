-- REVIEW ONLY. NOT TESTED OR APPROVED FOR DEPLOYMENT.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
CREATE TABLE public.meddecode_scoped_worker_scope (job_id uuid PRIMARY KEY REFERENCES public.ai_jobs(id), prescription_id uuid NOT NULL REFERENCES public.prescriptions(id), user_id uuid NOT NULL REFERENCES public.users(id), worker_login name NOT NULL, worker_instance_id text NOT NULL CHECK (length(btrim(worker_instance_id)) BETWEEN 8 AND 128 AND worker_instance_id ~ '^[A-Za-z0-9._:-]+$'), enabled boolean NOT NULL DEFAULT false, expires_at timestamptz NOT NULL);
ALTER TABLE public.meddecode_scoped_worker_scope ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meddecode_scoped_worker_scope FROM PUBLIC, anon, authenticated, meddecode_worker, meddecode_scoped_worker;
CREATE FUNCTION public.meddecode_scoped_claim_next_prescription_analysis_job_v1(
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
  IF current_setting('role', true) IS DISTINCT FROM 'meddecode_scoped_worker' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'worker authorization required';
  END IF;
  IF p_worker_instance_id IS NULL
     OR length(btrim(p_worker_instance_id)) NOT BETWEEN 8 AND 128
     OR p_worker_instance_id !~ '^[A-Za-z0-9._:-]+$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid worker instance';
  END IF;
  IF p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 300 THEN
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
  JOIN public.meddecode_scoped_worker_scope AS scope ON scope.job_id = j.id
    AND scope.prescription_id = j.prescription_id AND scope.user_id = j.user_id
    AND scope.worker_login = session_user AND scope.worker_instance_id = p_worker_instance_id AND scope.enabled
    AND scope.expires_at > clock_timestamp()
  WHERE j.job_type = 'prescription_analysis' AND j.status = 'queued'
    AND j.available_at <= clock_timestamp() AND j.attempt_count < j.max_attempts
  ORDER BY j.available_at, j.created_at, j.id
  FOR UPDATE OF j, scope SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT p.* INTO STRICT v_prescription
  FROM public.prescriptions AS p
  WHERE p.id = v_job.prescription_id AND p.user_id = v_job.user_id
    AND p.status = 'queued' AND p.storage_provider = 'aws_s3'
    AND nullif(btrim(p.storage_bucket), '') IS NOT NULL
    AND nullif(btrim(p.object_key), '') IS NOT NULL
  FOR UPDATE;

  IF NOT EXISTS (SELECT 1 FROM public.meddecode_scoped_worker_scope AS scope
    WHERE scope.job_id = v_job.id AND scope.worker_login = session_user AND scope.worker_instance_id = p_worker_instance_id
      AND scope.enabled AND scope.expires_at > clock_timestamp()) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'scoped worker authorization required';
  END IF;
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

CREATE FUNCTION public.meddecode_scoped_heartbeat_prescription_analysis_job_v1(
  p_job_id uuid, p_worker_instance_id text, p_claim_generation bigint,
  p_extend_seconds integer DEFAULT 120
)
RETURNS TABLE (job_id uuid, claim_generation bigint, lease_expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
#variable_conflict use_column
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'meddecode_scoped_worker' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'worker authorization required';
  END IF;
  IF p_job_id IS NULL OR p_claim_generation IS NULL OR p_claim_generation < 1
     OR p_worker_instance_id IS NULL
     OR length(btrim(p_worker_instance_id)) NOT BETWEEN 8 AND 128
     OR p_worker_instance_id !~ '^[A-Za-z0-9._:-]+$'
     OR p_extend_seconds IS NULL OR p_extend_seconds NOT BETWEEN 30 AND 300 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid heartbeat request';
  END IF;
  PERFORM 1 FROM public.meddecode_scoped_worker_scope AS scope
   WHERE scope.job_id = p_job_id
     AND scope.worker_login = session_user AND scope.worker_instance_id = p_worker_instance_id AND scope.enabled
     AND scope.expires_at > clock_timestamp()
     AND EXISTS (SELECT 1 FROM public.ai_jobs AS scoped_job WHERE scoped_job.id = scope.job_id
       AND scoped_job.user_id = scope.user_id AND scoped_job.prescription_id = scope.prescription_id)
     FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'scoped worker authorization required'; END IF;
  PERFORM 1 FROM public.ai_jobs AS j WHERE j.id = p_job_id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM public.meddecode_scoped_worker_scope AS scope
    WHERE scope.job_id = p_job_id AND scope.worker_login = session_user AND scope.worker_instance_id = p_worker_instance_id
      AND scope.enabled AND scope.expires_at > clock_timestamp()) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'scoped worker authorization required';
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

CREATE FUNCTION public.meddecode_scoped_complete_prescription_analysis_job_v1(
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
  v_existing_found boolean;
  v_result_id uuid;
  v_status text;
  v_now timestamptz := clock_timestamp();
  v_medicine jsonb;
  v_alternative jsonb;
  v_recommendation jsonb;
  v_warning jsonb;
  v_ordinal bigint;
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'meddecode_scoped_worker' THEN
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
     OR jsonb_typeof(p_result_json->'processing_metadata') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'result structure is incompatible';
  END IF;
  v_status := p_result_json->>'status';

  -- Lock order is ai_jobs then prescriptions then result/projection rows.
  PERFORM 1 FROM public.meddecode_scoped_worker_scope AS scope
   WHERE scope.job_id = p_job_id AND scope.prescription_id = p_prescription_id
     AND scope.worker_login = session_user AND scope.worker_instance_id = p_worker_instance_id AND scope.enabled
     AND scope.expires_at > clock_timestamp()
     AND EXISTS (SELECT 1 FROM public.ai_jobs AS scoped_job WHERE scoped_job.id = scope.job_id
       AND scoped_job.user_id = scope.user_id AND scoped_job.prescription_id = scope.prescription_id)
     FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'scoped worker authorization required'; END IF;
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

  v_existing_found := FOUND;
  IF NOT EXISTS (SELECT 1 FROM public.meddecode_scoped_worker_scope AS scope
    WHERE scope.job_id = p_job_id AND scope.worker_login = session_user AND scope.worker_instance_id = p_worker_instance_id
      AND scope.enabled AND scope.expires_at > clock_timestamp()) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'scoped worker authorization required';
  END IF;
  -- An identical completion replay is safe only when result, terminal states,
  -- and the original worker fence metadata agree.
  IF v_existing_found THEN
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

  -- Row locks can wait: evaluate the fence using a fresh time after the wait.
  v_now := clock_timestamp();
  IF v_job.status <> 'processing'
     OR v_job.lease_owner IS DISTINCT FROM p_worker_instance_id
     OR v_job.claim_generation IS DISTINCT FROM p_claim_generation
     OR v_job.lease_expires_at IS NULL OR v_job.lease_expires_at <= v_now THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'stale or expired worker claim';
  END IF;
  IF v_prescription.status IS DISTINCT FROM 'processing' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'prescription is not processing';
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
        OR COALESCE(v_medicine#>>'{medicine_match,status}' NOT IN ('matched', 'probable_match', 'ambiguous', 'unmatched', 'not_attempted'), true)
       OR jsonb_typeof(v_medicine->'alternatives') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'medicine projection is incompatible';
    END IF;
    FOR v_alternative IN SELECT value FROM jsonb_array_elements(v_medicine->'alternatives') LOOP
      IF jsonb_typeof(v_alternative) IS DISTINCT FROM 'object'
        OR jsonb_typeof(v_alternative->'medicine_external_id') IS DISTINCT FROM 'string'
        OR length(v_alternative->>'medicine_external_id') = 0
        OR jsonb_typeof(v_alternative->'brand_name') IS DISTINCT FROM 'string'
        OR jsonb_typeof(v_alternative#>'{match_basis,ingredient_equivalence}') IS DISTINCT FROM 'boolean'
        OR jsonb_typeof(v_alternative#>'{match_basis,strength_compatibility}') IS DISTINCT FROM 'boolean'
        OR jsonb_typeof(v_alternative#>'{match_basis,dosage_form_compatibility}') IS DISTINCT FROM 'boolean' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'alternative projection is incompatible';
      END IF;
    END LOOP;
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
    match_confidence, medicine_id, medicine_external_id, units_per_day, estimated_total_units
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
    (m.value#>>'{medicine_match,confidence}')::numeric, NULL, m.value#>>'{medicine_match,medicine_external_id}',
    (m.value#>>'{derived,units_per_day}')::numeric,
    (m.value#>>'{derived,estimated_total_units}')::numeric
  FROM jsonb_array_elements(p_result_json->'medicines') AS m(value);

  -- Preserve external IDs and explicitly returned compatibility evidence.
  -- Legacy medicine_id stays NULL: no official-to-legacy mapping is inferred.
  INSERT INTO public.prescription_medicine_alternatives (
    prescription_medicine_id, medicine_id, medicine_external_id, ingredient_equivalence,
    strength_compatibility, dosage_form_compatibility, price_value, price_currency,
    price_unit_description, confidence, note
  ) SELECT pm.id, NULL, alt.value->>'medicine_external_id',
    (alt.value#>>'{match_basis,ingredient_equivalence}')::boolean,
    (alt.value#>>'{match_basis,strength_compatibility}')::boolean,
    (alt.value#>>'{match_basis,dosage_form_compatibility}')::boolean,
    (alt.value#>>'{price,value}')::numeric, alt.value#>>'{price,currency}',
    alt.value#>>'{price,unit_description}', (alt.value->>'confidence')::numeric, alt.value->>'note'
  FROM jsonb_array_elements(p_result_json->'medicines') AS med(value)
  JOIN public.prescription_medicines pm ON pm.prescription_id=p_prescription_id
    AND pm.sequence_number=(med.value->>'sequence_number')::integer
  CROSS JOIN LATERAL jsonb_array_elements(med.value->'alternatives') AS alt(value);

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
    AND j.lease_expires_at > clock_timestamp();
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'stale finalization'; END IF;
  RETURN QUERY SELECT p_job_id, p_prescription_id, v_status, false;
END
$function$;

CREATE FUNCTION public.meddecode_scoped_fail_prescription_analysis_job_v1(
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
  IF current_setting('role', true) IS DISTINCT FROM 'meddecode_scoped_worker' THEN
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
  PERFORM 1 FROM public.meddecode_scoped_worker_scope AS scope
   WHERE scope.job_id = p_job_id AND scope.prescription_id = p_prescription_id
     AND scope.worker_login = session_user AND scope.worker_instance_id = p_worker_instance_id AND scope.enabled
     AND scope.expires_at > clock_timestamp()
     AND EXISTS (SELECT 1 FROM public.ai_jobs AS scoped_job WHERE scoped_job.id = scope.job_id
       AND scoped_job.user_id = scope.user_id AND scoped_job.prescription_id = scope.prescription_id)
     FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'scoped worker authorization required'; END IF;
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
  IF NOT EXISTS (SELECT 1 FROM public.meddecode_scoped_worker_scope AS scope
    WHERE scope.job_id = p_job_id AND scope.worker_login = session_user AND scope.worker_instance_id = p_worker_instance_id
      AND scope.enabled AND scope.expires_at > clock_timestamp()) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'scoped worker authorization required';
  END IF;
  IF EXISTS (SELECT 1 FROM public.prescription_intelligence_results AS r WHERE r.prescription_id = p_prescription_id) THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'result already exists';
  END IF;
  v_now := clock_timestamp();
  IF v_job.status <> 'processing' OR v_job.lease_owner IS DISTINCT FROM p_worker_instance_id
     OR v_job.claim_generation IS DISTINCT FROM p_claim_generation
     OR v_job.lease_expires_at IS NULL OR v_job.lease_expires_at <= v_now THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'stale or expired worker claim';
  END IF;
  IF v_prescription.status IS DISTINCT FROM 'processing' THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'prescription is not processing';
  END IF;
  v_retry := p_retryable AND v_job.attempt_count < v_job.max_attempts;
  IF v_retry AND (p_retry_at IS NULL OR p_retry_at <= v_now OR p_retry_at > v_now + interval '24 hours') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'retry schedule is invalid';
  END IF;
  -- A retryable failure may supply a schedule even on its last attempt; the
  -- locked database row decides exhaustion and ignores that schedule.
  IF NOT p_retryable AND p_retry_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'terminal failure cannot schedule retry';
  END IF;
  IF v_retry THEN
    UPDATE public.ai_jobs AS j SET status = 'queued', available_at = p_retry_at,
      lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
      error_message = p_failure_code, completed_at = NULL, result_reference = NULL
      WHERE j.id = p_job_id AND j.status = 'processing'
        AND j.lease_owner = p_worker_instance_id AND j.claim_generation = p_claim_generation
        AND j.lease_expires_at > clock_timestamp();
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'stale failure'; END IF;
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
      'contract_code', p_contract_code, 'claim_generation', p_claim_generation)
    WHERE j.id = p_job_id AND j.status = 'processing'
      AND j.lease_owner = p_worker_instance_id AND j.claim_generation = p_claim_generation
      AND j.lease_expires_at > clock_timestamp();
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'stale failure'; END IF;
  UPDATE public.prescriptions AS p SET status = 'failed'
    WHERE p.id = p_prescription_id AND p.user_id = v_job.user_id;
  RETURN QUERY SELECT p_job_id, p_prescription_id, 'failed'::text, false, true, NULL::timestamptz;
END
$function$;

CREATE FUNCTION public.meddecode_scoped_recover_expired_prescription_analysis_jobs_v1(p_limit integer DEFAULT 50)
RETURNS TABLE (job_id uuid, prescription_id uuid, job_status text, terminal boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
#variable_conflict use_column
DECLARE
  v_job public.ai_jobs%ROWTYPE;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'meddecode_scoped_worker' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'worker authorization required';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'recovery limit is invalid';
  END IF;
  FOR v_job IN SELECT j.* FROM public.ai_jobs AS j
    JOIN public.meddecode_scoped_worker_scope AS scope ON scope.job_id = j.id
      AND scope.prescription_id = j.prescription_id AND scope.user_id = j.user_id
      AND scope.worker_login = session_user AND scope.worker_instance_id = j.lease_owner AND scope.enabled AND scope.expires_at > clock_timestamp()
    WHERE j.job_type = 'prescription_analysis' AND j.status = 'processing'
      AND j.lease_expires_at IS NOT NULL AND j.lease_expires_at <= v_now
    ORDER BY j.lease_expires_at, j.id FOR UPDATE OF j, scope SKIP LOCKED LIMIT p_limit
  LOOP
    IF EXISTS (SELECT 1 FROM public.prescription_intelligence_results AS r WHERE r.prescription_id = v_job.prescription_id) THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'expired job has a persisted result';
    END IF;
    PERFORM 1 FROM public.prescriptions AS p
      WHERE p.id = v_job.prescription_id AND p.user_id = v_job.user_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'job lineage invalid'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.meddecode_scoped_worker_scope AS scope
    WHERE scope.job_id = v_job.id AND scope.worker_login = session_user AND scope.worker_instance_id = v_job.lease_owner
      AND scope.enabled AND scope.expires_at > clock_timestamp()) THEN
    CONTINUE;
  END IF;
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
REVOKE ALL ON FUNCTION public.meddecode_scoped_claim_next_prescription_analysis_job_v1(text, integer) FROM PUBLIC, anon, authenticated, meddecode_worker;
GRANT EXECUTE ON FUNCTION public.meddecode_scoped_claim_next_prescription_analysis_job_v1(text, integer) TO meddecode_scoped_worker;
REVOKE ALL ON FUNCTION public.meddecode_scoped_heartbeat_prescription_analysis_job_v1(uuid, text, bigint, integer) FROM PUBLIC, anon, authenticated, meddecode_worker;
GRANT EXECUTE ON FUNCTION public.meddecode_scoped_heartbeat_prescription_analysis_job_v1(uuid, text, bigint, integer) TO meddecode_scoped_worker;
REVOKE ALL ON FUNCTION public.meddecode_scoped_complete_prescription_analysis_job_v1(uuid, uuid, text, bigint, jsonb) FROM PUBLIC, anon, authenticated, meddecode_worker;
GRANT EXECUTE ON FUNCTION public.meddecode_scoped_complete_prescription_analysis_job_v1(uuid, uuid, text, bigint, jsonb) TO meddecode_scoped_worker;
REVOKE ALL ON FUNCTION public.meddecode_scoped_fail_prescription_analysis_job_v1(uuid, uuid, text, bigint, text, boolean, text, timestamptz) FROM PUBLIC, anon, authenticated, meddecode_worker;
GRANT EXECUTE ON FUNCTION public.meddecode_scoped_fail_prescription_analysis_job_v1(uuid, uuid, text, bigint, text, boolean, text, timestamptz) TO meddecode_scoped_worker;
REVOKE ALL ON FUNCTION public.meddecode_scoped_recover_expired_prescription_analysis_jobs_v1(integer) FROM PUBLIC, anon, authenticated, meddecode_worker;
GRANT EXECUTE ON FUNCTION public.meddecode_scoped_recover_expired_prescription_analysis_jobs_v1(integer) TO meddecode_scoped_worker;
COMMIT;
