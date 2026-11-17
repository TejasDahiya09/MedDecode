\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';

ALTER TABLE public.prescription_intelligence_results ADD COLUMN is_current boolean NOT NULL DEFAULT true;
DO $drop_old_unique$ DECLARE v_name name; BEGIN
  SELECT c.conname INTO v_name FROM pg_constraint c WHERE c.conrelid='public.prescription_intelligence_results'::regclass AND c.contype='u'
    AND (SELECT array_agg(a.attname ORDER BY k.ord) FROM unnest(c.conkey) WITH ORDINALITY k(attnum,ord)
      JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum)=ARRAY['prescription_id']::name[];
  IF v_name IS NULL THEN RAISE EXCEPTION 'prescription-only unique constraint missing'; END IF;
  EXECUTE format('ALTER TABLE public.prescription_intelligence_results DROP CONSTRAINT %I',v_name);
END $drop_old_unique$;
CREATE UNIQUE INDEX prescription_intelligence_results_job_uq ON public.prescription_intelligence_results(job_id);
CREATE UNIQUE INDEX prescription_intelligence_results_one_current_uq ON public.prescription_intelligence_results(prescription_id) WHERE is_current;
CREATE INDEX prescription_intelligence_results_history_idx ON public.prescription_intelligence_results(prescription_id,created_at DESC,id DESC);

