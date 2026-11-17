-- REVIEW ONLY. Requires separate explicit approval for activation.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $guard$ BEGIN
 IF current_database()<>'postgres' OR session_user<>'postgres' OR current_user<>'postgres'
 OR NOT EXISTS(SELECT FROM public.meddecode_auto_worker_policy WHERE singleton AND NOT enabled AND activated_at IS NULL AND worker_login='meddecode_auto_worker_login' AND worker_instance_id='meddecode-auto-worker-001' AND scope_seconds=1200)
 OR EXISTS(SELECT FROM public.meddecode_auto_test_account)
 OR EXISTS(SELECT FROM public.meddecode_auto_authorized_jobs)
 OR EXISTS(SELECT FROM public.meddecode_scoped_worker_scope WHERE worker_login='meddecode_auto_worker_login')
 OR coalesce((SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public.submit_automatic_prescription_analysis_job_v1(uuid,jsonb)')),'')<>'1ab13e9295f1c93ccb5ced918e85ed18'
 OR coalesce((SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public.meddecode_scoped_authorize_next_automatic_job_v1(text)')),'')<>'c6862244fa25935392995d5ac0760d77'
 OR NOT EXISTS(SELECT FROM public.ai_jobs WHERE id='6eb659b6-b743-42c5-81c3-c7c5d108464e' AND status='queued' AND attempt_count=0 AND lease_owner IS NULL)
 THEN RAISE EXCEPTION 'test activation prerequisites failed'; END IF;
END $guard$;
-- The UID is verified from server-side ownership of the previously completed
-- fictional test; no frontend identity or email is trusted.
INSERT INTO public.meddecode_auto_test_account(user_id)
 SELECT p.user_id FROM public.prescriptions p JOIN public.ai_jobs j ON j.prescription_id=p.id AND j.user_id=p.user_id JOIN auth.users u ON u.id=p.user_id
 WHERE p.id='9cde1d1a-e036-4c07-9f5f-cc8ec06930af' AND j.id='32e120ce-38bc-431b-b11f-0953c5b1b7e3' AND j.status='completed' AND p.user_id='9a1b7896-34cd-439b-9cfd-b26411086786';
DO $count$ BEGIN IF (SELECT count(*) FROM public.meddecode_auto_test_account)<>1 THEN RAISE EXCEPTION 'test identity verification failed'; END IF; END $count$;
UPDATE public.meddecode_auto_worker_policy SET enabled=true,activated_at=clock_timestamp() WHERE singleton;
COMMIT;