-- REVIEW ONLY. Stop workers and require no queued/processing V3 jobs first.
BEGIN;
DROP FUNCTION public.meddecode_load_confirmed_review_job_v1(uuid,uuid,uuid,text,text,bigint);
DROP FUNCTION public.meddecode_fail_review_job_v1(uuid,uuid,uuid,text,text,bigint,text);
DROP FUNCTION public.meddecode_scoped_authorize_next_v3_job_v1(text);
DROP FUNCTION public.meddecode_scoped_authorize_next_confirmed_review_job_v1(text);
DROP FUNCTION public.meddecode_submit_confirmed_review_job_v1(text);
COMMIT;
