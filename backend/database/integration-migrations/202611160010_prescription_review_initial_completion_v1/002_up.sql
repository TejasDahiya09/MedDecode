\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $guard$
BEGIN
  IF to_regclass('public.prescription_ocr_evidence_sets') IS NULL
     OR to_regprocedure('public.meddecode_initialize_prescription_review_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb)') IS NULL
     OR to_regprocedure('public.meddecode_complete_initial_review_job_v1(uuid,uuid,text,integer,bigint)') IS NOT NULL
  THEN RAISE EXCEPTION 'initial review completion migration precondition failed'; END IF;
END $guard$;

ALTER TABLE public.prescription_ocr_evidence_sets
  ADD COLUMN initial_processing_job_id uuid REFERENCES public.ai_jobs(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX prescription_ocr_evidence_initial_job_unique
  ON public.prescription_ocr_evidence_sets(initial_processing_job_id)
  WHERE initial_processing_job_id IS NOT NULL;

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

CREATE FUNCTION public.meddecode_complete_initial_review_job_v1(
  p_job_id uuid,p_prescription_id uuid,p_worker_instance_id text,p_attempt_count integer,p_claim_generation bigint
) RETURNS TABLE(job_id uuid,prescription_id uuid,job_status text,review_state text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE v_job public.ai_jobs%ROWTYPE; v_now timestamptz:=clock_timestamp();
BEGIN
  IF current_setting('role',true) IS DISTINCT FROM 'meddecode_scoped_worker' THEN RAISE EXCEPTION 'review_forbidden'; END IF;
  SELECT j.* INTO v_job FROM public.ai_jobs j WHERE j.id=p_job_id AND j.prescription_id=p_prescription_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'review_stale'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.meddecode_scoped_worker_scope s WHERE s.job_id=p_job_id AND s.prescription_id=p_prescription_id AND s.user_id=v_job.user_id AND s.worker_login=session_user AND s.worker_instance_id=p_worker_instance_id AND s.enabled AND s.expires_at>v_now) THEN RAISE EXCEPTION 'review_forbidden'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.meddecode_auto_authorized_jobs a JOIN public.meddecode_auto_worker_policy w ON w.singleton WHERE w.enabled AND a.job_id=p_job_id AND a.prescription_id=p_prescription_id AND a.user_id=v_job.user_id AND a.rollout_generation=w.current_rollout_generation) THEN RAISE EXCEPTION 'review_forbidden'; END IF;
  IF v_job.status<>'processing' OR v_job.lease_owner<>p_worker_instance_id OR v_job.attempt_count<>p_attempt_count OR v_job.claim_generation<>p_claim_generation OR v_job.lease_expires_at<=v_now OR v_job.input_reference->>'processing_mode'='confirmed_review' THEN RAISE EXCEPTION 'review_stale'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.prescription_ocr_evidence_sets e JOIN public.prescription_review_revisions r ON r.evidence_set_id=e.id
    WHERE e.initial_processing_job_id=p_job_id AND e.prescription_id=p_prescription_id AND e.user_id=v_job.user_id AND r.prescription_id=p_prescription_id AND r.user_id=v_job.user_id AND r.is_current AND r.status='draft') THEN RAISE EXCEPTION 'review_stale'; END IF;
  -- No intelligence-result table is touched. Only user confirmation may issue
  -- a revision-bound Layers 4-5 job and final result.
  UPDATE public.ai_jobs SET status='completed',completed_at=v_now,available_at=v_now,lease_owner=NULL,lease_expires_at=NULL,heartbeat_at=NULL,
    result_reference=jsonb_build_object('processing_mode','review_pending','claim_generation',p_claim_generation) WHERE id=p_job_id;
  UPDATE public.prescriptions SET status='completed' WHERE id=p_prescription_id AND user_id=v_job.user_id;
  RETURN QUERY SELECT p_job_id,p_prescription_id,'completed'::text,'draft'::text;
END $fn$;

REVOKE ALL ON FUNCTION public.meddecode_complete_initial_review_job_v1(uuid,uuid,text,integer,bigint) FROM PUBLIC,anon,authenticated,meddecode_worker;
GRANT EXECUTE ON FUNCTION public.meddecode_complete_initial_review_job_v1(uuid,uuid,text,integer,bigint) TO meddecode_scoped_worker;
COMMIT;
