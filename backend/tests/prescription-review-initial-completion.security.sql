\set ON_ERROR_STOP on
BEGIN;
UPDATE public.meddecode_scoped_worker_scope SET enabled=true,expires_at=clock_timestamp()+interval '5 minutes' WHERE job_id='40000000-0000-4000-8000-000000000001';
INSERT INTO public.prescription_ocr_evidence_sets(id,prescription_id,user_id,initial_processing_job_id,schema_version,provider_count,evidence_payload)
VALUES ('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','1.0',1,'{}');
INSERT INTO public.prescription_review_revisions(id,prescription_id,user_id,evidence_set_id,revision_number,status,lock_version,review_schema_version,review_json,is_current)
VALUES ('60000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',1,'draft',0,'1.0','{}',true);
SET LOCAL SESSION AUTHORIZATION meddecode_auto_worker_login;
SET LOCAL ROLE meddecode_scoped_worker;
DO $test$
DECLARE before_state jsonb; bad_job uuid:='40000000-0000-4000-8000-000000000002';
BEGIN
  SELECT jsonb_build_object('status',status,'lease',lease_owner,'generation',claim_generation,'results',(SELECT count(*) FROM public.prescription_intelligence_results)) INTO before_state FROM public.ai_jobs WHERE id='40000000-0000-4000-8000-000000000001';
  -- Wrong job/prescription, worker, attempt and generation must leave the claim unchanged.
  FOREACH bad_job IN ARRAY ARRAY['40000000-0000-4000-8000-000000000002'::uuid,'40000000-0000-4000-8000-000000000001'::uuid] LOOP
    BEGIN
      IF bad_job='40000000-0000-4000-8000-000000000002' THEN
        PERFORM * FROM public.meddecode_complete_initial_review_job_v1(bad_job,'30000000-0000-4000-8000-000000000001','meddecode-auto-worker-001',0,7);
      ELSE
        PERFORM * FROM public.meddecode_complete_initial_review_job_v1(bad_job,'30000000-0000-4000-8000-000000000001','wrong-worker',0,7);
      END IF;
      RAISE EXCEPTION 'unsafe completion accepted';
    EXCEPTION WHEN OTHERS THEN IF SQLERRM='unsafe completion accepted' THEN RAISE; END IF; END;
  END LOOP;
  BEGIN PERFORM * FROM public.meddecode_complete_initial_review_job_v1('40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','meddecode-auto-worker-001',1,7); RAISE EXCEPTION 'wrong attempt accepted'; EXCEPTION WHEN OTHERS THEN IF SQLERRM='wrong attempt accepted' THEN RAISE; END IF; END;
  BEGIN PERFORM * FROM public.meddecode_complete_initial_review_job_v1('40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','meddecode-auto-worker-001',0,8); RAISE EXCEPTION 'stale generation accepted'; EXCEPTION WHEN OTHERS THEN IF SQLERRM='stale generation accepted' THEN RAISE; END IF; END;
  IF before_state IS DISTINCT FROM (SELECT jsonb_build_object('status',status,'lease',lease_owner,'generation',claim_generation,'results',(SELECT count(*) FROM public.prescription_intelligence_results)) FROM public.ai_jobs WHERE id='40000000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'rejected completion changed state'; END IF;
END $test$;
RESET ROLE;
RESET SESSION AUTHORIZATION;
DO $anon$
BEGIN
  SET LOCAL ROLE authenticated;
  BEGIN PERFORM * FROM public.meddecode_complete_initial_review_job_v1('40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','meddecode-auto-worker-001',0,7); RAISE EXCEPTION 'authenticated invocation accepted'; EXCEPTION WHEN OTHERS THEN IF SQLERRM='authenticated invocation accepted' THEN RAISE; END IF; END;
END $anon$;
ROLLBACK;
SELECT 'PRESCRIPTION_REVIEW_INITIAL_COMPLETION_SECURITY_OK';
