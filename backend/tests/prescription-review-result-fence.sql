\set ON_ERROR_STOP on
BEGIN;

INSERT INTO public.prescription_ocr_evidence_sets(id,prescription_id,user_id,schema_version,provider_count)
VALUES('40000000-0000-4000-8000-000000000009','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','ocr-evidence.v1',1);
INSERT INTO public.prescription_review_revisions(
  id,prescription_id,user_id,evidence_set_id,revision_number,status,lock_version,review_schema_version,
  review_json,input_fingerprint,confirmation_idempotency_key,confirmed_at,intelligence_state,
  intelligence_request_key,processing_job_id
) VALUES (
  '50000000-0000-4000-8000-000000000009','20000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000009',1,'confirmed',1,'1.0',
  '{"schemaVersion":"1.0"}','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'confirm-fence','2026-11-15T10:00:00Z','bound','review:fence',
  '30000000-0000-4000-8000-000000000001'
);

INSERT INTO public.prescription_intelligence_results(prescription_id,job_id,result_json)
VALUES('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','{}')
RETURNING review_revision_id,review_input_fingerprint;

DO $test$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.prescription_intelligence_results
    WHERE job_id='30000000-0000-4000-8000-000000000001'
      AND review_revision_id='50000000-0000-4000-8000-000000000009'
      AND review_input_fingerprint='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  ) THEN RAISE EXCEPTION 'review binding was not populated'; END IF;
  DELETE FROM public.prescription_intelligence_results WHERE job_id='30000000-0000-4000-8000-000000000001';
  UPDATE public.prescription_review_revisions SET is_current=false,intelligence_state='stale'
    WHERE id='50000000-0000-4000-8000-000000000009';
  BEGIN
    INSERT INTO public.prescription_intelligence_results(prescription_id,job_id,result_json)
    VALUES('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','{}');
    RAISE EXCEPTION 'stale result was accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'review_stale' THEN RAISE; END IF;
  END;
END $test$;

SELECT 'PRESCRIPTION_REVIEW_RESULT_FENCE_OK' AS marker;
ROLLBACK;
