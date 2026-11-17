\set ON_ERROR_STOP on
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
SELECT public.meddecode_apply_prescription_review_draft_v1(
  '20000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',1,0,
  '{"schemaVersion":"1.0","prescriptionId":"20000000-0000-4000-8000-000000000001","evidence":{"evidenceSetId":"40000000-0000-4000-8000-000000000001","schemaVersion":"ocr-evidence.v1"},"revisionId":"50000000-0000-4000-8000-000000000001","revisionNumber":1,"baseRevisionId":null,"status":"draft","lockVersion":1,"medicines":[],"unresolvedFields":[],"canonicalInputFingerprint":null,"confirmation":null,"createdAt":"2026-11-15T10:00:00Z","updatedAt":"2026-11-15T10:01:00Z"}',
  '[]',
  '{"eventId":"60000000-0000-4000-8000-000000000002","type":"draft_saved","medicineId":null,"changedFields":[],"idempotencyKey":null,"occurredAt":"2026-11-15T10:01:00Z"}'
);
COMMIT;
