\set ON_ERROR_STOP on
-- Synthetic data only; the whole additional round trip is rolled back.
BEGIN;
INSERT INTO public.prescriptions(id,user_id,storage_provider,storage_bucket,object_key,file_type,status)
VALUES ('89000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001',
  'aws_s3','local-test-bucket','synthetic/roundtrip.pdf','application/pdf','processing');
INSERT INTO public.ai_jobs(id,user_id,prescription_id,job_type,status,attempt_count,max_attempts,
  available_at,lease_owner,lease_expires_at,heartbeat_at,claim_generation)
VALUES ('79000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001',
  '89000000-0000-4000-8000-000000000002','prescription_analysis','processing',1,3,
  clock_timestamp(),'worker-roundtrip-001',clock_timestamp()+interval '5 minutes',clock_timestamp(),1);
SELECT jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(
  result_json,'{job_id}','"79000000-0000-4000-8000-000000000002"'),
  '{prescription_id}','"89000000-0000-4000-8000-000000000002"'),
  '{status}','"completed_with_warnings"'),
  '{medicines,0,extraction,strength}','{"value":10,"unit":"mg"}'),
  '{medicines,0,extraction,instructions}','"Synthetic instructions"',true),
  '{recommendations}','[{"type":"information","title":"Synthetic","message":"Fixture only","related_medicine_sequence_number":1,"confidence":0.8}]'),
  '{warnings}','[{"code":"SYNTHETIC","severity":"info","message":"Fixture only","related_medicine_sequence_number":1}]')::text AS payload
FROM public.prescription_intelligence_results
WHERE prescription_id='90000000-0000-4000-8000-000000000001' \gset rt_
SET LOCAL ROLE meddecode_worker;
SELECT * FROM public.complete_prescription_analysis_job_v1(
 '79000000-0000-4000-8000-000000000002','89000000-0000-4000-8000-000000000002',
 'worker-roundtrip-001',1,:'rt_payload'::jsonb);
RESET ROLE;
SELECT 1 / CASE WHEN
 (SELECT status='completed' FROM public.ai_jobs WHERE id='79000000-0000-4000-8000-000000000002')
 AND (SELECT status='completed_with_warnings' AND intelligence_dataset_version='synthetic-dataset' FROM public.prescriptions WHERE id='89000000-0000-4000-8000-000000000002')
 AND (SELECT result_json=:'rt_payload'::jsonb FROM public.prescription_intelligence_results WHERE prescription_id='89000000-0000-4000-8000-000000000002')
 AND (SELECT strength_value=10 AND strength_unit='mg' AND instructions='Synthetic instructions' AND medicine_external_id='synthetic-source:A' FROM public.prescription_medicines WHERE prescription_id='89000000-0000-4000-8000-000000000002' AND sequence_number=1)
 AND (SELECT count(*)=1 FROM public.prescription_recommendations WHERE prescription_id='89000000-0000-4000-8000-000000000002' AND related_medicine_sequence_number=1 AND message='Fixture only')
 AND (SELECT count(*)=1 FROM public.prescription_warnings WHERE prescription_id='89000000-0000-4000-8000-000000000002' AND related_medicine_sequence_number=1 AND code='SYNTHETIC')
 THEN 1 ELSE 0 END AS contract_roundtrip_assertion;
ROLLBACK;
