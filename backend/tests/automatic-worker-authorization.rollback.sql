-- Synthetic rollback-only checks inside the isolated scoped_worker_verify DB.
RESET ROLE;
DO $guard$ BEGIN
  IF current_database()<>'scoped_worker_verify' OR inet_server_addr()<>'127.0.0.1'::inet OR inet_server_port()<>55439 THEN
    RAISE EXCEPTION 'isolated test target mismatch';
  END IF;
END $guard$;
INSERT INTO public.users(id) VALUES ('d1000000-0000-4000-8000-000000000001'),('d1000000-0000-4000-8000-000000000002');
INSERT INTO public.prescriptions(id,user_id,storage_provider,storage_bucket,object_key,file_type,status) VALUES
 ('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','aws_s3','fictional','private/prescriptions/d2000000-0000-4000-8000-000000000001/source.pdf','application/pdf','uploaded'),
 ('d2000000-0000-4000-8000-000000000002','d1000000-0000-4000-8000-000000000001','aws_s3','fictional','private/prescriptions/d2000000-0000-4000-8000-000000000002/source.pdf','application/pdf','uploaded'),
 ('d2000000-0000-4000-8000-000000000003','d1000000-0000-4000-8000-000000000002','aws_s3','fictional','private/prescriptions/d2000000-0000-4000-8000-000000000003/source.pdf','application/pdf','queued');
INSERT INTO public.ai_jobs(id,user_id,prescription_id,job_type,status) VALUES
 ('d3000000-0000-4000-8000-000000000003','d1000000-0000-4000-8000-000000000002','d2000000-0000-4000-8000-000000000003','prescription_analysis','queued');
SELECT set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
DO $disabled$ BEGIN
  BEGIN PERFORM * FROM public.submit_automatic_prescription_analysis_job_v1('d2000000-0000-4000-8000-000000000001','{"extract_prescription":true,"match_medicines":true,"find_alternatives":false,"generate_recommendations":true}'::jsonb);
    RAISE EXCEPTION 'disabled admission succeeded'; EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
END $disabled$;
RESET ROLE;
UPDATE public.meddecode_auto_worker_policy SET enabled=true,activated_at=clock_timestamp()-interval '1 minute',worker_login='meddecode_scoped_login',worker_instance_id='auto-test-worker-001';
SET LOCAL ROLE authenticated;
DO $admission$ DECLARE a record; b record; BEGIN
  BEGIN PERFORM * FROM public.submit_automatic_prescription_analysis_job_v1('d2000000-0000-4000-8000-000000000003','{"extract_prescription":true,"match_medicines":true,"find_alternatives":false,"generate_recommendations":true}'::jsonb);
    RAISE EXCEPTION 'cross-owner admission succeeded'; EXCEPTION WHEN no_data_found THEN NULL; END;
  SELECT * INTO a FROM public.submit_automatic_prescription_analysis_job_v1('d2000000-0000-4000-8000-000000000001','{"extract_prescription":true,"match_medicines":true,"find_alternatives":false,"generate_recommendations":true}'::jsonb);
  SELECT * INTO b FROM public.submit_automatic_prescription_analysis_job_v1('d2000000-0000-4000-8000-000000000001','{"extract_prescription":true,"match_medicines":true,"find_alternatives":false,"generate_recommendations":true}'::jsonb);
  IF NOT a.created OR b.created OR a.job_id<>b.job_id THEN RAISE EXCEPTION 'duplicate admission failed'; END IF;
  PERFORM set_config('test.auto_job_id',a.job_id::text,true);
  PERFORM * FROM public.submit_automatic_prescription_analysis_job_v1('d2000000-0000-4000-8000-000000000002','{"extract_prescription":true,"match_medicines":true,"find_alternatives":false,"generate_recommendations":true}'::jsonb);
END $admission$;
RESET ROLE;
SET SESSION AUTHORIZATION meddecode_scoped_login;
SET LOCAL ROLE meddecode_scoped_worker;
DO $issuer$ DECLARE r record; c record; BEGIN
  SELECT * INTO r FROM public.meddecode_scoped_authorize_next_automatic_job_v1('auto-test-worker-001');
  IF NOT r.authorized THEN RAISE EXCEPTION 'issuer did not authorize admitted job'; END IF;
  SELECT * INTO c FROM public.meddecode_scoped_claim_next_prescription_analysis_job_v1('auto-test-worker-001',120);
  IF c.job_id IS NULL THEN RAISE EXCEPTION 'no job claimed'; END IF; PERFORM set_config('test.auto_job_id',c.job_id::text,true);
  PERFORM * FROM public.meddecode_scoped_authorize_next_automatic_job_v1('auto-test-worker-001');
END $issuer$;
RESET SESSION AUTHORIZATION;
DO $one$ BEGIN
  IF NOT EXISTS(SELECT FROM public.meddecode_auto_authorized_jobs WHERE job_id=current_setting('test.auto_job_id')::uuid) OR (SELECT count(*) FROM public.meddecode_scoped_worker_scope WHERE enabled)<>1
     OR EXISTS(SELECT FROM public.meddecode_scoped_worker_scope WHERE job_id='d3000000-0000-4000-8000-000000000003') THEN
    RAISE EXCEPTION 'unauthorized or concurrent scope';
  END IF;
END $one$;
UPDATE public.meddecode_scoped_worker_scope SET expires_at=clock_timestamp()-interval '1 second' WHERE job_id=current_setting('test.auto_job_id')::uuid;
UPDATE public.ai_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=current_setting('test.auto_job_id')::uuid;
SET SESSION AUTHORIZATION meddecode_scoped_login;
SET LOCAL ROLE meddecode_scoped_worker;
DO $recovery$ DECLARE r record; BEGIN
  PERFORM * FROM public.meddecode_scoped_authorize_next_automatic_job_v1('auto-test-worker-001');
  SELECT * INTO r FROM public.meddecode_scoped_recover_expired_prescription_analysis_jobs_v1(1);
  IF r.job_id IS DISTINCT FROM current_setting('test.auto_job_id')::uuid OR r.job_status<>'queued' THEN RAISE EXCEPTION 'expired scope renewal or recovery failed'; END IF;
END $recovery$;
RESET SESSION AUTHORIZATION;
UPDATE public.meddecode_auto_worker_policy SET enabled=false;
SET SESSION AUTHORIZATION meddecode_scoped_login;
SET LOCAL ROLE meddecode_scoped_worker;
DO $outage$ BEGIN
  BEGIN PERFORM * FROM public.meddecode_scoped_authorize_next_automatic_job_v1('auto-test-worker-001');
    RAISE EXCEPTION 'disabled issuer succeeded'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $outage$;
RESET SESSION AUTHORIZATION;
DO $final$ BEGIN
  IF NOT EXISTS(SELECT FROM public.ai_jobs WHERE id='d3000000-0000-4000-8000-000000000003' AND status='queued' AND attempt_count=0)
     OR EXISTS(SELECT FROM public.meddecode_auto_authorized_jobs WHERE job_id='d3000000-0000-4000-8000-000000000003') THEN
    RAISE EXCEPTION 'unrelated job changed';
  END IF;
END $final$;
SELECT 'AUTOMATIC_AUTHORIZATION_ROLLBACK_TEST_OK';
