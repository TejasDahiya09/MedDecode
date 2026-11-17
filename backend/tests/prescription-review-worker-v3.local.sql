\set ON_ERROR_STOP on
BEGIN;
DO $test$
DECLARE v_owner uuid:='10000000-0000-4000-8000-000000000001'; v_other uuid:='20000000-0000-4000-8000-000000000002';
 v_prescription uuid:='f1000000-0000-4000-8000-000000000001'; v_revision uuid:='f3000000-0000-4000-8000-000000000003';
 v_base_revision uuid:='f3000000-0000-4000-8000-000000000002'; v_initial_job uuid:='f3000000-0000-4000-8000-000000000001';
 v_evidence uuid:='f2000000-0000-4000-8000-000000000001'; v_prior_result_id uuid:='f4000000-0000-4000-8000-000000000001';
 v_current public.prescription_review_revisions%ROWTYPE; v_request text:='review-v3-local-functional'; v_result jsonb; v_job uuid;
 v_prior_result uuid; v_prior_status text; v_replay_ready boolean; v_replayed_job uuid;
BEGIN
 INSERT INTO public.users(id) VALUES(v_owner),(v_other) ON CONFLICT DO NOTHING;
 INSERT INTO public.prescriptions(id,user_id,storage_provider,storage_bucket,object_key,status)
  VALUES(v_prescription,v_owner,'local','phase1f-test','private/phase1f/source.pdf','completed');
 INSERT INTO public.ai_jobs(id,user_id,prescription_id,job_type,status,completed_at)
  VALUES(v_initial_job,v_owner,v_prescription,'prescription_analysis','completed',clock_timestamp());
 INSERT INTO public.prescription_ocr_evidence_sets(id,prescription_id,user_id,schema_version,provider_count,evidence_payload)
  VALUES(v_evidence,v_prescription,v_owner,'1.0',1,'{}'::jsonb);
 INSERT INTO public.prescription_review_revisions(id,prescription_id,user_id,evidence_set_id,revision_number,status,lock_version,
  review_schema_version,review_json,input_fingerprint,confirmation_idempotency_key,confirmed_at,is_current,intelligence_state,intelligence_request_key)
 VALUES(v_base_revision,v_prescription,v_owner,v_evidence,1,'confirmed',1,'1.0',
  jsonb_build_object('revisionId',v_base_revision::text,'revisionNumber',1,'status','confirmed'),repeat('a',64),
  'local-v3-prior',clock_timestamp(),true,'completed','local-v3-prior-request');
 INSERT INTO public.prescription_intelligence_results(id,user_id,prescription_id,job_id,schema_version,status,result_json,is_current)
  VALUES(v_prior_result_id,v_owner,v_prescription,v_initial_job,'1.0','completed','{}'::jsonb,true);
 SELECT * INTO v_current FROM public.prescription_review_revisions WHERE prescription_id=v_prescription AND is_current FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'local fixture missing'; END IF;
 UPDATE public.ai_jobs SET status='failed' WHERE prescription_id=v_prescription AND status IN ('queued','processing');
 UPDATE public.prescription_review_revisions SET is_current=false WHERE id=v_current.id;
 INSERT INTO public.prescription_review_revisions(id,prescription_id,user_id,evidence_set_id,revision_number,base_revision_id,
  status,lock_version,review_schema_version,review_json,input_fingerprint,confirmation_idempotency_key,confirmed_at,is_current,
  intelligence_state,intelligence_request_key)
 VALUES(v_revision,v_prescription,v_owner,v_current.evidence_set_id,v_current.revision_number+1,v_current.id,'confirmed',1,'1.0',
  jsonb_set(jsonb_set(jsonb_set(v_current.review_json,'{revisionId}',to_jsonb(v_revision::text)),'{revisionNumber}',to_jsonb(v_current.revision_number+1)),'{status}','"confirmed"'),
  repeat('b',64),'local-v3-confirm',clock_timestamp(),true,'pending',v_request);
 UPDATE public.meddecode_auto_worker_policy SET enabled=true,activated_at=clock_timestamp();
 INSERT INTO public.meddecode_auto_test_account(user_id) VALUES(v_owner);
 PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
 SET LOCAL ROLE authenticated;
 SELECT public.meddecode_submit_confirmed_review_job_v1(v_request) INTO v_result;
 RESET ROLE;
 v_job:=(v_result->>'processingJobId')::uuid;
 IF v_job IS NULL OR v_result->>'state'<>'bound' OR NOT EXISTS(
  SELECT FROM public.ai_jobs j JOIN public.meddecode_auto_authorized_jobs a ON a.job_id=j.id
  WHERE j.id=v_job AND j.user_id=v_owner AND j.prescription_id=v_prescription AND j.status='queued'
   AND j.input_reference->>'processing_mode'='confirmed_review') THEN RAISE EXCEPTION 'confirmed dispatch failed'; END IF;
 SELECT id,status INTO v_prior_result,v_prior_status FROM public.prescription_intelligence_results
  WHERE prescription_id=v_prescription AND is_current FOR UPDATE;
 IF v_prior_result IS NULL OR v_prior_status NOT IN ('completed','completed_with_warnings') THEN
  RAISE EXCEPTION 'prior current result missing';
 END IF;
 PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
 SET LOCAL ROLE authenticated;
 IF (public.meddecode_submit_confirmed_review_job_v1(v_request)->>'processingJobId')::uuid<>v_job THEN RAISE EXCEPTION 'dispatch replay not idempotent'; END IF;
 RESET ROLE;
 PERFORM set_config('request.jwt.claim.sub',v_other::text,true);
 SET LOCAL ROLE authenticated;
 BEGIN PERFORM public.meddecode_submit_confirmed_review_job_v1(v_request); RAISE EXCEPTION 'cross-user dispatch accepted';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM='cross-user dispatch accepted' THEN RAISE; END IF; END;
 RESET ROLE;
 UPDATE public.meddecode_auto_worker_policy
  SET worker_login='meddecode_scoped_login',worker_instance_id='phase1f-worker',enabled=true,activated_at=clock_timestamp();
 UPDATE public.ai_jobs SET status='processing',lease_owner='phase1f-worker',claim_generation=1,
  lease_expires_at=clock_timestamp()+interval '10 minutes',heartbeat_at=clock_timestamp() WHERE id=v_job;
 INSERT INTO public.meddecode_scoped_worker_scope(job_id,prescription_id,user_id,worker_login,worker_instance_id,enabled,expires_at)
 VALUES(v_job,v_prescription,v_owner,'meddecode_scoped_login','phase1f-worker',true,clock_timestamp()+interval '10 minutes');
 SET LOCAL SESSION AUTHORIZATION meddecode_scoped_login;
 SET LOCAL ROLE meddecode_scoped_worker;
 SELECT replay_ready INTO v_replay_ready FROM public.meddecode_fail_review_job_v1(
  v_job,v_prescription,v_revision,repeat('b',64),'phase1f-worker',1,'INTELLIGENCE_REJECTED');
 RESET ROLE;
 RESET SESSION AUTHORIZATION;
 IF NOT v_replay_ready
  OR NOT EXISTS(SELECT FROM public.ai_jobs WHERE id=v_job AND status='failed')
  OR NOT EXISTS(SELECT FROM public.prescription_intelligence_results WHERE id=v_prior_result AND is_current AND status=v_prior_status)
  OR NOT EXISTS(SELECT FROM public.prescriptions WHERE id=v_prescription AND status=v_prior_status)
  OR EXISTS(SELECT FROM public.prescription_review_revisions WHERE id=v_revision AND (intelligence_state<>'pending' OR processing_job_id IS NOT NULL)) THEN
  RAISE EXCEPTION 'revision failure did not preserve prior result';
 END IF;
 PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
 SET LOCAL ROLE authenticated;
 SELECT public.meddecode_submit_confirmed_review_job_v1(v_request) INTO v_result;
 RESET ROLE;
 v_replayed_job:=(v_result->>'processingJobId')::uuid;
 IF v_replayed_job IS NULL OR v_replayed_job=v_job OR NOT EXISTS(
  SELECT FROM public.ai_jobs WHERE id=v_replayed_job AND status='queued') THEN
  RAISE EXCEPTION 'explicit recovery replay failed';
 END IF;
 RAISE NOTICE 'PRESCRIPTION_REVIEW_WORKER_FUNCTIONAL_OK';
END $test$;
ROLLBACK;