CREATE FUNCTION public.meddecode_get_current_prescription_result_v1(p_prescription_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
 SELECT r.result_json FROM public.prescription_intelligence_results r JOIN public.prescriptions p ON p.id=r.prescription_id
 WHERE r.prescription_id=p_prescription_id AND r.is_current AND p.user_id=auth.uid()
$fn$;
CREATE FUNCTION public.meddecode_list_prescription_result_history_v1(p_prescription_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
 SELECT COALESCE(jsonb_agg(jsonb_build_object('resultId',r.id,'jobId',r.job_id,'reviewRevisionId',r.review_revision_id,
  'inputFingerprint',r.review_input_fingerprint,'status',r.status,'schemaVersion',r.schema_version,
  'isCurrent',r.is_current,'result',r.result_json) ORDER BY r.created_at DESC,r.id DESC),'[]'::jsonb)
 FROM public.prescription_intelligence_results r JOIN public.prescriptions p ON p.id=r.prescription_id
 WHERE r.prescription_id=p_prescription_id AND p.user_id=auth.uid()
$fn$;

CREATE FUNCTION public.meddecode_finalize_review_result_v1(
 p_job_id uuid,p_prescription_id uuid,p_review_revision_id uuid,p_input_fingerprint text,
 p_worker_instance_id text,p_claim_generation bigint,p_result_json jsonb
) RETURNS TABLE(job_id uuid,prescription_id uuid,result_status text,replayed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
#variable_conflict use_column
DECLARE v_job public.ai_jobs%ROWTYPE; v_prescription public.prescriptions%ROWTYPE;
 v_revision public.prescription_review_revisions%ROWTYPE; v_existing public.prescription_intelligence_results%ROWTYPE;
 v_result_id uuid; v_status text; v_now timestamptz:=clock_timestamp();
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'meddecode_scoped_worker' THEN RAISE EXCEPTION 'review_forbidden'; END IF;
 IF p_input_fingerprint !~ '^[0-9a-f]{64}$' OR p_claim_generation<1
   OR length(btrim(COALESCE(p_worker_instance_id,''))) NOT BETWEEN 8 AND 128
   OR p_worker_instance_id !~ '^[A-Za-z0-9._:-]+$' THEN RAISE EXCEPTION 'review_conflict'; END IF;
 IF jsonb_typeof(p_result_json)<>'object' OR pg_column_size(p_result_json)>2097152
   OR p_result_json->>'schema_version'<>'1.0' OR p_result_json->>'job_id'<>p_job_id::text
   OR p_result_json->>'prescription_id'<>p_prescription_id::text
   OR p_result_json->>'status' NOT IN ('completed','completed_with_warnings') THEN RAISE EXCEPTION 'review_conflict'; END IF;
 v_status:=p_result_json->>'status';
 SELECT * INTO v_job FROM public.ai_jobs WHERE id=p_job_id FOR UPDATE;
 IF NOT FOUND OR v_job.prescription_id<>p_prescription_id THEN RAISE EXCEPTION 'review_conflict'; END IF;
 SELECT * INTO v_prescription FROM public.prescriptions WHERE id=p_prescription_id FOR UPDATE;
 IF NOT FOUND OR v_prescription.user_id<>v_job.user_id THEN RAISE EXCEPTION 'review_forbidden'; END IF;
 SELECT * INTO v_revision FROM public.prescription_review_revisions WHERE id=p_review_revision_id AND prescription_id=p_prescription_id FOR UPDATE;
 IF NOT FOUND OR v_revision.user_id<>v_job.user_id OR NOT v_revision.is_current OR v_revision.status<>'confirmed'
   OR v_revision.input_fingerprint<>p_input_fingerprint OR v_revision.processing_job_id<>p_job_id
   OR v_revision.intelligence_state NOT IN ('bound','completed') THEN RAISE EXCEPTION 'review_stale'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.meddecode_scoped_worker_scope s WHERE s.job_id=p_job_id AND s.prescription_id=p_prescription_id
   AND s.user_id=v_job.user_id AND s.worker_login=session_user AND s.worker_instance_id=p_worker_instance_id
   AND s.enabled AND s.expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'review_forbidden'; END IF;
 SELECT * INTO v_existing FROM public.prescription_intelligence_results WHERE job_id=p_job_id FOR UPDATE;
 IF FOUND THEN
   IF v_existing.review_revision_id=p_review_revision_id AND v_existing.review_input_fingerprint=p_input_fingerprint
     AND v_existing.result_json=p_result_json AND v_existing.is_current AND v_job.status='completed' THEN
     RETURN QUERY SELECT p_job_id,p_prescription_id,v_status,true; RETURN;
   END IF;
   RAISE EXCEPTION 'review_conflict';
 END IF;
 v_now:=clock_timestamp();
 IF v_job.status<>'processing' OR v_job.lease_owner<>p_worker_instance_id OR v_job.claim_generation<>p_claim_generation
   OR v_job.lease_expires_at<=v_now THEN RAISE EXCEPTION 'review_stale'; END IF;
 UPDATE public.prescription_intelligence_results SET is_current=false WHERE prescription_id=p_prescription_id AND is_current;
 INSERT INTO public.prescription_intelligence_results(prescription_id,job_id,schema_version,status,result_json,error_json,
   review_revision_id,review_input_fingerprint,is_current)
 VALUES(p_prescription_id,p_job_id,'1.0',v_status,p_result_json,NULL,p_review_revision_id,p_input_fingerprint,true)
 RETURNING id INTO v_result_id;
 UPDATE public.prescription_review_revisions SET intelligence_state='completed',updated_at=v_now WHERE id=p_review_revision_id AND is_current;
 UPDATE public.prescriptions SET status=v_status,intelligence_schema_version='1.0',
   intelligence_dataset_version=p_result_json#>>'{processing_metadata,dataset_version}',
   intelligence_model_version=p_result_json#>>'{processing_metadata,model_version}',
   overall_confidence=(p_result_json#>>'{processing_metadata,overall_confidence}')::numeric,processed_at=v_now
 WHERE id=p_prescription_id AND user_id=v_job.user_id;
 UPDATE public.ai_jobs SET status='completed',completed_at=v_now,error_message=NULL,
   result_reference=jsonb_build_object('result_id',v_result_id,'schema_version','1.0','worker_instance_id',p_worker_instance_id,'claim_generation',p_claim_generation),
   lease_owner=NULL,lease_expires_at=NULL,heartbeat_at=NULL
 WHERE id=p_job_id AND status='processing' AND lease_owner=p_worker_instance_id AND claim_generation=p_claim_generation
   AND lease_expires_at>clock_timestamp();
 IF NOT FOUND THEN RAISE EXCEPTION 'review_stale'; END IF;
 RETURN QUERY SELECT p_job_id,p_prescription_id,v_status,false;
END $fn$;

REVOKE ALL ON FUNCTION public.meddecode_get_current_prescription_result_v1(uuid),public.meddecode_list_prescription_result_history_v1(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.meddecode_get_current_prescription_result_v1(uuid),public.meddecode_list_prescription_result_history_v1(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.meddecode_finalize_review_result_v1(uuid,uuid,uuid,text,text,bigint,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.meddecode_finalize_review_result_v1(uuid,uuid,uuid,text,text,bigint,jsonb) TO meddecode_scoped_worker;
COMMIT;
