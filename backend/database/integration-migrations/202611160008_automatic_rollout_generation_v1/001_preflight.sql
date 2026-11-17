\set ON_ERROR_STOP on
BEGIN READ ONLY;
DO $guard$
BEGIN
  IF current_database() <> 'postgres' OR current_user <> 'postgres' OR session_user <> 'postgres'
     OR to_regclass('public.meddecode_auto_worker_policy') IS NULL
     OR to_regclass('public.meddecode_auto_authorized_jobs') IS NULL
     OR to_regclass('public.meddecode_auto_test_account') IS NULL
     OR to_regclass('public.meddecode_scoped_worker_scope') IS NULL
     OR to_regprocedure('public.submit_automatic_prescription_analysis_job_v1(uuid,jsonb)') IS NULL
     OR to_regprocedure('public.meddecode_scoped_authorize_next_automatic_job_v1(text)') IS NULL
     OR to_regprocedure('public.meddecode_scoped_authorize_next_v3_job_v1(text)') IS NULL
     OR EXISTS (SELECT 1 FROM public.meddecode_auto_worker_policy WHERE singleton AND enabled AND activated_at IS NULL)
     OR EXISTS (SELECT 1 FROM public.meddecode_scoped_worker_scope s JOIN public.ai_jobs j ON j.id=s.job_id
                WHERE s.worker_login='meddecode_auto_worker_login' AND s.enabled AND j.status IN ('queued','processing'))
  THEN RAISE EXCEPTION 'automatic rollout generation preflight failed'; END IF;
END $guard$;
SELECT 'AUTOMATIC_ROLLOUT_GENERATION_PREFLIGHT_OK';
ROLLBACK;
