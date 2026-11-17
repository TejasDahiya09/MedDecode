\set ON_ERROR_STOP on

INSERT INTO public.users(id) VALUES
  ('10000000-0000-4000-8000-000000000001'),
  ('10000000-0000-4000-8000-000000000002');
INSERT INTO public.prescriptions(id,user_id) VALUES
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002');
INSERT INTO public.ai_jobs(id,prescription_id,user_id) VALUES
  ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001'),
  ('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002');
INSERT INTO public.meddecode_scoped_worker_scope(job_id,prescription_id,user_id,worker_login,worker_instance_id,enabled,expires_at)
VALUES ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','meddecode_scoped_login','review-test-worker',true,clock_timestamp()+interval '1 hour');

-- The scoped worker can initialize only the exact job covered by its live scope.
\connect meddecode_review_1b2_20261115 meddecode_scoped_login 127.0.0.1 55439
BEGIN;
SET LOCAL ROLE meddecode_scoped_worker;
SELECT public.meddecode_initialize_prescription_review_v1(
  '30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
  '{"evidenceSetId":"40000000-0000-4000-8000-000000000001","schemaVersion":"ocr-evidence.v1","providerCount":1,"payload":{}}',
  '{"schemaVersion":"1.0","prescriptionId":"20000000-0000-4000-8000-000000000001","evidence":{"evidenceSetId":"40000000-0000-4000-8000-000000000001","schemaVersion":"ocr-evidence.v1"},"revisionId":"50000000-0000-4000-8000-000000000001","revisionNumber":1,"baseRevisionId":null,"status":"draft","lockVersion":0,"medicines":[],"unresolvedFields":[],"canonicalInputFingerprint":null,"confirmation":null,"createdAt":"2026-11-15T10:00:00Z","updatedAt":"2026-11-15T10:00:00Z"}',
  '[]',
  '{"eventId":"60000000-0000-4000-8000-000000000001","type":"draft_created","medicineId":null,"changedFields":[],"idempotencyKey":null,"occurredAt":"2026-11-15T10:00:00Z"}'
);
ROLLBACK;

\connect meddecode_review_1b2_20261115 postgres 127.0.0.1 55439

DO $test$
BEGIN
  IF has_table_privilege('authenticated','public.prescription_review_revisions','INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'authenticated direct mutation privilege';
  END IF;
  IF has_table_privilege('meddecode_scoped_worker','public.prescription_review_revisions','SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'worker direct review-table privilege';
  END IF;
  IF has_function_privilege('authenticated','public.meddecode_initialize_prescription_review_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'authenticated can initialize reviews';
  END IF;
  IF NOT has_function_privilege('meddecode_scoped_worker','public.meddecode_initialize_prescription_review_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'scoped worker initialization grant absent';
  END IF;
END $test$;

-- Owner reads are derived from auth.uid(); another owner sees no review.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
DO $test$ BEGIN
  IF public.meddecode_has_owned_prescription_review_v1('20000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'cross-owner read allowed';
  END IF;
END $test$;
ROLLBACK;

SELECT 'PRESCRIPTION_REVIEW_POSTGRES_FUNCTIONAL_OK' AS marker;
