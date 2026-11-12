\set ON_ERROR_STOP on

DO $preflight$
DECLARE
  v_incompatible bigint;
BEGIN
  IF to_regclass('public.ai_jobs') IS NULL
     OR to_regclass('public.prescriptions') IS NULL THEN
    RAISE EXCEPTION 'required MedDecode tables are missing';
  END IF;
  IF to_regprocedure('public.submit_prescription_analysis_job_v1(uuid,jsonb)') IS NULL
     OR to_regprocedure('public.get_prescription_analysis_status_v1(uuid)') IS NULL
     OR to_regclass('public.ai_jobs_one_active_prescription_analysis_uq') IS NULL THEN
    RAISE EXCEPTION 'Milestone 2C processing-job submission migration is missing';
  END IF;
  IF to_regrole('meddecode_worker') IS NULL THEN
    RAISE EXCEPTION 'dedicated meddecode_worker role is missing';
  END IF;
  SELECT count(*) INTO v_incompatible
  FROM public.ai_jobs AS j
  WHERE j.job_type = 'prescription_analysis'
    AND (j.prescription_id IS NULL
      OR j.status NOT IN ('queued', 'processing', 'completed', 'failed')
      OR (j.status = 'processing' AND j.completed_at IS NOT NULL));
  IF v_incompatible <> 0 THEN
    RAISE EXCEPTION 'incompatible existing prescription-analysis jobs: %', v_incompatible;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.ai_jobs AS j
    WHERE j.job_type = 'prescription_analysis' AND j.status = 'processing'
  ) THEN
    RAISE EXCEPTION 'existing processing jobs require an operator-approved lease adoption plan';
  END IF;
END
$preflight$;
