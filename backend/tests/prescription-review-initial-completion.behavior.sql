\set ON_ERROR_STOP on
BEGIN;
UPDATE public.meddecode_scoped_worker_scope SET enabled=true WHERE job_id='40000000-0000-4000-8000-000000000001';
INSERT INTO public.prescription_ocr_evidence_sets(id,prescription_id,user_id,initial_processing_job_id,schema_version,provider_count,evidence_payload)
VALUES ('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','1.0',1,'{}');
INSERT INTO public.prescription_review_revisions(id,prescription_id,user_id,evidence_set_id,revision_number,status,lock_version,review_schema_version,review_json,is_current)
VALUES ('60000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',1,'draft',0,'1.0','{}',true);
SET LOCAL SESSION AUTHORIZATION meddecode_auto_worker_login;
SET LOCAL ROLE meddecode_scoped_worker;
SELECT * FROM public.meddecode_complete_initial_review_job_v1('40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','meddecode-auto-worker-001',0,7);
RESET ROLE;
RESET SESSION AUTHORIZATION;
DO $test$
BEGIN
  IF NOT EXISTS(SELECT FROM public.ai_jobs WHERE id='40000000-0000-4000-8000-000000000001' AND status='completed' AND result_reference->>'processing_mode'='review_pending')
     OR EXISTS(SELECT FROM public.prescription_intelligence_results)
     OR NOT EXISTS(SELECT FROM public.prescription_review_revisions WHERE id='60000000-0000-4000-8000-000000000001' AND status='draft' AND is_current)
  THEN RAISE EXCEPTION 'initial review completion invariant failed'; END IF;
END $test$;
ROLLBACK;
SELECT 'PRESCRIPTION_REVIEW_INITIAL_COMPLETION_FUNCTIONAL_OK';
