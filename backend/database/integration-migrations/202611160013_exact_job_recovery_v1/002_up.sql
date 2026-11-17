\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
DO $guard$
BEGIN
 IF session_user <> 'postgres' OR current_user <> 'postgres'
 OR to_regclass('public.meddecode_exact_job_retry_permits') IS NOT NULL
 OR to_regprocedure('public.meddecode_complete_initial_review_job_v1(uuid,uuid,text,integer,bigint)') IS NULL
 OR to_regclass('public.meddecode_auto_test_account') IS NULL
 OR NOT EXISTS (SELECT 1 FROM public.meddecode_auto_worker_policy WHERE singleton AND current_rollout_generation=2)
 OR (SELECT encode(sha256(convert_to(replace(prosrc,E'\r',''),'UTF8')),'hex') FROM pg_proc
     WHERE oid=to_regprocedure('public.meddecode_initialize_prescription_review_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb)')) IS DISTINCT FROM '64a180563d00dfd5373756dbc33b2c359583738a8361521914badef034050930'
 OR (SELECT encode(sha256(convert_to(replace(prosrc,E'\r',''),'UTF8')),'hex') FROM pg_proc
     WHERE oid=to_regprocedure('public.meddecode_scoped_claim_next_prescription_analysis_job_v1(text,integer)')) IS DISTINCT FROM '73d680941b284635b17e793f1db1f02efdcc47c86b69f81426c7e43143de6b2f'
 OR (SELECT encode(sha256(convert_to(replace(prosrc,E'\r',''),'UTF8')),'hex') FROM pg_proc
     WHERE oid=to_regprocedure('public.meddecode_scoped_recover_expired_prescription_analysis_jobs_v1(integer)')) IS DISTINCT FROM '35c25a1e9cdd0fd70355412155b5f0784885444c69cd915987610fe3639502e8'
 OR (SELECT encode(sha256(convert_to(replace(prosrc,E'\r',''),'UTF8')),'hex') FROM pg_proc
     WHERE oid=to_regprocedure('public.meddecode_scoped_authorize_next_automatic_job_v1(text)')) IS DISTINCT FROM '4c2196da5ac99a181159ae826e3e999a5470260dbf5ee45a1402820892bf0b56'
 OR to_regprocedure('public.meddecode_authorize_exact_job_retry_v1(uuid,uuid,integer,bigint)') IS NOT NULL
 OR to_regprocedure('public.meddecode_recover_claim_exact_job_v1(uuid,uuid,uuid,text,integer)') IS NOT NULL
 OR to_regprocedure('public.meddecode_initialize_retry_review_core_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb)') IS NOT NULL
 OR to_regprocedure('public.meddecode_initialize_exact_retry_review_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb,text,integer,bigint,uuid)') IS NOT NULL
 OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid IN (
    to_regprocedure('public.meddecode_initialize_prescription_review_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb)'),
    to_regprocedure('public.meddecode_scoped_claim_next_prescription_analysis_job_v1(text,integer)'),
    to_regprocedure('public.meddecode_scoped_recover_expired_prescription_analysis_jobs_v1(integer)'),
    to_regprocedure('public.meddecode_scoped_authorize_next_automatic_job_v1(text)')) AND (r.rolname<>'postgres' OR NOT p.prosecdef))
 THEN RAISE EXCEPTION 'exact retry deployment preflight failed'; END IF;
END $guard$;
CREATE TABLE public.meddecode_exact_job_retry_permits (
 permit_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 job_id uuid NOT NULL UNIQUE REFERENCES public.ai_jobs(id) ON DELETE RESTRICT,
 prescription_id uuid NOT NULL REFERENCES public.prescriptions(id) ON DELETE RESTRICT,
 user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
 rollout_generation bigint NOT NULL CHECK(rollout_generation=2),
 expected_attempt integer NOT NULL CHECK(expected_attempt=1),
 expected_claim_generation bigint NOT NULL CHECK(expected_claim_generation>0),
 worker_login name NOT NULL CHECK(worker_login='meddecode_auto_worker_login'),
 worker_instance_id text NOT NULL,
 previous_lease_expires_at timestamptz NOT NULL,
 previous_scope_expires_at timestamptz NOT NULL,
 authorized_by name NOT NULL,
 authorized_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz,
 recovered_claim_generation bigint,
 CHECK(expires_at>authorized_at AND expires_at<=authorized_at+interval '10 minutes'),
 CHECK((consumed_at IS NULL AND recovered_claim_generation IS NULL) OR
       (consumed_at IS NOT NULL AND recovered_claim_generation=expected_claim_generation+2))
);
ALTER TABLE public.meddecode_exact_job_retry_permits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meddecode_exact_job_retry_permits FROM PUBLIC,anon,authenticated,meddecode_worker,meddecode_scoped_worker,meddecode_auto_worker_login;

