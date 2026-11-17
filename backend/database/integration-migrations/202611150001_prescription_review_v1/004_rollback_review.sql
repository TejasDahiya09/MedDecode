-- REVIEW ONLY. Requires separate authorization and an exact inventory first.
\set ON_ERROR_STOP on
BEGIN;

DO $guard$
BEGIN
  IF EXISTS(SELECT 1 FROM public.prescription_ocr_evidence_sets)
     OR EXISTS(SELECT 1 FROM public.prescription_review_revisions)
     OR EXISTS(SELECT 1 FROM public.prescription_review_medicines)
     OR EXISTS(SELECT 1 FROM public.prescription_review_events)
     OR EXISTS(SELECT 1 FROM public.prescription_intelligence_results
       WHERE review_revision_id IS NOT NULL OR review_input_fingerprint IS NOT NULL) THEN
    RAISE EXCEPTION 'rollback refused: prescription review data exists';
  END IF;
END $guard$;

DROP TRIGGER IF EXISTS prescription_result_review_fence ON public.prescription_intelligence_results;
DROP FUNCTION IF EXISTS public.meddecode_fence_review_result_v1();
DROP FUNCTION IF EXISTS public.meddecode_assert_current_review_result_v1(uuid,uuid,text,uuid);
DROP FUNCTION IF EXISTS public.meddecode_bind_review_intelligence_job_v1(text,uuid);
DROP FUNCTION IF EXISTS public.meddecode_initialize_prescription_review_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb);
DROP FUNCTION IF EXISTS public.meddecode_reopen_prescription_review_v1(uuid,uuid,integer,bigint,jsonb,jsonb,jsonb);
DROP FUNCTION IF EXISTS public.meddecode_confirm_prescription_review_v1(uuid,uuid,integer,bigint,jsonb,jsonb,jsonb,jsonb);
DROP FUNCTION IF EXISTS public.meddecode_apply_prescription_review_draft_v1(uuid,uuid,integer,bigint,jsonb,jsonb,jsonb);
DROP FUNCTION IF EXISTS public.meddecode_get_review_intelligence_request_v1(uuid);
DROP FUNCTION IF EXISTS public.meddecode_get_prescription_review_evidence_v1(uuid);
DROP FUNCTION IF EXISTS public.meddecode_list_prescription_review_revisions_v1(uuid);
DROP FUNCTION IF EXISTS public.meddecode_get_prescription_review_v1(uuid);
DROP FUNCTION IF EXISTS public.meddecode_has_owned_prescription_review_v1(uuid);
DROP FUNCTION IF EXISTS public.meddecode_review_append_event_v1(uuid,uuid,uuid,jsonb);
DROP FUNCTION IF EXISTS public.meddecode_review_write_medicines_v1(uuid,uuid,jsonb);

ALTER TABLE public.prescription_intelligence_results
  DROP CONSTRAINT IF EXISTS prescription_result_review_binding_complete,
  DROP COLUMN IF EXISTS review_input_fingerprint,
  DROP COLUMN IF EXISTS review_revision_id;
DROP TABLE IF EXISTS public.prescription_review_events;
DROP TABLE IF EXISTS public.prescription_review_medicines;
DROP TABLE IF EXISTS public.prescription_review_revisions;
DROP TABLE IF EXISTS public.prescription_ocr_evidence_sets;
ALTER TABLE public.prescriptions DROP CONSTRAINT IF EXISTS prescriptions_id_user_review_unique;

COMMIT;
