\set ON_ERROR_STOP on

-- LOCAL INTEGRATION CANDIDATE ONLY. NOT APPROVED FOR HOSTED DEPLOYMENT.
-- Read-only catalog and integrity checks. No application data is changed here.
DO $preflight$
DECLARE
  v_bad bigint;
  v_column_count bigint;
BEGIN
  IF to_regclass('public.ai_jobs') IS NULL
     OR to_regclass('public.prescriptions') IS NULL
     OR to_regclass('public.prescription_intelligence_results') IS NULL
     OR to_regclass('public.prescription_medicines') IS NULL
     OR to_regclass('public.prescription_recommendations') IS NULL
     OR to_regclass('public.prescription_warnings') IS NULL THEN
    RAISE EXCEPTION 'required processing persistence tables are missing';
  END IF;

  IF to_regprocedure('public.submit_prescription_analysis_job_v1(uuid,jsonb)') IS NULL
     OR to_regprocedure('public.get_prescription_analysis_status_v1(uuid)') IS NULL
     OR to_regprocedure('public.claim_next_prescription_analysis_job_v1(text,integer)') IS NULL
     OR to_regprocedure('public.heartbeat_prescription_analysis_job_v1(uuid,text,bigint,integer)') IS NULL
     OR to_regclass('public.ai_jobs_one_active_prescription_analysis_uq') IS NULL
     OR to_regrole('meddecode_worker') IS NULL THEN
    RAISE EXCEPTION 'required submission or worker-claim prerequisites are missing';
  END IF;

  SELECT count(*) INTO v_column_count
  FROM pg_catalog.pg_attribute AS a
  WHERE a.attrelid = 'public.ai_jobs'::regclass AND NOT a.attisdropped
    AND a.attname IN ('id', 'user_id', 'prescription_id', 'job_type', 'status',
      'input_reference', 'result_reference', 'error_message', 'attempt_count',
      'max_attempts', 'available_at', 'lease_owner', 'lease_expires_at',
      'heartbeat_at', 'claim_generation', 'completed_at');
  IF v_column_count <> 16 THEN
    RAISE EXCEPTION 'ai_jobs finalization columns are incompatible';
  END IF;

  SELECT count(*) INTO v_column_count
  FROM pg_catalog.pg_attribute AS a
  WHERE a.attrelid = 'public.prescription_intelligence_results'::regclass
    AND NOT a.attisdropped
    AND a.attname IN ('id', 'prescription_id', 'job_id', 'schema_version', 'status',
      'result_json', 'error_json');
  IF v_column_count <> 7 THEN
    RAISE EXCEPTION 'intelligence result persistence columns are incompatible';
  END IF;

  -- The historical application schema has no required result owner column: the
  -- prescription/job lineage is the ownership authority. Do not deploy this
  -- function into a drifted schema where its INSERT would fail after a claim.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute AS a
    WHERE a.attrelid = 'public.prescription_intelligence_results'::regclass
      AND a.attname = 'user_id' AND NOT a.attisdropped AND a.attnotnull
  ) THEN
    RAISE EXCEPTION 'intelligence result table has an unsupported required user_id column';
  END IF;

  SELECT count(*) INTO v_column_count
  FROM pg_catalog.pg_attribute AS a
  WHERE a.attrelid = 'public.prescriptions'::regclass AND NOT a.attisdropped
    AND a.attname IN ('id', 'user_id', 'status', 'prescription_date',
      'doctor_name', 'doctor_registration_number', 'facility_name',
      'facility_address', 'facility_phone', 'patient_name', 'patient_age',
      'patient_gender', 'intelligence_schema_version',
      'intelligence_dataset_version', 'intelligence_model_version',
      'overall_confidence', 'processed_at');
  IF v_column_count <> 17 THEN
    RAISE EXCEPTION 'prescription intelligence persistence columns are incompatible';
  END IF;

  SELECT count(*) INTO v_bad
  FROM public.ai_jobs AS j
  LEFT JOIN public.prescriptions AS p ON p.id = j.prescription_id
  LEFT JOIN public.prescription_intelligence_results AS r ON r.prescription_id = j.prescription_id
  WHERE j.job_type = 'prescription_analysis'
    AND (j.prescription_id IS NULL OR p.id IS NULL OR p.user_id IS DISTINCT FROM j.user_id
      OR j.status NOT IN ('queued', 'processing', 'completed', 'failed')
      OR (r.id IS NOT NULL AND (r.job_id IS DISTINCT FROM j.id
        OR j.status NOT IN ('completed', 'failed'))));
  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'existing job, prescription, or result lineage is incompatible: %', v_bad;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.ai_jobs AS j
    WHERE j.job_type = 'prescription_analysis' AND j.status = 'processing'
  ) THEN
    RAISE EXCEPTION 'existing processing jobs require an operator-approved lease adoption plan';
  END IF;
END
$preflight$;
