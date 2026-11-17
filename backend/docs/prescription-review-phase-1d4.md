# Prescription Review Phase 1D.4 Completion

Date: 2026-11-15

## Outcome

Phase 1D.4 completed one continuous, synthetic-only local acceptance path:

`scanned PDF -> supervised EasyOCR -> Contract v1 -> PostgreSQL review initialization -> draft edit -> confirmation 1 -> Layers 4-5 -> result 1 -> reopen -> edit -> confirmation 2 -> Layers 4-5 -> result 2 -> current/history verification -> cleanup`

No hosted database, AWS object, hosted worker, frontend file, Contract v1 schema, OCR algorithm, or memory limit was changed.

## Files changed for this phase

- `intelligence/app/integration/fictional_document_harness.py`
  - Added optional `--contract-output` for writing the already validated full Contract v1 response to a local file. Default stdout behavior is unchanged.
- `backend/scripts/prescription-review-phase1d4.ts`
  - Added the guarded continuous local acceptance runner.
- `backend/docs/prescription-review-phase-1d4.md`
  - This completion record.

## Genuine OCR evidence

The acceptance source was a generated fictional scanned PDF, not a searchable PDF native-text shortcut:

- Path: `C:\Users\dahiy\MedDecode\tmp\phase1d4-scanned.pdf`
- SHA-256: `4920c32cbb5e4e5fe33b5fa253adc7ee0dcc6766567472fc9ab8356d35a6645b`
- Size: 1,043,066 bytes
- Result: `completed_with_warnings`
- Extracted medicines: 1 (`Examplemed`)
- OCR providers: EasyOCR 19 predictions; PaddleOCR 0; TrOCR 0
- Elapsed: 31,391 ms
- Peak supervised child RSS: 1,286,258,688 bytes
- Warnings: 4

Two larger scanned-PDF attempts were rejected with `PROCESSING_MEMORY_LIMIT`, demonstrating that the existing 2 GiB safety boundary remained active. TrOCR and cloud OCR remained disabled.

## PostgreSQL acceptance environment

- PostgreSQL 17 private loopback cluster: `127.0.0.1:55439`
- Fresh database: `meddecode_phase1d4_20261115`
- Existing databases were not modified.
- Reviewed processing, scoped-worker, review-v1, and result-history migrations were applied locally.
- The local fixture bootstrap recreates `public` without the hosted schema visibility baseline. The isolated database therefore received only `GRANT USAGE ON SCHEMA public TO meddecode_scoped_worker`; no direct table privilege was granted.
- User operations ran through the existing authenticated review repository/RPCs.
- Initialization and result completion ran through restricted worker RPCs with `SET LOCAL ROLE meddecode_scoped_worker`.

## Continuous result

The final run emitted `PHASE1D4_CONTINUOUS_E2E_OK` and verified:

- OCR-to-review initialization produced exactly one stable extracted medicine row.
- Revision 1 was edited and confirmed.
- Repeating confirmation with the same idempotency key preserved the same canonical fingerprint.
- An edit using a stale lock version was rejected.
- Real confirmed-review Python Layers 4-5 produced a Contract v1 result for revision 1.
- Revision 2 reopened the review, changed the medicine name/strength, and produced a different canonical fingerprint.
- Real Layers 4-5 produced result 2.
- PostgreSQL contained exactly two revision-bound results and exactly one current result.
- Result 2 was current; result 1 remained immutable history.
- A different authenticated owner could not retrieve the review.
- The fixed synthetic rows were removed after verification (`PHASE1D4_FIXTURE_CLEANUP_OK`).

Evidence identifiers from the final run:

- Revision 1: `c69ef010-3953-5373-9001-d2f70b0a2b0f`
- Revision 1 fingerprint: `e8a59626bd65a0e3d12ad303a08b144f099b74ff6e1fac12a3543ed77db4ac38`
- Revision 2: `32dfa3f2-e8f8-411d-b5b1-8ff30aad9478`
- Revision 2 fingerprint: `a9828887b0ae3f9706a4e017526c9721ae44de72d896901ffed6beb858b2bed1`

## Regression evidence

- Backend TypeScript typecheck: passed.
- Backend production build: passed.
- Backend full suite: 544 passed, 0 failed.
- Python full suite: 415 passed, 0 failed (with an explicit writable `--basetemp`).
- The first Python invocation produced 148 setup errors because the execution sandbox denied pytest's default `%TEMP%` directory. Re-running with the same tests and a writable local base directory passed 415/415; this was an environment-path failure, not an application regression.
- Contract v1 remained unchanged.

## Reproduction

The acceptance runner requires all of the following explicit local guards and inputs:

```powershell
$env:PGHOST='127.0.0.1'
$env:PHASE1D4_DATABASE='meddecode_phase1d4_20261115'
$env:PHASE1D4_ADMIN_USER='scoped_cluster_admin'
$env:PHASE1D4_CONTRACT='C:\Users\dahiy\MedDecode\tmp\phase1d4-contract.json'
$env:PHASE1D4_DOCUMENT='C:\Users\dahiy\MedDecode\tmp\phase1d4-scanned.pdf'
$env:MEDDECODE_PYTHON='C:\Users\dahiy\MedDecode-integration\intelligence\.venv\Scripts\python.exe'
$env:MEDDECODE_INTELLIGENCE_DIR='C:\Users\dahiy\MedDecode-integration\intelligence'
npx --no-install tsx scripts/prescription-review-phase1d4.ts
```

The runner refuses a non-loopback host or a differently named database and removes only its fixed fictional fixture IDs on exit.

## Boundaries and remaining work

- Hosted review/result-history migrations were not executed.
- Hosted workers remain disabled.
- `MEDDECODE_PRESCRIPTION_REVIEW_V3_ENABLED` remains false in the normal workflow.
- Frontend review acceptance remains a separate ownership/deployment step.
- The local database is retained for controlled inspection; it contains schema only after fixture cleanup.

## Final status

PREPROCESSING_FASTAPI_INTEGRATION: VERIFIED

REAL_PDF_OCR: VERIFIED

REAL_JPEG_OCR: VERIFIED (Phase 1D.3 evidence retained)

REAL_PNG_OCR: VERIFIED (Phase 1D.3 evidence retained)

LAYER2_LAYER3_EXTRACTION: VERIFIED

OCR_TO_REVIEW_PERSISTENCE: VERIFIED

FIRST_REVISION_CONFIRMATION: VERIFIED

SECOND_REVISION_CONFIRMATION: VERIFIED

RESULT_HISTORY_AND_FENCING: VERIFIED

GENUINE_LOCAL_POSTGRESQL_E2E: VERIFIED

BACKEND_REGRESSION: VERIFIED

HOSTED_MIGRATIONS_EXECUTED: NO

HOSTED_WORKERS_ENABLED: NO

READY_FOR_FRONTEND_BACKEND_E2E: YES
