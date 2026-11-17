\set ON_ERROR_STOP on
-- REVIEW ONLY. Separate approval required; never deletes permit audit records.
BEGIN;
SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='30s';
DO $guard$ BEGIN IF current_setting('meddecode.exact_retry_rollback_review',true) IS DISTINCT FROM 'approved'
 OR session_user<>'postgres' OR current_user<>'postgres' OR EXISTS(SELECT 1 FROM public.meddecode_exact_job_retry_permits)
 THEN RAISE EXCEPTION 'rollback blocked: authorization or retained audit history'; END IF; END $guard$;
CREATE OR REPLACE FUNCTION public.meddecode_initialize_prescription_review_v1(
  p_job_id uuid,p_prescription_id uuid,p_evidence jsonb,p_review jsonb,p_medicines jsonb,p_event jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE v_role text:=current_setting('role',true); v_user uuid; v_evidence_id uuid; v_revision_id uuid; v_existing jsonb;
BEGIN
  IF v_role IS DISTINCT FROM 'meddecode_scoped_worker' THEN RAISE EXCEPTION 'review_forbidden'; END IF;
  SELECT j.user_id INTO v_user FROM public.ai_jobs j JOIN public.prescriptions p ON p.id=j.prescription_id AND p.user_id=j.user_id
    WHERE j.id=p_job_id AND j.prescription_id=p_prescription_id AND j.status='processing' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'review_not_found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.meddecode_scoped_worker_scope s WHERE s.job_id=p_job_id AND s.prescription_id=p_prescription_id AND s.user_id=v_user AND s.worker_login=session_user AND s.enabled AND s.expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'review_forbidden'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.meddecode_auto_authorized_jobs a JOIN public.meddecode_auto_worker_policy w ON w.singleton
    WHERE a.job_id=p_job_id AND a.prescription_id=p_prescription_id AND a.user_id=v_user AND a.rollout_generation=w.current_rollout_generation) THEN RAISE EXCEPTION 'review_forbidden'; END IF;
  SELECT review_json INTO v_existing FROM public.prescription_review_revisions WHERE prescription_id=p_prescription_id AND is_current;
  IF FOUND THEN RETURN v_existing; END IF;
  v_evidence_id:=(p_evidence->>'evidenceSetId')::uuid; v_revision_id:=(p_review->>'revisionId')::uuid;
  IF p_review->>'status'<>'draft' OR (p_review->>'revisionNumber')::integer<>1 OR (p_review->>'lockVersion')::bigint<>0 OR (p_review->>'prescriptionId')::uuid<>p_prescription_id OR pg_column_size(p_evidence)>1048576 THEN RAISE EXCEPTION 'review_conflict'; END IF;
  INSERT INTO public.prescription_ocr_evidence_sets(id,prescription_id,user_id,initial_processing_job_id,schema_version,document_sha256,page_count,provider_count,evidence_payload)
  VALUES(v_evidence_id,p_prescription_id,v_user,p_job_id,p_evidence->>'schemaVersion',nullif(p_evidence->>'documentSha256',''),NULLIF(p_evidence->>'pageCount','')::integer,COALESCE((p_evidence->>'providerCount')::integer,0),COALESCE(p_evidence->'payload','{}'::jsonb));
  INSERT INTO public.prescription_review_revisions(id,prescription_id,user_id,evidence_set_id,revision_number,status,lock_version,review_schema_version,review_json)
  VALUES(v_revision_id,p_prescription_id,v_user,v_evidence_id,1,'draft',0,'1.0',p_review);
  PERFORM public.meddecode_review_write_medicines_v1(v_revision_id,p_prescription_id,p_medicines);
  PERFORM public.meddecode_review_append_event_v1(v_user,p_prescription_id,v_revision_id,p_event);
  RETURN p_review;
