\set ON_ERROR_STOP on
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
COMMIT;
