\set ON_ERROR_STOP on
-- Disposable synthetic fixture. No existing application data is used.
INSERT INTO public.prescriptions(id,user_id,storage_provider,storage_bucket,object_key,file_type,status)
VALUES ('89000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
  'aws_s3','local-test-bucket','synthetic/rollback.pdf','application/pdf','processing');
INSERT INTO public.ai_jobs(id,user_id,prescription_id,job_type,status,attempt_count,max_attempts,
  available_at,lease_owner,lease_expires_at,heartbeat_at,claim_generation)
VALUES ('79000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
  '89000000-0000-4000-8000-000000000001','prescription_analysis','processing',1,3,
  clock_timestamp(),'worker-rollback-001',clock_timestamp()+interval '5 minutes',clock_timestamp(),1);
SET ROLE meddecode_worker;
DO $test$
BEGIN
  BEGIN
    PERFORM public.complete_prescription_analysis_job_v1(
      '79000000-0000-4000-8000-000000000001','89000000-0000-4000-8000-000000000001',
      'worker-rollback-001',1,jsonb_build_object(
        'schema_version','1.0','job_id','79000000-0000-4000-8000-000000000001',
        'prescription_id','89000000-0000-4000-8000-000000000001','status','completed',
        'prescription','{}'::jsonb,'patient','{}'::jsonb,
        'medicines',jsonb_build_array(jsonb_build_object('sequence_number',1,
          'extraction',jsonb_build_object('raw_text','Synthetic medicine','frequency',jsonb_build_object('type','unknown')),
          'medicine_match',jsonb_build_object('status','unmatched'),'alternatives','[]'::jsonb)),
        'recommendations','[]'::jsonb,
        'warnings',jsonb_build_array(jsonb_build_object('code','SYNTHETIC','severity','info','message','Synthetic only','related_medicine_sequence_number',999)),
        'processing_metadata','{}'::jsonb));
    RAISE EXCEPTION 'invalid projection unexpectedly completed';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
END
$test$;
RESET ROLE;
SELECT 1 / CASE WHEN
  (SELECT status='processing' FROM public.ai_jobs WHERE id='79000000-0000-4000-8000-000000000001')
  AND (SELECT status='processing' FROM public.prescriptions WHERE id='89000000-0000-4000-8000-000000000001')
  AND NOT EXISTS (SELECT 1 FROM public.prescription_intelligence_results WHERE prescription_id='89000000-0000-4000-8000-000000000001')
  AND NOT EXISTS (SELECT 1 FROM public.prescription_medicines WHERE prescription_id='89000000-0000-4000-8000-000000000001')
  AND NOT EXISTS (SELECT 1 FROM public.prescription_warnings WHERE prescription_id='89000000-0000-4000-8000-000000000001')
  THEN 1 ELSE 0 END AS atomic_rollback_assertion;
