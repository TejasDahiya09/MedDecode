-- Execute only inside an isolated transaction that will be rolled back.
DO $test$
DECLARE
  owner_id constant uuid := 'ed000000-0000-4000-8000-000000000001';
  other_id constant uuid := 'ed000000-0000-4000-8000-000000000002';
  prescription_id constant uuid := 'ed000000-0000-4000-8000-000000000003';
  first_job uuid;
  second_job uuid;
  item record;
  req jsonb := '{"extract_prescription":true,"match_medicines":true,"find_alternatives":false,"generate_recommendations":true}';
BEGIN
  INSERT INTO public.users(id) VALUES(owner_id),(other_id);
  INSERT INTO public.prescriptions(id,user_id,storage_provider,storage_bucket,object_key,status)
    VALUES(prescription_id,owner_id,'aws_s3','fictional-bucket','private/prescriptions/fictional/source.pdf','uploaded');
  PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);
  SELECT * INTO item FROM public.submit_prescription_analysis_job_v1(prescription_id,req);
  first_job := item.job_id;
  IF NOT item.created THEN RAISE EXCEPTION 'initial submit did not create job'; END IF;
  PERFORM set_config('role','authenticated',true);
  PERFORM set_config('request.jwt.claim.sub',other_id::text,true);
  BEGIN
    PERFORM public.cancel_prescription_analysis_job_v1(prescription_id,first_job);
    RAISE EXCEPTION 'cross-owner cancellation accepted';
  EXCEPTION WHEN no_data_found THEN NULL;
  END;
  PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);
  SELECT * INTO item FROM public.cancel_prescription_analysis_job_v1(prescription_id,first_job);
  IF item.already_cancelled OR item.job_status<>'cancelled' THEN RAISE EXCEPTION 'first cancellation failed'; END IF;
  BEGIN
    PERFORM 1 FROM public.prescription_job_cancellations;
    RAISE EXCEPTION 'audit table is directly readable';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM set_config('role','none',true);
  PERFORM set_config('role','anon',true);
  BEGIN
    PERFORM public.cancel_prescription_analysis_job_v1(prescription_id,first_job);
    RAISE EXCEPTION 'anonymous cancellation accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM set_config('role','none',true);
  IF NOT EXISTS(SELECT 1 FROM public.prescription_job_cancellations c
    WHERE c.job_id=first_job AND c.cancelled_by=owner_id AND c.reason='owner_requested')
    OR NOT EXISTS(SELECT 1 FROM public.prescriptions p WHERE p.id=prescription_id AND p.status='uploaded'
      AND p.object_key='private/prescriptions/fictional/source.pdf') THEN
    RAISE EXCEPTION 'cancellation evidence or prescription was not preserved';
  END IF;
  SELECT * INTO item FROM public.submit_prescription_analysis_job_v1(prescription_id,req);
  second_job := item.job_id;
  IF NOT item.created OR second_job=first_job THEN RAISE EXCEPTION 'resubmission did not create a new job'; END IF;
  SELECT * INTO item FROM public.cancel_prescription_analysis_job_v1(prescription_id,first_job);
  IF NOT item.already_cancelled OR (SELECT j.status FROM public.ai_jobs j WHERE j.id=second_job)<>'queued' THEN
    RAISE EXCEPTION 'duplicate cancellation affected new job';
  END IF;
  UPDATE public.ai_jobs j SET status='processing',lease_owner='test-worker',claim_generation=1,
    lease_expires_at=clock_timestamp()+interval '1 minute',heartbeat_at=clock_timestamp(),attempt_count=1 WHERE j.id=second_job;
  UPDATE public.prescriptions p SET status='processing' WHERE p.id=prescription_id;
  BEGIN
    PERFORM public.cancel_prescription_analysis_job_v1(prescription_id,second_job);
    RAISE EXCEPTION 'processing cancellation accepted';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
  RAISE NOTICE 'CANCELLATION_BEHAVIOR_OK';
END
$test$;
