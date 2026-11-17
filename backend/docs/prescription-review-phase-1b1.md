# Prescription Review Phase 1B.1 Handoff

Phase 1B.1 connects Review Contract v1 to authenticated Express routes and a persistence abstraction. It remains disabled by default with `MEDDECODE_PRESCRIPTION_REVIEW_V3_ENABLED=false`.

## Implemented local API foundation

- `GET /api/v1/prescriptions/:prescriptionId/review`
- `GET /api/v1/prescriptions/:prescriptionId/review/revisions`
- `PATCH /api/v1/prescriptions/:prescriptionId/review/draft`
- `POST /api/v1/prescriptions/:prescriptionId/review/confirm`
- `POST /api/v1/prescriptions/:prescriptionId/review/reopen`
- `GET /api/v1/prescriptions/:prescriptionId/evidence`

Every route uses the existing bearer-token verifier. Owner identity comes only from the verified token; request bodies containing extra fields such as `ownerId` are rejected. Missing and non-owned prescriptions have the same response.

The draft endpoint accepts one strict operation: `edit_fields`, `add_medicine`, `remove_medicine`, `restore_medicine`, `restore_original`, `reorder_medicines`, or `save_draft`. Every mutation supplies expected revision and lock versions.

## Repository and stale-result contract

`PrescriptionReviewRepository` covers owner lookup, current/history/evidence reads, compare-and-swap commits, append-only revisions, pending intelligence requests, job binding and result acceptance. The local repository supplies deterministic tests, not PostgreSQL guarantees.

Confirmation produces exactly one pending request keyed by revision and fingerprint. Result acceptance requires the same owner, prescription, latest confirmed revision, fingerprint and processing job. Reopening makes an older bound request stale.

## Migration proposal

`database/integration-migrations/202611150001_prescription_review_v1` contains read-only preflight, additive schema/RLS/grants, independent verification and review-only rollback.

The proposal creates the four V3 review entities and nullable legacy-compatible result-binding columns. Evidence payload is not directly selectable by `authenticated`; only bounded metadata columns are granted. Review tables permit owner reads under RLS but grant no direct mutations.

## Explicit Phase 1B.2 blocker

The proposed migration intentionally does **not** grant direct table writes and does not yet deploy mutation RPCs. Before hosted deployment, Phase 1B.2 must provide reviewed `SECURITY DEFINER` functions that:

1. derive `auth.uid()` and lock the owned prescription/current revision;
2. compare revision ID, revision number and lock version;
3. validate and commit revision/medicine/event rows atomically;
4. replay command and confirmation idempotency keys safely;
5. supersede the prior current revision while appending a reopened draft;
6. create one pending intelligence request;
7. bind a processing job and fence result finalization by revision/fingerprint/job;
8. expose only EXECUTE to `authenticated` and the exact restricted worker role;
9. include local PostgreSQL 17 restricted-role, concurrency and rollback tests.

Therefore the SQL is ready for security/design review, not hosted execution.

## Document preview boundary

This phase exposes bounded evidence metadata only. It does not return S3 bucket/key values or prescription content. Original-document preview still requires a later authenticated streaming or short-lived signed-access service that derives the object reference from the owned prescription, never from a client key.

## Compatibility

Existing upload, processing, results/history, cabinet, catalogue, PostgreSQL/RPC worker and Contract v1 behavior are unchanged. No Redis/BullMQ, hosted write, OCR change or worker activation occurred.
