\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $guard$
BEGIN
 IF current_database()<>'postgres' OR current_user<>'postgres' OR session_user<>'postgres'
 OR EXISTS(SELECT FROM information_schema.columns WHERE table_schema='public' AND table_name='meddecode_auto_worker_policy' AND column_name='current_rollout_generation')
 OR EXISTS(SELECT FROM information_schema.columns WHERE table_schema='public' AND table_name='meddecode_auto_authorized_jobs' AND column_name='rollout_generation')
 OR EXISTS(SELECT FROM public.meddecode_scoped_worker_scope s JOIN public.ai_jobs j ON j.id=s.job_id WHERE s.worker_login='meddecode_auto_worker_login' AND s.enabled AND j.status IN ('queued','processing'))
 THEN RAISE EXCEPTION 'automatic rollout generation deployment preconditions failed'; END IF;
END $guard$;

ALTER TABLE public.meddecode_auto_worker_policy ADD COLUMN current_rollout_generation bigint NOT NULL DEFAULT 1 CHECK (current_rollout_generation > 0);
ALTER TABLE public.meddecode_auto_authorized_jobs ADD COLUMN rollout_generation bigint NOT NULL DEFAULT 1 CHECK (rollout_generation > 0);
CREATE TABLE public.meddecode_auto_rollout_generations (
 generation bigint PRIMARY KEY CHECK (generation > 0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 activated_at timestamptz,
 retired_at timestamptz,
 CHECK (retired_at IS NULL OR activated_at IS NOT NULL),
 CHECK (retired_at IS NULL OR retired_at >= activated_at)
);
ALTER TABLE public.meddecode_auto_rollout_generations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meddecode_auto_rollout_generations FROM PUBLIC, anon, authenticated, meddecode_worker, meddecode_scoped_worker;
INSERT INTO public.meddecode_auto_rollout_generations(generation,created_at,activated_at)
 SELECT 1, coalesce(activated_at,clock_timestamp()), activated_at FROM public.meddecode_auto_worker_policy WHERE singleton;
INSERT INTO public.meddecode_auto_rollout_generations(generation) VALUES (2);
UPDATE public.meddecode_auto_worker_policy SET current_rollout_generation=2, enabled=false, activated_at=NULL WHERE singleton;
CREATE INDEX meddecode_auto_authorized_jobs_generation_admitted_idx ON public.meddecode_auto_authorized_jobs(rollout_generation, admitted_at);
CREATE FUNCTION public.meddecode_auto_authorized_jobs_generation_immutable_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF OLD.rollout_generation IS DISTINCT FROM NEW.rollout_generation THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='automatic admission generation is immutable'; END IF;
 RETURN NEW;
END $fn$;
CREATE TRIGGER meddecode_auto_authorized_jobs_generation_immutable BEFORE UPDATE ON public.meddecode_auto_authorized_jobs FOR EACH ROW EXECUTE FUNCTION public.meddecode_auto_authorized_jobs_generation_immutable_v1();
REVOKE ALL ON FUNCTION public.meddecode_auto_authorized_jobs_generation_immutable_v1() FROM PUBLIC,anon,authenticated,meddecode_worker,meddecode_scoped_worker;
CREATE FUNCTION public.meddecode_auto_authorized_jobs_assign_generation_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_generation bigint;
BEGIN
 SELECT current_rollout_generation INTO v_generation FROM public.meddecode_auto_worker_policy WHERE singleton FOR SHARE;
 IF v_generation IS NULL THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='automatic rollout policy unavailable'; END IF;
 NEW.rollout_generation:=v_generation;
 RETURN NEW;
END $fn$;
CREATE TRIGGER meddecode_auto_authorized_jobs_assign_generation BEFORE INSERT ON public.meddecode_auto_authorized_jobs FOR EACH ROW EXECUTE FUNCTION public.meddecode_auto_authorized_jobs_assign_generation_v1();
REVOKE ALL ON FUNCTION public.meddecode_auto_authorized_jobs_assign_generation_v1() FROM PUBLIC,anon,authenticated,meddecode_worker,meddecode_scoped_worker;
CREATE OR REPLACE FUNCTION public.submit_automatic_prescription_analysis_job_v1(p_prescription_id uuid,p_requested_analysis jsonb)
RETURNS TABLE(job_id uuid,prescription_id uuid,job_status text,created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_user uuid:=auth.uid(); v_policy public.meddecode_auto_worker_policy%ROWTYPE; v_job record;
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION USING ERRCODE='28000',MESSAGE='authentication required'; END IF;
 SELECT * INTO v_policy FROM public.meddecode_auto_worker_policy WHERE singleton FOR UPDATE;
 IF NOT FOUND OR NOT v_policy.enabled OR v_policy.activated_at IS NULL OR v_policy.activated_at>clock_timestamp() THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='automatic authorization unavailable'; END IF;
 PERFORM 1 FROM public.meddecode_auto_test_account WHERE singleton AND user_id=v_user FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='automatic test admission unavailable'; END IF;
 SELECT * INTO v_job FROM public.submit_prescription_analysis_job_v1(p_prescription_id,p_requested_analysis);
 IF NOT FOUND OR NOT EXISTS(SELECT FROM public.ai_jobs j JOIN public.prescriptions p ON p.id=j.prescription_id AND p.user_id=j.user_id WHERE j.id=v_job.job_id AND j.prescription_id=p_prescription_id AND j.user_id=v_user AND j.job_type='prescription_analysis' AND j.status IN ('queued','processing')) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='automatic job ownership invalid'; END IF;
 IF v_job.created THEN
   IF EXISTS(SELECT FROM public.meddecode_auto_authorized_jobs WHERE rollout_generation=v_policy.current_rollout_generation) THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='automatic test job limit reached'; END IF;
   INSERT INTO public.meddecode_auto_authorized_jobs(job_id,prescription_id,user_id,rollout_generation) VALUES(v_job.job_id,p_prescription_id,v_user,v_policy.current_rollout_generation);
 ELSIF NOT EXISTS(SELECT FROM public.meddecode_auto_authorized_jobs a WHERE a.job_id=v_job.job_id AND a.prescription_id=p_prescription_id AND a.user_id=v_user AND a.rollout_generation=v_policy.current_rollout_generation) THEN
   RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='existing job is not automatically authorized';
 END IF;
 RETURN QUERY SELECT v_job.job_id,v_job.prescription_id,v_job.job_status,v_job.created;
END $fn$;
REVOKE ALL ON FUNCTION public.submit_automatic_prescription_analysis_job_v1(uuid,jsonb) FROM PUBLIC,anon,meddecode_worker,meddecode_scoped_worker;
GRANT EXECUTE ON FUNCTION public.submit_automatic_prescription_analysis_job_v1(uuid,jsonb) TO authenticated;

-- The issuer still receives no job id.  The generation predicate prevents a
-- completed historical admission, or a historical queued job, crossing runs.
CREATE OR REPLACE FUNCTION public.meddecode_scoped_authorize_next_automatic_job_v1(p_worker_instance_id text)
RETURNS TABLE(authorized boolean) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_policy public.meddecode_auto_worker_policy%ROWTYPE; v_job record; v_processing integer;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'meddecode_scoped_worker' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='scoped worker authorization required'; END IF;
 SELECT * INTO v_policy FROM public.meddecode_auto_worker_policy WHERE singleton FOR UPDATE;
 IF NOT FOUND OR NOT v_policy.enabled OR v_policy.activated_at IS NULL OR v_policy.activated_at>clock_timestamp() OR session_user IS DISTINCT FROM v_policy.worker_login::text OR p_worker_instance_id IS DISTINCT FROM v_policy.worker_instance_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='automatic issuer unavailable'; END IF;
 SELECT count(*) INTO v_processing FROM public.meddecode_auto_authorized_jobs a JOIN public.ai_jobs j ON j.id=a.job_id WHERE a.rollout_generation=v_policy.current_rollout_generation AND j.status='processing';
 IF v_processing>1 OR EXISTS(SELECT FROM public.meddecode_auto_authorized_jobs a JOIN public.ai_jobs j ON j.id=a.job_id WHERE a.rollout_generation=v_policy.current_rollout_generation AND j.status='processing' AND j.lease_owner IS DISTINCT FROM v_policy.worker_instance_id) THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='automatic worker concurrency conflict'; END IF;
 SELECT j.id,j.prescription_id,j.user_id INTO v_job FROM public.meddecode_auto_authorized_jobs a JOIN public.ai_jobs j ON j.id=a.job_id AND j.user_id=a.user_id AND j.prescription_id=a.prescription_id JOIN public.prescriptions p ON p.id=j.prescription_id AND p.user_id=j.user_id
 WHERE a.rollout_generation=v_policy.current_rollout_generation AND j.job_type='prescription_analysis' AND ((j.status='processing' AND p.status='processing' AND j.lease_owner=v_policy.worker_instance_id) OR (j.status='queued' AND p.status='queued' AND j.attempt_count<j.max_attempts))
 ORDER BY CASE WHEN j.status='processing' THEN 0 ELSE 1 END,j.created_at,j.id LIMIT 1 FOR UPDATE OF j SKIP LOCKED;
 IF NOT FOUND THEN RETURN QUERY SELECT false; RETURN; END IF;
 PERFORM 1 FROM public.meddecode_auto_test_account WHERE singleton AND user_id=v_job.user_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='automatic test authorization unavailable'; END IF;
 INSERT INTO public.meddecode_scoped_worker_scope(job_id,prescription_id,user_id,worker_login,worker_instance_id,enabled,expires_at) VALUES(v_job.id,v_job.prescription_id,v_job.user_id,v_policy.worker_login,v_policy.worker_instance_id,true,clock_timestamp()+make_interval(secs=>v_policy.scope_seconds)) ON CONFLICT(job_id) DO UPDATE SET enabled=true,expires_at=EXCLUDED.expires_at WHERE public.meddecode_scoped_worker_scope.prescription_id=EXCLUDED.prescription_id AND public.meddecode_scoped_worker_scope.user_id=EXCLUDED.user_id AND public.meddecode_scoped_worker_scope.worker_login=EXCLUDED.worker_login AND public.meddecode_scoped_worker_scope.worker_instance_id=EXCLUDED.worker_instance_id;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='existing scope identity conflict'; END IF;
 RETURN QUERY SELECT true;
END $fn$;
REVOKE ALL ON FUNCTION public.meddecode_scoped_authorize_next_automatic_job_v1(text) FROM PUBLIC,anon,authenticated,meddecode_worker;
GRANT EXECUTE ON FUNCTION public.meddecode_scoped_authorize_next_automatic_job_v1(text) TO meddecode_scoped_worker;

-- Confirmed-review jobs are ledgered by Migration 003.  The insertion trigger
-- binds them to the current run; this issuer must also refuse historic runs.
CREATE OR REPLACE FUNCTION public.meddecode_scoped_authorize_next_confirmed_review_job_v1(p_worker_instance_id text)
RETURNS TABLE(authorized boolean) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE v_policy public.meddecode_auto_worker_policy%ROWTYPE; v_job record;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'meddecode_scoped_worker' THEN RAISE EXCEPTION 'review_forbidden'; END IF;
 SELECT * INTO v_policy FROM public.meddecode_auto_worker_policy WHERE singleton FOR UPDATE;
 IF NOT FOUND OR NOT v_policy.enabled OR v_policy.activated_at IS NULL OR session_user IS DISTINCT FROM v_policy.worker_login::text OR p_worker_instance_id IS DISTINCT FROM v_policy.worker_instance_id THEN RAISE EXCEPTION 'review_forbidden'; END IF;
 IF EXISTS(SELECT FROM public.meddecode_auto_authorized_jobs a JOIN public.ai_jobs j ON j.id=a.job_id WHERE a.rollout_generation=v_policy.current_rollout_generation AND j.status='processing' AND j.lease_owner IS DISTINCT FROM p_worker_instance_id) THEN RAISE EXCEPTION 'review_dispatch_busy'; END IF;
 SELECT j.id,j.prescription_id,j.user_id INTO v_job FROM public.meddecode_auto_authorized_jobs a JOIN public.ai_jobs j ON j.id=a.job_id JOIN public.prescription_review_revisions r ON r.processing_job_id=j.id AND r.prescription_id=j.prescription_id AND r.user_id=j.user_id JOIN public.meddecode_auto_test_account t ON t.singleton AND t.user_id=j.user_id
 WHERE a.rollout_generation=v_policy.current_rollout_generation AND j.status IN ('queued','processing') AND j.input_reference->>'processing_mode'='confirmed_review' AND r.is_current AND r.status='confirmed' AND r.intelligence_state='bound' AND r.input_fingerprint=j.input_reference->>'review_input_fingerprint' AND r.id=(j.input_reference->>'review_revision_id')::uuid
 ORDER BY j.created_at,j.id FOR UPDATE OF j SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN QUERY SELECT false; RETURN; END IF;
 INSERT INTO public.meddecode_scoped_worker_scope(job_id,prescription_id,user_id,worker_login,worker_instance_id,enabled,expires_at) VALUES(v_job.id,v_job.prescription_id,v_job.user_id,v_policy.worker_login,v_policy.worker_instance_id,true,clock_timestamp()+make_interval(secs=>v_policy.scope_seconds)) ON CONFLICT(job_id) DO UPDATE SET enabled=true,expires_at=EXCLUDED.expires_at WHERE public.meddecode_scoped_worker_scope.prescription_id=EXCLUDED.prescription_id AND public.meddecode_scoped_worker_scope.user_id=EXCLUDED.user_id AND public.meddecode_scoped_worker_scope.worker_login=EXCLUDED.worker_login AND public.meddecode_scoped_worker_scope.worker_instance_id=EXCLUDED.worker_instance_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'review_forbidden'; END IF;
 RETURN QUERY SELECT true;
END $fn$;
REVOKE ALL ON FUNCTION public.meddecode_scoped_authorize_next_confirmed_review_job_v1(text) FROM PUBLIC,anon,authenticated,meddecode_worker;
GRANT EXECUTE ON FUNCTION public.meddecode_scoped_authorize_next_confirmed_review_job_v1(text) TO meddecode_scoped_worker;
DO $verify$
BEGIN
 IF NOT EXISTS(SELECT FROM public.meddecode_auto_worker_policy WHERE singleton AND current_rollout_generation=2 AND NOT enabled AND activated_at IS NULL)
 OR NOT EXISTS(SELECT FROM public.meddecode_auto_rollout_generations WHERE generation=1)
 OR NOT EXISTS(SELECT FROM public.meddecode_auto_rollout_generations WHERE generation=2 AND activated_at IS NULL)
 OR EXISTS(SELECT FROM public.meddecode_auto_authorized_jobs WHERE rollout_generation<>1)
 OR has_table_privilege('authenticated','public.meddecode_auto_rollout_generations','SELECT')
 OR has_table_privilege('meddecode_scoped_worker','public.meddecode_auto_rollout_generations','SELECT')
 THEN RAISE EXCEPTION 'automatic rollout generation verification failed'; END IF;
END $verify$;
COMMIT;
