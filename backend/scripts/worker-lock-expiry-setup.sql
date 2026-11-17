\set ON_ERROR_STOP on
-- Synthetic local-only fixture. No real prescription data.
INSERT INTO public.prescriptions(id,user_id,storage_provider,storage_bucket,object_key,file_type,status)
VALUES ('88000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
  'aws_s3','local-test-bucket','synthetic/lock-wait.pdf','application/pdf','processing');
INSERT INTO public.ai_jobs(id,user_id,prescription_id,job_type,status,attempt_count,max_attempts,
  available_at,lease_owner,lease_expires_at,heartbeat_at,claim_generation)
VALUES ('78000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
  '88000000-0000-4000-8000-000000000001','prescription_analysis','processing',1,3,
  clock_timestamp(),'worker-lock-wait-001',clock_timestamp()+interval '5 minutes',clock_timestamp(),1);
