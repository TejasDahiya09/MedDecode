\set ON_ERROR_STOP on
BEGIN;
DO $guard$ BEGIN
  IF EXISTS(SELECT 1 FROM public.prescription_intelligence_results GROUP BY prescription_id HAVING count(*)>1) THEN RAISE EXCEPTION 'rollback refused: historical results exist'; END IF;
END $guard$;
DROP FUNCTION IF EXISTS public.meddecode_finalize_review_result_v1(uuid,uuid,uuid,text,text,bigint,jsonb);
DROP FUNCTION IF EXISTS public.meddecode_list_prescription_result_history_v1(uuid);
DROP FUNCTION IF EXISTS public.meddecode_get_current_prescription_result_v1(uuid);
DROP INDEX IF EXISTS public.prescription_intelligence_results_history_idx;
DROP INDEX IF EXISTS public.prescription_intelligence_results_one_current_uq;
DROP INDEX IF EXISTS public.prescription_intelligence_results_job_uq;
ALTER TABLE public.prescription_intelligence_results DROP COLUMN is_current;
ALTER TABLE public.prescription_intelligence_results ADD CONSTRAINT prescription_intelligence_results_prescription_id_key UNIQUE(prescription_id);
COMMIT;
