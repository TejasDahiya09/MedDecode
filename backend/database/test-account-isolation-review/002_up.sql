-- REVIEW ONLY. No hosted execution without explicit approval.
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $guard$
BEGIN
 IF current_database()<>'postgres' OR session_user<>'postgres' OR current_user<>'postgres'
 OR to_regclass('public.meddecode_auto_test_account') IS NOT NULL
 OR NOT has_schema_privilege(current_user,'public','CREATE')
 OR EXISTS(SELECT FROM pg_proc p WHERE p.oid IN (to_regprocedure('public.submit_automatic_prescription_analysis_job_v1(uuid,jsonb)'),to_regprocedure('public.meddecode_scoped_authorize_next_automatic_job_v1(text)')) AND (NOT p.prosecdef OR pg_get_userbyid(p.proowner)<>'postgres' OR NOT EXISTS(SELECT FROM unnest(p.proconfig) c WHERE c IN ('search_path=""','search_path='))))
 OR has_function_privilege('anon','public.submit_automatic_prescription_analysis_job_v1(uuid,jsonb)','EXECUTE')
 OR has_function_privilege('authenticated','public.meddecode_scoped_authorize_next_automatic_job_v1(text)','EXECUTE')
 OR NOT EXISTS(SELECT FROM public.meddecode_auto_worker_policy WHERE singleton AND NOT enabled AND activated_at IS NULL AND worker_login='meddecode_auto_worker_login' AND worker_instance_id='meddecode-auto-worker-001' AND scope_seconds=1200)
 OR EXISTS(SELECT FROM public.meddecode_auto_authorized_jobs)
 OR EXISTS(SELECT FROM public.meddecode_scoped_worker_scope WHERE worker_login='meddecode_auto_worker_login')
 OR coalesce((SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public.submit_automatic_prescription_analysis_job_v1(uuid,jsonb)')),'')<>'4573ca78959c8bae04bbbd0bfefd4356'
 OR coalesce((SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public.meddecode_scoped_authorize_next_automatic_job_v1(text)')),'')<>'e34d4e74cc4861c3cc008de708201ec6'
 THEN RAISE EXCEPTION 'test account isolation prerequisites failed'; END IF;
END $guard$;
CREATE TABLE public.meddecode_auto_test_account (
 singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
 user_id uuid NOT NULL REFERENCES public.users(id)
);
ALTER TABLE public.meddecode_auto_test_account ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meddecode_auto_test_account FROM PUBLIC,anon,authenticated,meddecode_worker,meddecode_scoped_worker;
DO $acl$ BEGIN
 IF to_regrole('service_role') IS NOT NULL THEN EXECUTE 'REVOKE ALL ON public.meddecode_auto_test_account FROM service_role'; END IF;
END $acl$;
CREATE OR REPLACE FUNCTION public.submit_automatic_prescription_analysis_job_v1(p_prescription_id uuid,p_requested_analysis jsonb)
RETURNS TABLE(job_id uuid,prescription_id uuid,job_status text,created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_user uuid := auth.uid(); v_policy public.meddecode_auto_worker_policy%ROWTYPE; v_job record;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION USING ERRCODE='28000', MESSAGE='authentication required'; END IF;
  SELECT * INTO v_policy FROM public.meddecode_auto_worker_policy WHERE singleton FOR UPDATE;
  IF NOT FOUND OR NOT v_policy.enabled OR v_policy.activated_at IS NULL OR v_policy.activated_at>clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='automatic authorization unavailable';
  END IF;
  PERFORM 1 FROM public.meddecode_auto_test_account a WHERE a.singleton AND a.user_id=v_user FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='automatic test admission unavailable'; END IF;
  SELECT * INTO v_job FROM public.submit_prescription_analysis_job_v1(p_prescription_id,p_requested_analysis);
  IF NOT FOUND OR NOT EXISTS(SELECT FROM public.ai_jobs j JOIN public.prescriptions p ON p.id=j.prescription_id AND p.user_id=j.user_id
       WHERE j.id=v_job.job_id AND j.prescription_id=p_prescription_id AND j.user_id=v_user AND j.job_type='prescription_analysis'
         AND j.status IN ('queued','processing')) THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='automatic job ownership invalid';
  END IF;
  IF v_job.created THEN
    IF EXISTS(SELECT FROM public.meddecode_auto_authorized_jobs WHERE admitted_at>=v_policy.activated_at) THEN RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='automatic test job limit reached'; END IF;
    INSERT INTO public.meddecode_auto_authorized_jobs(job_id,prescription_id,user_id) VALUES(v_job.job_id,p_prescription_id,v_user);
  ELSIF NOT EXISTS(SELECT FROM public.meddecode_auto_authorized_jobs a WHERE a.job_id=v_job.job_id AND a.prescription_id=p_prescription_id AND a.user_id=v_user AND a.admitted_at>=v_policy.activated_at) THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='existing job is not automatically authorized';
  END IF;
  RETURN QUERY SELECT v_job.job_id,v_job.prescription_id,v_job.job_status,v_job.created;
END
$function$;
CREATE OR REPLACE FUNCTION public.meddecode_scoped_authorize_next_automatic_job_v1(p_worker_instance_id text)
RETURNS TABLE(authorized boolean) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $function$
DECLARE v_policy public.meddecode_auto_worker_policy%ROWTYPE; v_job record; v_processing integer;
BEGIN
  IF current_setting('role',true) IS DISTINCT FROM 'meddecode_scoped_worker' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='scoped worker authorization required';
  END IF;
  SELECT * INTO v_policy FROM public.meddecode_auto_worker_policy WHERE singleton FOR UPDATE;
  IF NOT FOUND OR NOT v_policy.enabled OR v_policy.activated_at IS NULL OR v_policy.activated_at>clock_timestamp()
     OR session_user IS DISTINCT FROM v_policy.worker_login::text OR p_worker_instance_id IS DISTINCT FROM v_policy.worker_instance_id THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='automatic issuer unavailable';
  END IF;
  IF EXISTS(SELECT FROM public.meddecode_scoped_worker_scope s JOIN public.ai_jobs j ON j.id=s.job_id
       WHERE s.worker_login=v_policy.worker_login AND s.enabled AND j.status IN ('queued','processing')
         AND (s.worker_instance_id IS DISTINCT FROM v_policy.worker_instance_id OR NOT EXISTS(SELECT FROM public.meddecode_auto_authorized_jobs a WHERE a.job_id=s.job_id))) THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='unexpected scope for automatic worker';
  END IF;
  SELECT count(*) INTO v_processing FROM public.meddecode_auto_authorized_jobs a JOIN public.ai_jobs j ON j.id=a.job_id
    WHERE a.admitted_at>=v_policy.activated_at AND j.status='processing';
  IF v_processing>1 OR EXISTS(SELECT FROM public.meddecode_auto_authorized_jobs a JOIN public.ai_jobs j ON j.id=a.job_id
       WHERE a.admitted_at>=v_policy.activated_at AND j.status='processing' AND j.lease_owner IS DISTINCT FROM v_policy.worker_instance_id) THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='automatic worker concurrency conflict';
  END IF;
  SELECT j.id,j.prescription_id,j.user_id INTO v_job
    FROM public.meddecode_auto_authorized_jobs a JOIN public.ai_jobs j ON j.id=a.job_id AND j.user_id=a.user_id AND j.prescription_id=a.prescription_id
    JOIN public.prescriptions p ON p.id=j.prescription_id AND p.user_id=j.user_id
    WHERE a.admitted_at>=v_policy.activated_at AND j.job_type='prescription_analysis'
      AND (v_processing=0 OR j.status='processing')
      AND ((j.status='processing' AND p.status='processing' AND j.lease_owner=v_policy.worker_instance_id)
        OR (j.status='queued' AND p.status='queued' AND j.attempt_count<j.max_attempts))
      AND NOT EXISTS(SELECT FROM public.prescription_intelligence_results r WHERE r.prescription_id=j.prescription_id)
    -- Do not skip a locked head job: issuing a later job's scope while the
    -- head is being claimed could otherwise violate the concurrency limit.
    -- Keep an already authorized queued job ahead of newly admitted jobs.
    -- Otherwise a concurrently inserted, earlier-sorting job could receive
    -- a second scope while the first job is entering its claim transaction.
    ORDER BY CASE WHEN j.status='processing' THEN 0
      WHEN EXISTS (SELECT FROM public.meddecode_scoped_worker_scope s
        WHERE s.job_id=j.id AND s.enabled AND s.worker_login=v_policy.worker_login
          AND s.worker_instance_id=v_policy.worker_instance_id) THEN 1 ELSE 2 END,
      j.created_at,j.id
    LIMIT 1;
  IF NOT FOUND THEN RETURN QUERY SELECT false; RETURN; END IF;
  PERFORM 1 FROM public.meddecode_auto_test_account a WHERE a.singleton AND a.user_id=v_job.user_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='automatic test authorization unavailable'; END IF;
  -- Heartbeat/finalization lock scope before job. Renewal must use the same
  -- order to avoid deadlocking a live worker. The policy row serializes issuers.
  PERFORM 1 FROM public.meddecode_scoped_worker_scope s WHERE s.job_id=v_job.id FOR UPDATE;
  PERFORM 1 FROM public.ai_jobs j JOIN public.prescriptions p ON p.id=j.prescription_id AND p.user_id=j.user_id
    WHERE j.id=v_job.id AND j.prescription_id=v_job.prescription_id AND j.user_id=v_job.user_id
      AND j.job_type='prescription_analysis'
      AND ((j.status='processing' AND p.status='processing' AND j.lease_owner=v_policy.worker_instance_id)
        OR (j.status='queued' AND p.status='queued' AND j.attempt_count<j.max_attempts))
      AND NOT EXISTS(SELECT FROM public.prescription_intelligence_results r WHERE r.prescription_id=j.prescription_id)
    FOR UPDATE OF j;
  IF NOT FOUND THEN RETURN QUERY SELECT false; RETURN; END IF;
  UPDATE public.meddecode_scoped_worker_scope s SET enabled=false
    WHERE s.worker_login=v_policy.worker_login AND s.worker_instance_id=v_policy.worker_instance_id AND s.enabled AND s.job_id<>v_job.id
      AND EXISTS(SELECT FROM public.meddecode_auto_authorized_jobs a WHERE a.job_id=s.job_id);
  INSERT INTO public.meddecode_scoped_worker_scope(job_id,prescription_id,user_id,worker_login,worker_instance_id,enabled,expires_at)
  VALUES(v_job.id,v_job.prescription_id,v_job.user_id,v_policy.worker_login,v_policy.worker_instance_id,true,clock_timestamp()+make_interval(secs=>v_policy.scope_seconds))
  ON CONFLICT(job_id) DO UPDATE SET enabled=true,expires_at=EXCLUDED.expires_at
    WHERE public.meddecode_scoped_worker_scope.prescription_id=EXCLUDED.prescription_id
      AND public.meddecode_scoped_worker_scope.user_id=EXCLUDED.user_id
      AND public.meddecode_scoped_worker_scope.worker_login=EXCLUDED.worker_login
      AND public.meddecode_scoped_worker_scope.worker_instance_id=EXCLUDED.worker_instance_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='existing scope identity conflict'; END IF;
  RETURN QUERY SELECT true;
END
$function$;
DO $verify$
BEGIN
 IF EXISTS(SELECT FROM public.meddecode_auto_test_account)
 OR NOT EXISTS(SELECT FROM pg_class WHERE oid='public.meddecode_auto_test_account'::regclass AND relrowsecurity)
 OR EXISTS(SELECT FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE c.oid='public.meddecode_auto_test_account'::regclass AND a.grantee<>c.relowner)
 OR has_table_privilege('authenticated','public.meddecode_auto_test_account','SELECT')
 OR has_table_privilege('meddecode_scoped_worker','public.meddecode_auto_test_account','SELECT')
 OR NOT has_function_privilege('authenticated','public.submit_automatic_prescription_analysis_job_v1(uuid,jsonb)','EXECUTE')
 OR NOT has_function_privilege('meddecode_scoped_worker','public.meddecode_scoped_authorize_next_automatic_job_v1(text)','EXECUTE')
 THEN RAISE EXCEPTION 'test account isolation verification failed'; END IF;
END $verify$;
COMMIT;