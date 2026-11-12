\set ON_ERROR_STOP on

-- Runtime assertions for a separately approved disposable-local execution.
-- No real document, patient record, or hosted connection is involved.
INSERT INTO public.prescriptions (id, user_id, storage_provider, storage_bucket, object_key, file_type, status)
VALUES ('90000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001',
  'aws_s3', 'local-test-bucket', 'private/prescriptions/finalization/source.pdf', 'application/pdf', 'uploaded');

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', false);
SELECT * FROM public.submit_prescription_analysis_job_v1(
  '90000000-0000-4000-8000-000000000001',
  '{"extract_prescription":true,"match_medicines":true,"find_alternatives":false,"generate_recommendations":true}'::jsonb
);
RESET ROLE;

SET ROLE meddecode_worker;
SELECT * FROM public.claim_next_prescription_analysis_job_v1('worker-finalize-001', 120)
\gset final_claim_
SELECT * FROM public.complete_prescription_analysis_job_v1(
  :'final_claim_job_id'::uuid, '90000000-0000-4000-8000-000000000001',
  'worker-finalize-001', :'final_claim_claim_generation'::bigint,
  jsonb_build_object(
    'schema_version', '1.0', 'job_id', :'final_claim_job_id',
    'prescription_id', '90000000-0000-4000-8000-000000000001', 'status', 'completed',
    'prescription', jsonb_build_object('prescription_date', null, 'doctor', jsonb_build_object('name', null, 'registration_number', null), 'facility', jsonb_build_object('name', null, 'address', null, 'phone', null)),
    'patient', jsonb_build_object('name', null, 'age', null, 'gender', null),
    'medicines', '[]'::jsonb, 'recommendations', '[]'::jsonb, 'warnings', '[]'::jsonb,
    'processing_metadata', jsonb_build_object('overall_confidence', null)
  )
);
RESET ROLE;

-- Keep psql variables outside a dollar-quoted DO body: psql deliberately does
-- not interpolate variables inside SQL string literals. Division-by-zero makes
-- a failed assertion stop this ON_ERROR_STOP harness with a non-zero exit.
SELECT 1 / CASE WHEN
  (SELECT status FROM public.ai_jobs WHERE id = :'final_claim_job_id'::uuid) = 'completed'
  AND (SELECT status FROM public.prescriptions WHERE id = '90000000-0000-4000-8000-000000000001') = 'completed'
  AND (SELECT count(*) FROM public.prescription_intelligence_results WHERE job_id = :'final_claim_job_id'::uuid) = 1
  THEN 1 ELSE 0 END AS completion_atomicity_assertion;
