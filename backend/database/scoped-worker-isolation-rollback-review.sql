-- REVIEW ONLY. Requires separate approval. Stop the scoped worker first.
\set ON_ERROR_STOP on
BEGIN;
DO $check$ BEGIN
  IF EXISTS (SELECT 1 FROM public.meddecode_scoped_worker_scope) THEN
    RAISE EXCEPTION 'scope registry is not empty; preserve evidence and stop';
  END IF;
END $check$;
DROP FUNCTION public.meddecode_scoped_claim_next_prescription_analysis_job_v1(text,integer);
DROP FUNCTION public.meddecode_scoped_heartbeat_prescription_analysis_job_v1(uuid,text,bigint,integer);
DROP FUNCTION public.meddecode_scoped_complete_prescription_analysis_job_v1(uuid,uuid,text,bigint,jsonb);
DROP FUNCTION public.meddecode_scoped_fail_prescription_analysis_job_v1(uuid,uuid,text,bigint,text,boolean,text,timestamptz);
DROP FUNCTION public.meddecode_scoped_recover_expired_prescription_analysis_jobs_v1(integer);
DROP TABLE public.meddecode_scoped_worker_scope;
COMMIT;