END $fn$;
CREATE OR REPLACE FUNCTION public.meddecode_scoped_claim_next_prescription_analysis_job_v1(
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
CREATE OR REPLACE FUNCTION public.meddecode_scoped_recover_expired_prescription_analysis_jobs_v1(p_limit integer DEFAULT 50)
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
CREATE OR REPLACE FUNCTION public.meddecode_scoped_authorize_next_automatic_job_v1(p_worker_instance_id text)
RETURNS TABLE(authorized boolean) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_policy public.meddecode_auto_worker_policy%ROWTYPE; v_job record; v_processing integer;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'meddecode_scoped_worker' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='scoped worker authorization required'; END IF;
 SELECT * INTO v_policy FROM public.meddecode_auto_worker_policy WHERE singleton FOR UPDATE;
 IF NOT FOUND OR NOT v_policy.enabled OR v_policy.activated_at IS NULL OR v_policy.activated_at>clock_timestamp() OR session_user IS DISTINCT FROM v_policy.worker_login::text OR p_worker_instance_id IS DISTINCT FROM v_policy.worker_instance_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='automatic issuer unavailable'; END IF;
 SELECT count(*) INTO v_processing FROM public.meddecode_auto_authorized_jobs a JOIN public.ai_jobs j ON j.id=a.job_id WHERE a.rollout_generation=v_policy.current_rollout_generation AND j.status='processing';
 IF v_processing>1 OR EXISTS(SELECT FROM public.meddecode_auto_authorized_jobs a JOIN public.ai_jobs j ON j.id=a.job_id WHERE a.rollout_generation=v_policy.current_rollout_generation AND j.status='processing' AND j.lease_owner IS DISTINCT FROM v_policy.worker_instance_id) THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='automatic worker concurrency conflict'; END IF;
 SELECT j.id,j.prescription_id,j.user_id INTO v_job FROM public.meddecode_auto_authorized_jobs a JOIN public.ai_jobs j ON j.id=a.job_id AND j.user_id=a.user_id AND j.prescription_id=a.prescription_id JOIN public.prescriptions p ON p.id=j.prescription_id AND p.user_id=j.user_id
 WHERE a.rollout_generation=v_policy.current_rollout_generation AND j.job_type='prescription_analysis' AND ((j.status='processing' AND p.status='processing' AND j.lease_owner=v_policy.worker_instance_id) OR (j.status='queued' AND p.status='queued' AND j.attempt_count<j.max_attempts))
 ORDER BY CASE WHEN j.status='processing' THEN 0 ELSE 1 END,j.created_at,j.id LIMIT 1 FOR UPDATE OF j SKIP LOCKED;
 IF NOT FOUND THEN RETURN QUERY SELECT false; RETURN; END IF;
 PERFORM 1 FROM public.meddecode_auto_test_account WHERE singleton AND user_id=v_job.user_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='automatic test authorization unavailable'; END IF;
 INSERT INTO public.meddecode_scoped_worker_scope(job_id,prescription_id,user_id,worker_login,worker_instance_id,enabled,expires_at) VALUES(v_job.id,v_job.prescription_id,v_job.user_id,v_policy.worker_login,v_policy.worker_instance_id,true,clock_timestamp()+make_interval(secs=>v_policy.scope_seconds)) ON CONFLICT(job_id) DO UPDATE SET enabled=true,expires_at=EXCLUDED.expires_at WHERE public.meddecode_scoped_worker_scope.prescription_id=EXCLUDED.prescription_id AND public.meddecode_scoped_worker_scope.user_id=EXCLUDED.user_id AND public.meddecode_scoped_worker_scope.worker_login=EXCLUDED.worker_login AND public.meddecode_scoped_worker_scope.worker_instance_id=EXCLUDED.worker_instance_id;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='existing scope identity conflict'; END IF;
 RETURN QUERY SELECT true;
END $fn$;
DROP FUNCTION public.meddecode_initialize_exact_retry_review_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb,text,integer,bigint,uuid);
DROP FUNCTION public.meddecode_initialize_retry_review_core_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb);
DROP FUNCTION public.meddecode_recover_claim_exact_job_v1(uuid,uuid,uuid,text,integer);
DROP FUNCTION public.meddecode_authorize_exact_job_retry_v1(uuid,uuid,integer,bigint);
DROP TABLE public.meddecode_exact_job_retry_permits;
COMMIT;
