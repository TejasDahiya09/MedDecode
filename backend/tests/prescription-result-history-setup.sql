\set ON_ERROR_STOP on
GRANT USAGE ON SCHEMA public TO meddecode_scoped_worker;
INSERT INTO public.users(id) VALUES('81000000-0000-4000-8000-000000000001');
INSERT INTO public.prescriptions(id,user_id,storage_provider,object_key,status)
VALUES('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','aws_s3','private/test.pdf','processing');
INSERT INTO public.ai_jobs(id,user_id,prescription_id,job_type,status,lease_owner,lease_expires_at,heartbeat_at,started_at,claim_generation,attempt_count)
VALUES('83000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','prescription_analysis','processing','phase1d2-worker',clock_timestamp()+interval '10 minutes',clock_timestamp(),clock_timestamp(),1,1);
INSERT INTO public.prescription_ocr_evidence_sets(id,prescription_id,user_id,schema_version,provider_count,evidence_payload)
VALUES('84000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','1.0',1,'{}');
INSERT INTO public.prescription_review_revisions(id,prescription_id,user_id,evidence_set_id,revision_number,status,
 review_schema_version,review_json,input_fingerprint,confirmation_idempotency_key,confirmed_at,is_current,intelligence_state,processing_job_id)
VALUES('85000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001',
 '84000000-0000-4000-8000-000000000001',1,'confirmed','1.0','{}',repeat('a',64),'confirm-r1',clock_timestamp(),true,'bound','83000000-0000-4000-8000-000000000001');
INSERT INTO public.meddecode_scoped_worker_scope(job_id,prescription_id,user_id,worker_login,worker_instance_id,enabled,expires_at)
VALUES('83000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001',
 'meddecode_scoped_login','phase1d2-worker',true,clock_timestamp()+interval '10 minutes');