-- Admin authorization only: preserve job state, admissions and policy.
CREATE FUNCTION public.meddecode_authorize_exact_job_retry_v1(p_job_id uuid,p_prescription_id uuid,p_expected_attempt integer,p_expected_claim_generation bigint)
RETURNS TABLE(permit_id uuid,expires_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
#variable_conflict use_column
DECLARE w public.meddecode_auto_worker_policy%ROWTYPE; j public.ai_jobs%ROWTYPE;
 s public.meddecode_scoped_worker_scope%ROWTYPE; v_now timestamptz:=clock_timestamp(); v_exp timestamptz; v_id uuid;
BEGIN
 IF session_user IS DISTINCT FROM 'postgres' OR current_setting('role',true) NOT IN ('none','postgres') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='administrative authorization required'; END IF;
 SELECT * INTO w FROM public.meddecode_auto_worker_policy WHERE singleton FOR UPDATE;
 IF NOT FOUND OR NOT w.enabled OR w.current_rollout_generation<>2 OR w.activated_at IS NULL OR w.activated_at>v_now
 OR w.worker_login::text<>'meddecode_auto_worker_login' OR w.worker_instance_id<>'meddecode-auto-worker-001'
 OR w.scope_seconds IS NULL OR w.scope_seconds<30 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='retry policy unavailable'; END IF;
 SELECT * INTO j FROM public.ai_jobs WHERE id=p_job_id AND prescription_id=p_prescription_id FOR UPDATE;
 IF NOT FOUND OR j.status IS DISTINCT FROM 'processing' OR j.job_type IS DISTINCT FROM 'prescription_analysis'
 OR p_expected_attempt IS DISTINCT FROM 1 OR j.attempt_count IS DISTINCT FROM p_expected_attempt OR j.max_attempts IS NULL OR j.max_attempts<2
 OR p_expected_claim_generation IS NULL OR j.claim_generation IS DISTINCT FROM p_expected_claim_generation
 OR j.lease_owner IS DISTINCT FROM w.worker_instance_id OR j.lease_expires_at IS NULL OR j.lease_expires_at>v_now
 OR j.input_reference->>'processing_mode'='confirmed_review' OR j.result_reference IS NOT NULL
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='retry claim precondition failed'; END IF;
 PERFORM 1 FROM public.prescriptions p WHERE p.id=j.prescription_id AND p.user_id=j.user_id AND p.status='processing' FOR UPDATE;
 IF NOT FOUND OR (SELECT count(*) FROM public.meddecode_auto_test_account)<>1
 OR (SELECT count(*) FROM public.meddecode_auto_authorized_jobs WHERE rollout_generation=2)<>1
 OR NOT EXISTS(SELECT 1 FROM public.meddecode_auto_test_account WHERE singleton AND user_id=j.user_id)
 OR NOT EXISTS(SELECT 1 FROM public.meddecode_auto_authorized_jobs a WHERE a.job_id=j.id AND a.prescription_id=j.prescription_id AND a.user_id=j.user_id AND a.rollout_generation=w.current_rollout_generation)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='retry ownership unavailable'; END IF;
 IF EXISTS(SELECT 1 FROM public.prescription_review_revisions WHERE prescription_id=j.prescription_id)
 OR EXISTS(SELECT 1 FROM public.prescription_ocr_evidence_sets WHERE prescription_id=j.prescription_id)
 OR EXISTS(SELECT 1 FROM public.prescription_intelligence_results WHERE prescription_id=j.prescription_id)
 OR EXISTS(SELECT 1 FROM public.meddecode_exact_job_retry_permits r WHERE r.job_id=j.id)
 OR EXISTS(SELECT 1 FROM pg_stat_activity WHERE usename IN ('meddecode_auto_worker_login','meddecode_scoped_worker_login','meddecode_worker_login'))
 OR EXISTS(SELECT 1 FROM public.ai_jobs x JOIN public.meddecode_scoped_worker_scope t ON t.job_id=x.id WHERE x.id<>j.id AND x.status IN ('queued','processing') AND t.enabled AND t.expires_at>v_now AND t.worker_login=w.worker_login)
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='retry isolation precondition failed'; END IF;
 SELECT * INTO s FROM public.meddecode_scoped_worker_scope WHERE job_id=j.id FOR UPDATE;
 IF NOT FOUND OR s.prescription_id IS DISTINCT FROM j.prescription_id OR s.user_id IS DISTINCT FROM j.user_id
 OR s.worker_login IS DISTINCT FROM w.worker_login OR s.worker_instance_id IS DISTINCT FROM w.worker_instance_id OR s.expires_at>v_now
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='retry scope precondition failed'; END IF;
 v_exp:=v_now+make_interval(secs=>least(w.scope_seconds,600));
 INSERT INTO public.meddecode_exact_job_retry_permits(job_id,prescription_id,user_id,rollout_generation,expected_attempt,expected_claim_generation,worker_login,worker_instance_id,previous_lease_expires_at,previous_scope_expires_at,authorized_by,authorized_at,expires_at)
 VALUES(j.id,j.prescription_id,j.user_id,2,1,j.claim_generation,w.worker_login,w.worker_instance_id,j.lease_expires_at,s.expires_at,session_user,v_now,v_exp) RETURNING meddecode_exact_job_retry_permits.permit_id INTO v_id;
 UPDATE public.meddecode_scoped_worker_scope SET enabled=true,expires_at=v_exp WHERE job_id=j.id;
 RETURN QUERY SELECT v_id,v_exp;
END $fn$;

CREATE FUNCTION public.meddecode_recover_claim_exact_job_v1(p_permit_id uuid,p_job_id uuid,p_prescription_id uuid,p_worker_instance_id text,p_lease_seconds integer)
RETURNS TABLE(job_id uuid,user_id uuid,prescription_id uuid,attempt_count integer,claim_generation bigint,lease_expires_at timestamptz,storage_provider text,storage_bucket text,object_key text,file_type text,input_reference jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
#variable_conflict use_column
DECLARE w public.meddecode_auto_worker_policy%ROWTYPE; r public.meddecode_exact_job_retry_permits%ROWTYPE;
 j public.ai_jobs%ROWTYPE; p public.prescriptions%ROWTYPE; v_now timestamptz:=clock_timestamp();
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'meddecode_scoped_worker' OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 300 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='exact retry worker required'; END IF;
 SELECT * INTO w FROM public.meddecode_auto_worker_policy WHERE singleton FOR UPDATE;
 IF NOT FOUND OR NOT w.enabled OR w.current_rollout_generation<>2 OR w.activated_at IS NULL OR w.activated_at>v_now
 OR session_user IS DISTINCT FROM w.worker_login::text OR p_worker_instance_id IS DISTINCT FROM w.worker_instance_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='retry policy unavailable'; END IF;
 SELECT * INTO r FROM public.meddecode_exact_job_retry_permits WHERE permit_id=p_permit_id AND job_id=p_job_id AND prescription_id=p_prescription_id FOR UPDATE;
 IF NOT FOUND OR r.consumed_at IS NOT NULL OR r.expires_at<=v_now OR r.rollout_generation<>w.current_rollout_generation OR r.worker_login::text<>session_user OR r.worker_instance_id<>p_worker_instance_id THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='retry permit unavailable'; END IF;
 SELECT * INTO j FROM public.ai_jobs WHERE id=p_job_id AND prescription_id=p_prescription_id FOR UPDATE;
 v_now:=clock_timestamp();
 IF NOT FOUND OR j.user_id IS DISTINCT FROM r.user_id OR j.status IS DISTINCT FROM 'processing' OR j.job_type IS DISTINCT FROM 'prescription_analysis'
 OR j.attempt_count IS DISTINCT FROM r.expected_attempt OR j.claim_generation IS DISTINCT FROM r.expected_claim_generation
 OR j.max_attempts IS NULL OR j.max_attempts<2 OR j.lease_owner IS DISTINCT FROM p_worker_instance_id OR j.lease_expires_at IS DISTINCT FROM r.previous_lease_expires_at OR j.lease_expires_at>v_now OR r.expires_at<=v_now+make_interval(secs=>p_lease_seconds)
 OR j.input_reference->>'processing_mode'='confirmed_review' OR j.result_reference IS NOT NULL
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='retry claim precondition failed'; END IF;
 SELECT * INTO p FROM public.prescriptions WHERE id=p_prescription_id AND user_id=j.user_id AND status='processing' AND storage_provider='aws_s3' AND nullif(btrim(storage_bucket),'') IS NOT NULL AND nullif(btrim(object_key),'') IS NOT NULL AND file_type IN ('application/pdf','image/jpeg','image/png') FOR UPDATE;
 IF NOT FOUND OR (SELECT count(*) FROM public.meddecode_auto_test_account)<>1 OR NOT EXISTS(SELECT 1 FROM public.meddecode_auto_test_account WHERE singleton AND user_id=j.user_id)
 OR (SELECT count(*) FROM public.meddecode_auto_authorized_jobs WHERE rollout_generation=2)<>1
 OR NOT EXISTS(SELECT 1 FROM public.meddecode_auto_authorized_jobs a WHERE a.job_id=j.id AND a.prescription_id=j.prescription_id AND a.user_id=j.user_id AND a.rollout_generation=2)
 OR NOT EXISTS(SELECT 1 FROM public.meddecode_scoped_worker_scope s WHERE s.job_id=j.id AND s.prescription_id=j.prescription_id AND s.user_id=j.user_id AND s.worker_login=session_user AND s.worker_instance_id=p_worker_instance_id AND s.enabled AND s.expires_at>v_now AND s.expires_at>=r.expires_at)
 THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='retry lineage unavailable'; END IF;
 IF EXISTS(SELECT 1 FROM public.prescription_review_revisions WHERE prescription_id=j.prescription_id)
 OR EXISTS(SELECT 1 FROM public.prescription_ocr_evidence_sets WHERE prescription_id=j.prescription_id)
 OR EXISTS(SELECT 1 FROM public.prescription_intelligence_results WHERE prescription_id=j.prescription_id)
 OR EXISTS(SELECT 1 FROM public.ai_jobs x JOIN public.meddecode_scoped_worker_scope s ON s.job_id=x.id WHERE x.id<>j.id AND x.status IN ('queued','processing') AND s.enabled AND s.expires_at>v_now AND s.worker_login=session_user)
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='retry isolation precondition failed'; END IF;
 -- Preserve attempt 1; recovery and the new claim each advance the fence.
 UPDATE public.ai_jobs SET attempt_count=2,claim_generation=j.claim_generation+2,lease_owner=p_worker_instance_id,
 lease_expires_at=least(v_now+make_interval(secs=>p_lease_seconds),r.expires_at),heartbeat_at=v_now,
 available_at=v_now,completed_at=NULL,error_message=NULL WHERE id=j.id RETURNING * INTO j;
 UPDATE public.meddecode_exact_job_retry_permits SET consumed_at=v_now,recovered_claim_generation=j.claim_generation WHERE permit_id=r.permit_id;
 RETURN QUERY SELECT j.id,j.user_id,j.prescription_id,j.attempt_count,j.claim_generation,j.lease_expires_at,p.storage_provider,p.storage_bucket,p.object_key,p.file_type,j.input_reference;
END $fn$;

CREATE OR REPLACE FUNCTION public.meddecode_initialize_retry_review_core_v1(
  p_job_id uuid,p_prescription_id uuid,p_evidence jsonb,p_review jsonb,p_medicines jsonb,p_event jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE v_role text:=current_setting('role',true); v_user uuid; v_evidence_id uuid; v_revision_id uuid; v_existing jsonb;
BEGIN
  IF v_role IS DISTINCT FROM 'meddecode_scoped_worker' THEN RAISE EXCEPTION 'review_forbidden'; END IF;
  SELECT j.user_id INTO v_user FROM public.ai_jobs j JOIN public.prescriptions p ON p.id=j.prescription_id AND p.user_id=j.user_id
    WHERE j.id=p_job_id AND j.prescription_id=p_prescription_id AND j.status='processing' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'review_not_found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.meddecode_scoped_worker_scope s WHERE s.job_id=p_job_id AND s.prescription_id=p_prescription_id AND s.user_id=v_user AND s.worker_login=session_user AND s.enabled AND s.expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'review_forbidden'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.meddecode_auto_authorized_jobs a JOIN public.meddecode_auto_worker_policy w ON w.singleton
    WHERE a.job_id=p_job_id AND a.prescription_id=p_prescription_id AND a.user_id=v_user AND a.rollout_generation=w.current_rollout_generation) THEN RAISE EXCEPTION 'review_forbidden'; END IF;
  SELECT review_json INTO v_existing FROM public.prescription_review_revisions WHERE prescription_id=p_prescription_id AND is_current;
  IF FOUND THEN RETURN v_existing; END IF;
  v_evidence_id:=(p_evidence->>'evidenceSetId')::uuid; v_revision_id:=(p_review->>'revisionId')::uuid;
  IF p_review->>'status'<>'draft' OR (p_review->>'revisionNumber')::integer<>1 OR (p_review->>'lockVersion')::bigint<>0 OR (p_review->>'prescriptionId')::uuid<>p_prescription_id OR pg_column_size(p_evidence)>1048576 THEN RAISE EXCEPTION 'review_conflict'; END IF;
  INSERT INTO public.prescription_ocr_evidence_sets(id,prescription_id,user_id,initial_processing_job_id,schema_version,document_sha256,page_count,provider_count,evidence_payload)
  VALUES(v_evidence_id,p_prescription_id,v_user,p_job_id,p_evidence->>'schemaVersion',nullif(p_evidence->>'documentSha256',''),NULLIF(p_evidence->>'pageCount','')::integer,COALESCE((p_evidence->>'providerCount')::integer,0),COALESCE(p_evidence->'payload','{}'::jsonb));
  INSERT INTO public.prescription_review_revisions(id,prescription_id,user_id,evidence_set_id,revision_number,status,lock_version,review_schema_version,review_json)
  VALUES(v_revision_id,p_prescription_id,v_user,v_evidence_id,1,'draft',0,'1.0',p_review);
  PERFORM public.meddecode_review_write_medicines_v1(v_revision_id,p_prescription_id,p_medicines);
  PERFORM public.meddecode_review_append_event_v1(v_user,p_prescription_id,v_revision_id,p_event);
  RETURN p_review;
END $fn$;
CREATE OR REPLACE FUNCTION public.meddecode_initialize_prescription_review_v1(
  p_job_id uuid,p_prescription_id uuid,p_evidence jsonb,p_review jsonb,p_medicines jsonb,p_event jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE v_role text:=current_setting('role',true); v_user uuid; v_evidence_id uuid; v_revision_id uuid; v_existing jsonb;
BEGIN
  IF v_role IS DISTINCT FROM 'meddecode_scoped_worker' THEN RAISE EXCEPTION 'review_forbidden'; END IF;
  SELECT j.user_id INTO v_user FROM public.ai_jobs j JOIN public.prescriptions p ON p.id=j.prescription_id AND p.user_id=j.user_id
    WHERE j.id=p_job_id AND j.prescription_id=p_prescription_id AND j.status='processing' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'review_not_found'; END IF;
  IF EXISTS (SELECT 1 FROM public.meddecode_exact_job_retry_permits WHERE job_id=p_job_id) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='exact retry initializer required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.meddecode_scoped_worker_scope s WHERE s.job_id=p_job_id AND s.prescription_id=p_prescription_id AND s.user_id=v_user AND s.worker_login=session_user AND s.enabled AND s.expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'review_forbidden'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.meddecode_auto_authorized_jobs a JOIN public.meddecode_auto_worker_policy w ON w.singleton
    WHERE a.job_id=p_job_id AND a.prescription_id=p_prescription_id AND a.user_id=v_user AND a.rollout_generation=w.current_rollout_generation) THEN RAISE EXCEPTION 'review_forbidden'; END IF;
  SELECT review_json INTO v_existing FROM public.prescription_review_revisions WHERE prescription_id=p_prescription_id AND is_current;
  IF FOUND THEN RETURN v_existing; END IF;
  v_evidence_id:=(p_evidence->>'evidenceSetId')::uuid; v_revision_id:=(p_review->>'revisionId')::uuid;
  IF p_review->>'status'<>'draft' OR (p_review->>'revisionNumber')::integer<>1 OR (p_review->>'lockVersion')::bigint<>0 OR (p_review->>'prescriptionId')::uuid<>p_prescription_id OR pg_column_size(p_evidence)>1048576 THEN RAISE EXCEPTION 'review_conflict'; END IF;
  INSERT INTO public.prescription_ocr_evidence_sets(id,prescription_id,user_id,initial_processing_job_id,schema_version,document_sha256,page_count,provider_count,evidence_payload)
  VALUES(v_evidence_id,p_prescription_id,v_user,p_job_id,p_evidence->>'schemaVersion',nullif(p_evidence->>'documentSha256',''),NULLIF(p_evidence->>'pageCount','')::integer,COALESCE((p_evidence->>'providerCount')::integer,0),COALESCE(p_evidence->'payload','{}'::jsonb));
  INSERT INTO public.prescription_review_revisions(id,prescription_id,user_id,evidence_set_id,revision_number,status,lock_version,review_schema_version,review_json)
  VALUES(v_revision_id,p_prescription_id,v_user,v_evidence_id,1,'draft',0,'1.0',p_review);
  PERFORM public.meddecode_review_write_medicines_v1(v_revision_id,p_prescription_id,p_medicines);
  PERFORM public.meddecode_review_append_event_v1(v_user,p_prescription_id,v_revision_id,p_event);
  RETURN p_review;
END $fn$;
CREATE OR REPLACE FUNCTION public.meddecode_scoped_claim_next_prescription_analysis_job_v1(
  p_worker_instance_id text, p_lease_seconds integer DEFAULT 120
)
RETURNS TABLE (
  job_id uuid, user_id uuid, prescription_id uuid, attempt_count integer,
  claim_generation bigint, lease_expires_at timestamptz,
  storage_provider text, storage_bucket text, object_key text, file_type text,
  input_reference jsonb
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
#variable_conflict use_column
DECLARE
  v_job public.ai_jobs%ROWTYPE;
  v_prescription public.prescriptions%ROWTYPE;
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'meddecode_scoped_worker' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'worker authorization required';
  END IF;
  IF p_worker_instance_id IS NULL
     OR length(btrim(p_worker_instance_id)) NOT BETWEEN 8 AND 128
     OR p_worker_instance_id !~ '^[A-Za-z0-9._:-]+$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid worker instance';
  END IF;
  IF p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 300 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid lease duration';
  END IF;

  SELECT j.* INTO v_job
  FROM public.ai_jobs AS j
  JOIN public.prescriptions AS candidate_prescription
    ON candidate_prescription.id = j.prescription_id
   AND candidate_prescription.user_id = j.user_id
   AND candidate_prescription.status = 'queued'
   AND candidate_prescription.storage_provider = 'aws_s3'
   AND nullif(btrim(candidate_prescription.storage_bucket), '') IS NOT NULL
   AND nullif(btrim(candidate_prescription.object_key), '') IS NOT NULL
  JOIN public.meddecode_scoped_worker_scope AS scope ON scope.job_id = j.id
    AND scope.prescription_id = j.prescription_id AND scope.user_id = j.user_id
    AND scope.worker_login = session_user AND scope.worker_instance_id = p_worker_instance_id AND scope.enabled
    AND scope.expires_at > clock_timestamp()
  WHERE NOT EXISTS (SELECT 1 FROM public.meddecode_exact_job_retry_permits r WHERE r.job_id=j.id) AND j.job_type = 'prescription_analysis' AND j.status = 'queued'
    AND j.available_at <= clock_timestamp() AND j.attempt_count < j.max_attempts
  ORDER BY j.available_at, j.created_at, j.id
  FOR UPDATE OF j, scope SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT p.* INTO STRICT v_prescription
  FROM public.prescriptions AS p
  WHERE p.id = v_job.prescription_id AND p.user_id = v_job.user_id
    AND p.status = 'queued' AND p.storage_provider = 'aws_s3'
    AND nullif(btrim(p.storage_bucket), '') IS NOT NULL
    AND nullif(btrim(p.object_key), '') IS NOT NULL
  FOR UPDATE;

  IF NOT EXISTS (SELECT 1 FROM public.meddecode_scoped_worker_scope AS scope
    WHERE scope.job_id = v_job.id AND scope.worker_login = session_user AND scope.worker_instance_id = p_worker_instance_id
      AND scope.enabled AND scope.expires_at > clock_timestamp()) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'scoped worker authorization required';
  END IF;
  UPDATE public.ai_jobs AS j
  SET status = 'processing', attempt_count = j.attempt_count + 1,
      claim_generation = j.claim_generation + 1,
      lease_owner = p_worker_instance_id,
      lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
      heartbeat_at = clock_timestamp(),
      started_at = coalesce(j.started_at, clock_timestamp()), completed_at = NULL
  WHERE j.id = v_job.id RETURNING j.* INTO v_job;

  UPDATE public.prescriptions AS p SET status = 'processing'
  WHERE p.id = v_job.prescription_id AND p.user_id = v_job.user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'prescription disappeared during claim'; END IF;

  RETURN QUERY SELECT v_job.id, v_job.user_id, v_job.prescription_id,
    v_job.attempt_count, v_job.claim_generation, v_job.lease_expires_at,
    v_prescription.storage_provider, v_prescription.storage_bucket,
    v_prescription.object_key, v_prescription.file_type, v_job.input_reference;
END
$function$;
CREATE OR REPLACE FUNCTION public.meddecode_scoped_recover_expired_prescription_analysis_jobs_v1(p_limit integer DEFAULT 50)
RETURNS TABLE (job_id uuid, prescription_id uuid, job_status text, terminal boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
#variable_conflict use_column
DECLARE
  v_job public.ai_jobs%ROWTYPE;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'meddecode_scoped_worker' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'worker authorization required';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'recovery limit is invalid';
  END IF;
  FOR v_job IN SELECT j.* FROM public.ai_jobs AS j
    JOIN public.meddecode_scoped_worker_scope AS scope ON scope.job_id = j.id
      AND scope.prescription_id = j.prescription_id AND scope.user_id = j.user_id
      AND scope.worker_login = session_user AND scope.worker_instance_id = j.lease_owner AND scope.enabled AND scope.expires_at > clock_timestamp()
    WHERE NOT EXISTS (SELECT 1 FROM public.meddecode_exact_job_retry_permits r WHERE r.job_id=j.id) AND j.job_type = 'prescription_analysis' AND j.status = 'processing'
      AND j.lease_expires_at IS NOT NULL AND j.lease_expires_at <= v_now
    ORDER BY j.lease_expires_at, j.id FOR UPDATE OF j, scope SKIP LOCKED LIMIT p_limit
  LOOP
    IF EXISTS (SELECT 1 FROM public.prescription_intelligence_results AS r WHERE r.prescription_id = v_job.prescription_id) THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'expired job has a persisted result';
    END IF;
    PERFORM 1 FROM public.prescriptions AS p
      WHERE p.id = v_job.prescription_id AND p.user_id = v_job.user_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'job lineage invalid'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.meddecode_scoped_worker_scope AS scope
    WHERE scope.job_id = v_job.id AND scope.worker_login = session_user AND scope.worker_instance_id = v_job.lease_owner
      AND scope.enabled AND scope.expires_at > clock_timestamp()) THEN
    CONTINUE;
  END IF;
    IF v_job.attempt_count < v_job.max_attempts THEN
      UPDATE public.ai_jobs AS j SET status = 'queued', available_at = v_now,
        lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
        claim_generation = j.claim_generation + 1, error_message = 'LEASE_EXPIRED',
        completed_at = NULL, result_reference = NULL WHERE j.id = v_job.id;
      UPDATE public.prescriptions AS p SET status = 'queued'
        WHERE p.id = v_job.prescription_id AND p.user_id = v_job.user_id;
      RETURN QUERY SELECT v_job.id, v_job.prescription_id, 'queued'::text, false;
    ELSE
      UPDATE public.ai_jobs AS j SET status = 'failed', available_at = v_now,
        lease_owner = NULL, lease_expires_at = NULL, heartbeat_at = NULL,
        claim_generation = j.claim_generation + 1, error_message = 'LEASE_EXPIRED_MAX_ATTEMPTS',
        completed_at = v_now,
        result_reference = jsonb_build_object('terminal_failure_code', 'LEASE_EXPIRED_MAX_ATTEMPTS',
          'claim_generation', j.claim_generation + 1) WHERE j.id = v_job.id;
      UPDATE public.prescriptions AS p SET status = 'failed'
        WHERE p.id = v_job.prescription_id AND p.user_id = v_job.user_id;
      RETURN QUERY SELECT v_job.id, v_job.prescription_id, 'failed'::text, true;
    END IF;
  END LOOP;
END
$function$;
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
 WHERE NOT EXISTS(SELECT 1 FROM public.meddecode_exact_job_retry_permits r WHERE r.job_id=j.id) AND a.rollout_generation=v_policy.current_rollout_generation AND j.job_type='prescription_analysis' AND ((j.status='processing' AND p.status='processing' AND j.lease_owner=v_policy.worker_instance_id) OR (j.status='queued' AND p.status='queued' AND j.attempt_count<j.max_attempts))
 ORDER BY CASE WHEN j.status='processing' THEN 0 ELSE 1 END,j.created_at,j.id LIMIT 1 FOR UPDATE OF j SKIP LOCKED;
 IF NOT FOUND THEN RETURN QUERY SELECT false; RETURN; END IF;
 PERFORM 1 FROM public.meddecode_auto_test_account WHERE singleton AND user_id=v_job.user_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='automatic test authorization unavailable'; END IF;
 INSERT INTO public.meddecode_scoped_worker_scope(job_id,prescription_id,user_id,worker_login,worker_instance_id,enabled,expires_at) VALUES(v_job.id,v_job.prescription_id,v_job.user_id,v_policy.worker_login,v_policy.worker_instance_id,true,clock_timestamp()+make_interval(secs=>v_policy.scope_seconds)) ON CONFLICT(job_id) DO UPDATE SET enabled=true,expires_at=EXCLUDED.expires_at WHERE public.meddecode_scoped_worker_scope.prescription_id=EXCLUDED.prescription_id AND public.meddecode_scoped_worker_scope.user_id=EXCLUDED.user_id AND public.meddecode_scoped_worker_scope.worker_login=EXCLUDED.worker_login AND public.meddecode_scoped_worker_scope.worker_instance_id=EXCLUDED.worker_instance_id;
 IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='existing scope identity conflict'; END IF;
 RETURN QUERY SELECT true;
END $fn$;

CREATE FUNCTION public.meddecode_initialize_exact_retry_review_v1(p_job_id uuid,p_prescription_id uuid,p_evidence jsonb,p_review jsonb,p_medicines jsonb,p_event jsonb,p_worker_instance_id text,p_attempt_count integer,p_claim_generation bigint,p_permit_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
#variable_conflict use_column
DECLARE j public.ai_jobs%ROWTYPE; r public.meddecode_exact_job_retry_permits%ROWTYPE;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'meddecode_scoped_worker' THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='exact retry worker required'; END IF;
 SELECT * INTO j FROM public.ai_jobs WHERE id=p_job_id AND prescription_id=p_prescription_id FOR UPDATE;
 SELECT * INTO r FROM public.meddecode_exact_job_retry_permits WHERE permit_id=p_permit_id AND job_id=p_job_id AND prescription_id=p_prescription_id;
 IF j.id IS NULL OR r.permit_id IS NULL OR r.consumed_at IS NULL OR r.expires_at<=clock_timestamp()
 OR r.user_id IS DISTINCT FROM j.user_id OR r.worker_login::text IS DISTINCT FROM session_user OR r.worker_instance_id IS DISTINCT FROM p_worker_instance_id
 OR p_attempt_count IS DISTINCT FROM 2 OR j.attempt_count IS DISTINCT FROM p_attempt_count OR j.claim_generation IS DISTINCT FROM p_claim_generation
 OR r.recovered_claim_generation IS DISTINCT FROM p_claim_generation OR j.status IS DISTINCT FROM 'processing'
 OR j.lease_owner IS DISTINCT FROM p_worker_instance_id OR j.lease_expires_at IS NULL OR j.lease_expires_at<=clock_timestamp()
 OR NOT EXISTS(SELECT 1 FROM public.meddecode_auto_worker_policy WHERE singleton AND enabled AND current_rollout_generation=r.rollout_generation AND worker_login=session_user AND worker_instance_id=p_worker_instance_id AND activated_at<=clock_timestamp())
 OR NOT EXISTS(SELECT 1 FROM public.meddecode_auto_test_account WHERE singleton AND user_id=j.user_id)
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='stale or expired worker claim'; END IF;
 RETURN public.meddecode_initialize_retry_review_core_v1(p_job_id,p_prescription_id,p_evidence,p_review,p_medicines,p_event);
END $fn$;
REVOKE ALL ON FUNCTION public.meddecode_authorize_exact_job_retry_v1(uuid,uuid,integer,bigint) FROM PUBLIC,anon,authenticated,meddecode_worker,meddecode_scoped_worker,meddecode_auto_worker_login;
REVOKE ALL ON FUNCTION public.meddecode_initialize_retry_review_core_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated,meddecode_worker,meddecode_scoped_worker,meddecode_auto_worker_login;
REVOKE ALL ON FUNCTION public.meddecode_recover_claim_exact_job_v1(uuid,uuid,uuid,text,integer),public.meddecode_initialize_exact_retry_review_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb,text,integer,bigint,uuid) FROM PUBLIC,anon,authenticated,meddecode_worker,meddecode_auto_worker_login;
GRANT EXECUTE ON FUNCTION public.meddecode_recover_claim_exact_job_v1(uuid,uuid,uuid,text,integer),public.meddecode_initialize_exact_retry_review_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb,text,integer,bigint,uuid) TO meddecode_scoped_worker;
-- Supabase may apply owner-specific default ACLs. Remove unexpected grants
-- on these NEW objects only; never change global roles or default privileges.
DO $acl$
DECLARE a record;
BEGIN
 FOR a IN SELECT DISTINCT r.rolname FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) x JOIN pg_roles r ON r.oid=x.grantee
 WHERE c.oid='public.meddecode_exact_job_retry_permits'::regclass AND x.grantee<>c.relowner LOOP
   EXECUTE format('REVOKE ALL ON public.meddecode_exact_job_retry_permits FROM %I',a.rolname);
 END LOOP;
 FOR a IN SELECT DISTINCT p.oid::regprocedure AS signature,r.rolname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x JOIN pg_roles r ON r.oid=x.grantee
 WHERE n.nspname='public' AND p.proname IN ('meddecode_authorize_exact_job_retry_v1','meddecode_initialize_retry_review_core_v1','meddecode_recover_claim_exact_job_v1','meddecode_initialize_exact_retry_review_v1') AND x.grantee<>p.proowner
 AND NOT (p.proname IN ('meddecode_recover_claim_exact_job_v1','meddecode_initialize_exact_retry_review_v1') AND r.rolname='meddecode_scoped_worker') LOOP
   EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',a.signature,a.rolname);
 END LOOP;
END $acl$;
COMMIT;
