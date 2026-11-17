# Prescription Review Phase 1D.1

## Outcome

Phase 1D.1 adds a local, feature-disabled path from an immutable confirmed
review revision to the existing Layer 4/5 intelligence and Contract v1 output.
It does not rerun OCR or Layers 2/3 after confirmation. PostgreSQL now fences a
result against the confirmed revision, canonical fingerprint and bound job even
when the existing finalization RPC does not explicitly supply the new review
columns.

No hosted database object, hosted record, worker flag, frontend file or Contract
v1 schema was changed.

## Files changed for Phase 1D.1

- `backend/src/services/confirmed-review-intelligence.client.ts`
- `backend/src/services/prescription-review-intelligence.service.ts`
- `backend/tests/confirmed-review-intelligence.client.test.ts`
- `backend/tests/prescription-review-intelligence.service.test.ts`
- `backend/tests/prescription-review-migration.test.ts`
- `backend/tests/prescription-review-result-fence.sql`
- `backend/database/integration-migrations/202611150001_prescription_review_v1/002_up.sql`
- `intelligence/app/integration/confirmed_review_worker.py`
- `intelligence/app/integration/contract_v1_mapper.py`
- `intelligence/tests/integration/test_confirmed_review_worker.py`
- this handoff

The working tree contains extensive concurrent work. This list is deliberately
limited to the Phase 1D.1 implementation; no unrelated changes were reverted.

## Actual execution path

1. The existing review initializer maps a validated machine Contract v1 result
   once, preserving source values, uncertainty and bounded evidence references.
2. Existing authenticated review RPCs edit and confirm the owner-scoped draft.
   Confirmation persists an immutable canonical JSON snapshot and SHA-256
   fingerprint.
3. `PrescriptionReviewIntelligenceService` loads the current confirmed revision,
   creates or reuses its single pending intelligence request, and atomically
   binds one processing job through the review repository.
4. `ConfirmedReviewIntelligenceClient` revalidates the confirmed contract and
   independently recomputes its fingerprint before starting Python.
5. The private versioned input `meddecode.confirmed-review-intelligence.v1`
   sends only active, position-ordered canonical medicine fields. It is not a
   public API and does not modify Contract v1.
6. `confirmed_review_worker.py` converts reviewed name, strength, form, dose,
   frequency, timing, route, duration, quantity and notes directly into existing
   medicine usage records. It invokes existing Layers 4 and 5, never OCR or
   Layers 2/3, and emits the existing Contract v1 response.
7. The injected result committer must persist through the existing atomic
   finalization path. The database trigger locks and validates the current review,
   revision, fingerprint and job binding before a result can become current.

The output includes `USER_CONFIRMED_TRANSCRIPTION`: user confirmation is a
transcription decision, not clinical verification. Extraction confidence is
left null instead of being fabricated.

## PostgreSQL transaction and fencing behavior

The migration remains transactional. Its result-fence trigger now derives a
review binding from `NEW.job_id` when the pre-existing finalization function
inserts null review columns, copies the immutable revision/fingerprint into the
result, and validates all of the following under row locks:

- prescription and owner-derived review relationship;
- current status is confirmed;
- current confirmed revision is the bound revision;
- canonical fingerprint equals the bound fingerprint;
- processing job equals the bound job;
- binding remains in the pending/processing state.

The service-level race test reopens the review while Python is running and
proves the old result commit is rejected. The PostgreSQL 17 test proves a legacy
null-column finalization is correctly bound and that the same old result is
rejected after the revision is superseded. Duplicate confirmation and job
binding remain idempotent through the existing RPCs and unique constraints.

Current migration hashes:

- `001_preflight.sql`: `945cc8b51956e4dfab819259eac61b9ef3a90ff35ae20b85416ceb92ad8027af`
- `002_up.sql`: `08b2231a6d7868452f056f44a5a08be0515f35e1245343b8bd08c1081593b563`
- `003_verify.sql`: `bb39ffb12ff20c1b8b2c5bcfddc43a3a36814296e4295ebc9940fed17d1f2ff4`
- `004_rollback_review.sql`: `183f5bc39df22b5c4abef8dd93f7902c0217474a79611f94d9782fa3cf14d8db`

