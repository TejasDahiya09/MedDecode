-- Operational artifact. Hosted execution requires separate explicit emergency approval.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $disable$
DECLARE v_policy public.meddecode_auto_worker_policy%ROWTYPE;
BEGIN
  IF current_database()<>'postgres' OR current_user<>'postgres' OR session_user<>'postgres' THEN RAISE EXCEPTION 'generation 2 emergency disable identity failure'; END IF;
  SELECT * INTO v_policy FROM public.meddecode_auto_worker_policy WHERE singleton FOR UPDATE;
  IF NOT FOUND OR v_policy.current_rollout_generation<>2 THEN RAISE EXCEPTION 'generation 2 emergency disable policy failure'; END IF;
  UPDATE public.meddecode_auto_worker_policy SET enabled=false WHERE singleton;
  UPDATE public.meddecode_scoped_worker_scope s SET enabled=false
   WHERE s.enabled AND s.worker_login=v_policy.worker_login AND s.worker_instance_id=v_policy.worker_instance_id
     AND EXISTS (SELECT FROM public.meddecode_auto_authorized_jobs a WHERE a.job_id=s.job_id AND a.rollout_generation=v_policy.current_rollout_generation);
END $disable$;
SELECT json_build_object('policy_enabled',(SELECT enabled FROM public.meddecode_auto_worker_policy WHERE singleton),'enabled_current_generation_scopes',(SELECT count(*) FROM public.meddecode_scoped_worker_scope s JOIN public.meddecode_auto_authorized_jobs a ON a.job_id=s.job_id JOIN public.meddecode_auto_worker_policy p ON p.singleton WHERE s.enabled AND a.rollout_generation=p.current_rollout_generation),'generation_1_admissions',(SELECT count(*) FROM public.meddecode_auto_authorized_jobs WHERE rollout_generation=1),'generation_2_admissions',(SELECT count(*) FROM public.meddecode_auto_authorized_jobs WHERE rollout_generation=2))::text;
COMMIT;
