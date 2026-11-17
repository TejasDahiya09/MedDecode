# Prescription Review Phase 1D.2

## Implemented result-history fix

The blocker was the table constraint
`prescription_intelligence_results_prescription_id_key`, combined with the old
completion function's prescription-wide existing-result check. Together they
allowed only one result row for a prescription.

The new additive migration is:

`backend/database/integration-migrations/202611150002_prescription_result_history_v1/`

It:

- preserves existing result IDs, job IDs and Contract v1 JSON;
- backfills existing rows as current;
- replaces prescription-wide uniqueness with unique job lineage;
- enforces at most one current row per prescription using a partial unique index;
- adds deterministic prescription/time history ordering;
- adds owner-scoped SECURITY DEFINER current-result and result-history readers;
- adds a restricted review finalizer available only to
  `meddecode_scoped_worker`;
- refuses rollback once more than one result exists for a prescription.

The original Phase 1D.1 migration was not rewritten. Its `002_up.sql` still
hashes to `08b2231a6d7868452f056f44a5a08be0515f35e1245343b8bd08c1081593b563`.

## Transactional finalization

`meddecode_finalize_review_result_v1` locks in this order: job, prescription,
confirmed revision, existing same-job result. It then verifies:

- job and prescription correlation;
- prescription/job owner equality;
- latest current confirmed revision;
- immutable input fingerprint;
- revision-to-job binding;
- scoped login, worker instance and non-expired authorization;
- processing lease owner, generation and expiry;
- Contract v1 correlation and bounded payload size.

Within that transaction it marks the previous result historical, inserts the
new current result, marks the revision complete, updates the prescription's
current high-level result metadata, and completes the exact fenced job.
Same-job/same-payload replay is idempotent. A delayed earlier revision is
rejected before it can change the current marker.

The normalized medicine/recommendation/warning tables remain the existing
current-projection cache; this migration does not duplicate them for history.
Immutable historical Contract v1 payloads are retained in the result rows.

## API compatibility

The existing `/api/v1/prescriptions/:id/results` response shape is unchanged.
Its repository now explicitly filters `is_current=true`, so insertion time can
never cause an older revision to be returned. Existing rows are backfilled as
current, preserving legacy prescriptions. Prescription history, review history,
result IDs, Contract v1 payloads and Cabinet foreign keys are unchanged.

The database exposes owner-scoped `meddecode_list_prescription_result_history_v1`
for a future UI history view without granting authenticated users direct writes.

## Local PostgreSQL 17 evidence

Disposable database: `meddecode_phase1d2_20261115` on loopback-only port 55439.
The existing private PostgreSQL 17 cluster was stopped after verification.

- preflight: `PRESCRIPTION_RESULT_HISTORY_PREFLIGHT_OK`;
- migration: committed once;
- independent verification: `PRESCRIPTION_RESULT_HISTORY_VERIFY_OK`;
- dedicated `meddecode_scoped_login` with `SET LOCAL ROLE
  meddecode_scoped_worker` finalized both revisions;
- Revision 1 persisted as `completed_with_warnings`;
- Revision 2 persisted as `completed`;
- two immutable rows remained and exactly Revision 2 was current;
- identical Revision 2 replay returned `replayed=true`;
- delayed Revision 1 completion returned the expected stale rejection;
- another authenticated owner received null from the current-result RPC;
- rollback first refused while history existed;
- after removing only the disposable synthetic rows, rollback removed only the
  Phase 1D.2 functions/indexes/column, restored legacy uniqueness and left the
  Phase 1D.1 review tables intact;
- no hosted connection or hosted write was used.

The SQL functional fixture uses synthetic Contract-shaped JSON to isolate the
transaction behavior. The genuine Node-to-Python confirmed-data Layers 4/5
subprocess remains separately verified by the Phase 1D.1 backend regression;
this phase did not rerun OCR.

## Regression evidence

- Backend: 544/544 tests passed.
- TypeScript typecheck: passed after correcting the new migration test's CJS
  path handling.
- Production build: passed.
- Confirmed-review Python and Contract mapper: 8/8 passed.
- `git diff --check`: no whitespace errors; existing line-ending warnings only.
- Feature remains disabled by default.

## Migration hashes

- `001_preflight.sql`: `73f7c0be9594dc709344695e5875ae898886450c2d9d6a74330849aa6d4222f1`
- `002_up.sql`: `84f476117f2c7074b1d7a2a23aea7b4bd7edb111d551a782b62a82e1f06fd1c2`
- `003_verify.sql`: `6874157430ad5993f8435244cb9dde5942682639274319896a274279102c4190`
- `004_rollback_review.sql`: `7ffe462ca1b22589a683dbd8d4268db4103a537a4f5a63afb51ed4035825230a`

No hosted approval applies to these new hashes. Hosted deployment would require
a fresh project/backup preflight, review of the exact constraint and functions,
transactional execution of `002_up.sql`, independent `003_verify.sql`, and a
separate application-release approval. Worker activation remains separate.

## Remaining genuine blockers

- A single continuous PDF/JPEG/PNG OCR-to-two-revision database harness was not
  run; OCR was not repeated merely to claim coverage.
- Historical normalized projections are not duplicated. History is the
  immutable Contract v1 payload; relational projections continue to represent
  only the current prescription result.
- Nothing has been deployed to hosted Supabase or enabled in a hosted worker.

## Status

- `RESULT_HISTORY_SCHEMA: VERIFIED`
- `TWO_REVISION_PERSISTENCE: VERIFIED`
- `CURRENT_RESULT_SELECTION: VERIFIED`
- `STALE_RESULT_REJECTION: VERIFIED`
- `LEGACY_RESULT_COMPATIBILITY: VERIFIED`
- `LOCAL_POSTGRES17_TESTS: VERIFIED`
- `GENUINE_NODE_PYTHON_INTEGRATION: VERIFIED` (separate real subprocess regression)
- `FULL_FICTIONAL_E2E: PARTIAL`
- `BACKEND_REGRESSION: VERIFIED`
- `HOSTED_MIGRATIONS_EXECUTED: NO`
- `HOSTED_WORKER_ENABLED: NO`
- `READY_FOR_LOCAL_UI_INTEGRATION: YES`