Any previous approval or review of `002_up.sql` is invalidated by its new hash.

## Verification evidence

- Backend full regression: `npm test --prefix backend` — 541/541 passed.
- Backend typecheck: `npm run typecheck --prefix backend` — passed.
- Backend production build: `npm run build --prefix backend` — passed.
- Focused Python: confirmed-review worker and Contract mapper — 8/8 passed.
- Genuine Node-to-Python subprocess: corrected Paracetamol 500 mg confirmed input
  ran through real Layers 4/5 and passed the TypeScript Contract v1 validator.
- Local PostgreSQL 17: migration and independent verification passed with
  `PRESCRIPTION_REVIEW_VERIFY_OK`.
- Local PostgreSQL result-fence proof passed with
  `PRESCRIPTION_REVIEW_RESULT_FENCE_OK`; the revision and fingerprint were
  populated and a superseded completion was rejected.
- Rollback of the disposable local database passed; the private loopback test
  cluster was stopped.
- `git diff --check` returned no whitespace errors (only existing line-ending
  conversion warnings).

The full Python suite was run with a writable isolated pytest temp directory:
400 passed, 3 failed and 4 errored. The remaining cases require unconfigured
external test dependencies (`SUPABASE_URL`/`SUPABASE_KEY` and Layer 4 runtime
database fixtures); the focused changed-path tests pass. These failures are not
reported as a clean full-Python regression.

## Document formats and genuine E2E status

The existing machine-result initializer remains format-independent and consumes
the same Contract v1 produced by PDF/JPEG/PNG processing. This phase did not
rerun genuine EasyOCR/PaddleOCR for all three formats. It verified genuine
subprocess execution from confirmed structured data through Layers 4/5 only.
Therefore the requested upload-to-second-revision PDF/JPEG/PNG journey is not
claimed as complete.

## Remaining blockers

1. The existing result model has a historical unique constraint on
   `prescription_intelligence_results.prescription_id`, and the existing
   finalization RPC assumes one result per prescription. A second confirmed
   revision cannot yet retain the first result as history and persist a new
   current result. This requires a separately reviewed result-history and
   finalization migration; the constraint was not silently weakened.
2. The new confirmed-review service is intentionally not registered in a hosted
   worker or automatically enabled. The final committer remains an explicit
   atomic interface so an unsafe non-transactional implementation cannot be
   mistaken for production persistence.
3. Genuine PDF/JPEG/PNG upload, OCR, review edits, two confirmations, persisted
   results and history still require one isolated end-to-end harness after the
   result-history model is resolved.
4. The full Python suite needs its documented external Layer 4/Supabase test
   configuration for an all-green repository-wide run.

## Hosted approval boundary

No hosted deployment is ready under the old migration review because
`002_up.sql` changed. Before any hosted write, review the four hashes above, the
result-history/finalization design, an updated backup, exact affected functions
and constraints, and an independent preflight/verification/rollback set.
Deployment, worker activation and hosted patient/job processing remain separate
approval boundaries.

## Status

- `OCR_TO_REVIEW_INITIALIZATION: VERIFIED` (local Contract v1 mapping and tests)
- `REVIEW_CONFIRMATION_TO_INTELLIGENCE: VERIFIED` (local orchestration and real Python subprocess)
- `CONFIRMED_DATA_RECOMPUTATION: VERIFIED` (confirmed fields drive Layers 4/5; no OCR overwrite)
- `POSTGRESQL_PERSISTENCE: VERIFIED` (local PostgreSQL review persistence and result fence; not hosted)
- `REVISION_FINGERPRINT_FENCING: VERIFIED`
- `RESULT_HISTORY_COMPATIBILITY: BLOCKED`
- `GENUINE_FICTIONAL_E2E: PARTIAL`
- `BACKEND_REGRESSION: VERIFIED`
- `HOSTED_MIGRATION_EXECUTED: NO`
- `HOSTED_WORKER_ENABLED: NO`
- `READY_FOR_PHASE_1D2: NO`
