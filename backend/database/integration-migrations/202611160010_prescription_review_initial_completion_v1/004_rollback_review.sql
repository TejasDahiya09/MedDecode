-- REVIEW ONLY. Do not run on hosted Supabase without separate authorization.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='5s';
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.prescription_ocr_evidence_sets WHERE initial_processing_job_id IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.ai_jobs WHERE result_reference->>'processing_mode'='review_pending') THEN
    RAISE EXCEPTION 'rollback would destroy initial-review provenance';
  END IF;
END $guard$;
DROP FUNCTION IF EXISTS public.meddecode_complete_initial_review_job_v1(uuid,uuid,text,integer,bigint);
DROP INDEX IF EXISTS public.prescription_ocr_evidence_initial_job_unique;
ALTER TABLE public.prescription_ocr_evidence_sets DROP COLUMN IF EXISTS initial_processing_job_id;
-- Restore the exact predecessor initializer body only through a reviewed migration.
ROLLBACK;
