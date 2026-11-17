\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s';

CREATE FUNCTION public.meddecode_submit_confirmed_review_job_v1(p_request_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE v_user uuid:=auth.uid(); r public.prescription_review_revisions%ROWTYPE;
 v_policy public.meddecode_auto_worker_policy%ROWTYPE; v_job public.ai_jobs%ROWTYPE;
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'review_forbidden'; END IF;
 SELECT * INTO v_policy FROM public.meddecode_auto_worker_policy WHERE singleton FOR UPDATE;
 IF NOT FOUND OR NOT v_policy.enabled OR v_policy.activated_at IS NULL THEN RAISE EXCEPTION 'review_dispatch_unavailable'; END IF;
 PERFORM 1 FROM public.meddecode_auto_test_account WHERE singleton AND user_id=v_user FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'review_forbidden'; END IF;
 SELECT * INTO r FROM public.prescription_review_revisions
  WHERE intelligence_request_key=p_request_key AND user_id=v_user AND is_current FOR UPDATE;
 IF NOT FOUND OR r.status<>'confirmed' OR r.intelligence_state NOT IN ('pending','bound') OR r.input_fingerprint IS NULL
  THEN RAISE EXCEPTION 'review_stale'; END IF;
 IF r.processing_job_id IS NOT NULL THEN
  SELECT * INTO v_job FROM public.ai_jobs WHERE id=r.processing_job_id AND user_id=v_user AND prescription_id=r.prescription_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'review_conflict'; END IF;
 ELSE
  IF EXISTS(SELECT FROM public.ai_jobs WHERE prescription_id=r.prescription_id AND job_type='prescription_analysis' AND status IN ('queued','processing'))
   OR EXISTS(SELECT FROM public.meddecode_auto_authorized_jobs a JOIN public.ai_jobs j ON j.id=a.job_id WHERE j.status IN ('queued','processing'))
   THEN RAISE EXCEPTION 'review_dispatch_busy'; END IF;
  INSERT INTO public.ai_jobs(user_id,prescription_id,job_type,status,input_reference)
   VALUES(v_user,r.prescription_id,'prescription_analysis','queued',jsonb_build_object(
    'processing_mode','confirmed_review','review_revision_id',r.id,'review_input_fingerprint',r.input_fingerprint,'contract_version','1.0'))
   RETURNING * INTO v_job;
  INSERT INTO public.meddecode_auto_authorized_jobs(job_id,prescription_id,user_id) VALUES(v_job.id,r.prescription_id,v_user);
  UPDATE public.prescription_review_revisions SET processing_job_id=v_job.id,intelligence_state='bound',updated_at=clock_timestamp()
   WHERE id=r.id AND is_current AND intelligence_state='pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'review_stale'; END IF;
  UPDATE public.prescriptions SET status='queued' WHERE id=r.prescription_id AND user_id=v_user;
 END IF;
 RETURN jsonb_build_object('requestKey',r.intelligence_request_key,'ownerId',r.user_id,'prescriptionId',r.prescription_id,
  'confirmedRevisionId',r.id,'inputFingerprint',r.input_fingerprint,'processingJobId',v_job.id,'state','bound','createdAt',r.confirmed_at);
END $fn$;

CREATE FUNCTION public.meddecode_scoped_authorize_next_confirmed_review_job_v1(p_worker_instance_id text)
RETURNS TABLE(authorized boolean) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE v_policy public.meddecode_auto_worker_policy%ROWTYPE; v_job record;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'meddecode_scoped_worker' THEN RAISE EXCEPTION 'review_forbidden'; END IF;
 SELECT * INTO v_policy FROM public.meddecode_auto_worker_policy WHERE singleton FOR UPDATE;
 IF NOT FOUND OR NOT v_policy.enabled OR session_user IS DISTINCT FROM v_policy.worker_login::text
  OR p_worker_instance_id IS DISTINCT FROM v_policy.worker_instance_id THEN RAISE EXCEPTION 'review_forbidden'; END IF;
 IF EXISTS(SELECT FROM public.meddecode_auto_authorized_jobs a JOIN public.ai_jobs j ON j.id=a.job_id
  WHERE j.status='processing' AND j.lease_owner IS DISTINCT FROM p_worker_instance_id) THEN RAISE EXCEPTION 'review_dispatch_busy'; END IF;
 SELECT j.id,j.prescription_id,j.user_id INTO v_job
 FROM public.meddecode_auto_authorized_jobs a JOIN public.ai_jobs j ON j.id=a.job_id
 JOIN public.prescription_review_revisions r ON r.processing_job_id=j.id AND r.prescription_id=j.prescription_id AND r.user_id=j.user_id
 JOIN public.meddecode_auto_test_account t ON t.singleton AND t.user_id=j.user_id
 WHERE j.status IN ('queued','processing') AND j.input_reference->>'processing_mode'='confirmed_review'
  AND r.is_current AND r.status='confirmed' AND r.intelligence_state='bound'
  AND r.input_fingerprint=j.input_reference->>'review_input_fingerprint'
  AND r.id=(j.input_reference->>'review_revision_id')::uuid
 ORDER BY j.created_at,j.id FOR UPDATE OF j SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN QUERY SELECT false; RETURN; END IF;
 INSERT INTO public.meddecode_scoped_worker_scope(job_id,prescription_id,user_id,worker_login,worker_instance_id,enabled,expires_at)
 VALUES(v_job.id,v_job.prescription_id,v_job.user_id,v_policy.worker_login,v_policy.worker_instance_id,true,
  clock_timestamp()+make_interval(secs=>v_policy.scope_seconds))
 ON CONFLICT(job_id) DO UPDATE SET enabled=true,expires_at=EXCLUDED.expires_at
 WHERE public.meddecode_scoped_worker_scope.prescription_id=EXCLUDED.prescription_id
  AND public.meddecode_scoped_worker_scope.user_id=EXCLUDED.user_id
  AND public.meddecode_scoped_worker_scope.worker_login=EXCLUDED.worker_login
  AND public.meddecode_scoped_worker_scope.worker_instance_id=EXCLUDED.worker_instance_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'review_forbidden'; END IF;
 RETURN QUERY SELECT true;
END $fn$;

CREATE FUNCTION public.meddecode_load_confirmed_review_job_v1(
 p_job_id uuid,p_prescription_id uuid,p_review_revision_id uuid,p_input_fingerprint text,p_worker_instance_id text,p_claim_generation bigint)
RETURNS TABLE(review jsonb) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'meddecode_scoped_worker' THEN RAISE EXCEPTION 'review_forbidden'; END IF;
 RETURN QUERY SELECT r.review_json FROM public.prescription_review_revisions r JOIN public.ai_jobs j ON j.id=p_job_id
 JOIN public.meddecode_scoped_worker_scope s ON s.job_id=j.id
 WHERE j.prescription_id=p_prescription_id AND j.status='processing' AND j.lease_owner=p_worker_instance_id
  AND j.claim_generation=p_claim_generation AND j.lease_expires_at>clock_timestamp()
  AND s.worker_login=session_user AND s.worker_instance_id=p_worker_instance_id AND s.enabled AND s.expires_at>clock_timestamp()
  AND r.id=p_review_revision_id AND r.prescription_id=p_prescription_id AND r.user_id=j.user_id
  AND r.is_current AND r.status='confirmed' AND r.intelligence_state='bound' AND r.processing_job_id=j.id AND r.input_fingerprint=p_input_fingerprint;
 IF NOT FOUND THEN RAISE EXCEPTION 'review_stale'; END IF;
END $fn$;

-- A confirmed-revision failure is terminal for this job only.  It deliberately
-- restores the prescription's visible status from the still-current prior
-- result, then makes the confirmed revision explicitly dispatchable again.
CREATE FUNCTION public.meddecode_fail_review_job_v1(
 p_job_id uuid,p_prescription_id uuid,p_review_revision_id uuid,p_input_fingerprint text,
 p_worker_instance_id text,p_claim_generation bigint,p_failure_code text)
RETURNS TABLE(job_id uuid,prescription_id uuid,job_status text,replay_ready boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE v_job public.ai_jobs%ROWTYPE; v_review public.prescription_review_revisions%ROWTYPE;
 v_result public.prescription_intelligence_results%ROWTYPE; v_now timestamptz:=clock_timestamp();
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'meddecode_scoped_worker' THEN RAISE EXCEPTION 'review_forbidden'; END IF;
 IF p_failure_code NOT IN ('PRESCRIPTION_UNAVAILABLE','DOCUMENT_REFERENCE_FAILED','INTELLIGENCE_TRANSPORT_FAILED',
   'INTELLIGENCE_RESPONSE_INVALID','INTELLIGENCE_REJECTED','RESULT_PERSISTENCE_FAILED') THEN RAISE EXCEPTION 'review_conflict'; END IF;
 SELECT * INTO v_job FROM public.ai_jobs j WHERE j.id=p_job_id AND j.prescription_id=p_prescription_id FOR UPDATE;
 IF NOT FOUND OR v_job.status<>'processing' OR v_job.lease_owner<>p_worker_instance_id
  OR v_job.claim_generation<>p_claim_generation OR v_job.lease_expires_at<=v_now THEN RAISE EXCEPTION 'review_stale'; END IF;
 IF NOT EXISTS(SELECT FROM public.meddecode_scoped_worker_scope s WHERE s.job_id=p_job_id
   AND s.prescription_id=p_prescription_id AND s.user_id=v_job.user_id AND s.worker_login=session_user
   AND s.worker_instance_id=p_worker_instance_id AND s.enabled AND s.expires_at>v_now) THEN RAISE EXCEPTION 'review_forbidden'; END IF;
 SELECT * INTO v_review FROM public.prescription_review_revisions r WHERE r.id=p_review_revision_id
  AND r.prescription_id=p_prescription_id AND r.user_id=v_job.user_id FOR UPDATE;
 IF NOT FOUND OR NOT v_review.is_current OR v_review.status<>'confirmed' OR v_review.input_fingerprint<>p_input_fingerprint
  OR v_review.processing_job_id<>p_job_id OR v_review.intelligence_state<>'bound' THEN RAISE EXCEPTION 'review_stale'; END IF;
 SELECT * INTO v_result FROM public.prescription_intelligence_results r
  WHERE r.prescription_id=p_prescription_id AND r.is_current FOR UPDATE;
 IF NOT FOUND OR v_result.status NOT IN ('completed','completed_with_warnings') THEN RAISE EXCEPTION 'review_conflict'; END IF;
 UPDATE public.ai_jobs j SET status='failed',completed_at=v_now,available_at=v_now,lease_owner=NULL,lease_expires_at=NULL,
  heartbeat_at=NULL,error_message=p_failure_code,result_reference=jsonb_build_object('terminal_failure_code',p_failure_code,
  'claim_generation',p_claim_generation,'review_revision_id',p_review_revision_id) WHERE j.id=p_job_id;
 UPDATE public.prescription_review_revisions r SET intelligence_state='pending',processing_job_id=NULL,updated_at=v_now WHERE r.id=p_review_revision_id;
 UPDATE public.prescriptions p SET status=v_result.status WHERE p.id=p_prescription_id AND p.user_id=v_job.user_id;
 RETURN QUERY SELECT p_job_id,p_prescription_id,'failed'::text,true;
END $fn$;

-- One fail-closed issuer entry point for the V3 worker. Both delegated issuers
-- independently enforce the dedicated login, allowlisted owner and protected
-- automatic-admission ledger; the client cannot choose a job identifier.
CREATE FUNCTION public.meddecode_scoped_authorize_next_v3_job_v1(p_worker_instance_id text)
RETURNS TABLE(authorized boolean) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE v_authorized boolean;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'meddecode_scoped_worker' THEN RAISE EXCEPTION 'review_forbidden'; END IF;
 SELECT a.authorized INTO v_authorized FROM public.meddecode_scoped_authorize_next_confirmed_review_job_v1(p_worker_instance_id) a;
 IF v_authorized THEN RETURN QUERY SELECT true; RETURN; END IF;
 SELECT a.authorized INTO v_authorized FROM public.meddecode_scoped_authorize_next_automatic_job_v1(p_worker_instance_id) a;
 RETURN QUERY SELECT COALESCE(v_authorized,false);
END $fn$;

REVOKE ALL ON FUNCTION public.meddecode_submit_confirmed_review_job_v1(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.meddecode_submit_confirmed_review_job_v1(text) TO authenticated;
REVOKE ALL ON FUNCTION public.meddecode_scoped_authorize_next_confirmed_review_job_v1(text),
 public.meddecode_scoped_authorize_next_v3_job_v1(text),
 public.meddecode_load_confirmed_review_job_v1(uuid,uuid,uuid,text,text,bigint),
 public.meddecode_fail_review_job_v1(uuid,uuid,uuid,text,text,bigint,text) FROM PUBLIC,anon,authenticated,meddecode_worker;
GRANT EXECUTE ON FUNCTION public.meddecode_scoped_authorize_next_confirmed_review_job_v1(text),
 public.meddecode_scoped_authorize_next_v3_job_v1(text),
 public.meddecode_load_confirmed_review_job_v1(uuid,uuid,uuid,text,text,bigint),
 public.meddecode_fail_review_job_v1(uuid,uuid,uuid,text,text,bigint,text) TO meddecode_scoped_worker;
COMMIT;
