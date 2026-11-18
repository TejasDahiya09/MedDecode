# Batch 4 Backend Reliability and Observability

Date: 2026-11-17
Branch: `main`
Baseline HEAD: `ea3ced08f2fd4f486dfc1324b02310bab99bbc8d`

## Scope and preservation

This batch changed backend preview handling, subprocess lifecycle cleanup, test scheduling, launcher stream cleanup, and their tests. It did not change a database schema, migration, hosted record, worker policy, dataset, or `MedDecode-dev`. The four untracked Batch 3 reports and four workspace-cleanup reports present at baseline were preserved without modification.

## Root causes and corrections

### AUD-WF-001 and AUD-OBS-002: document preview and diagnostics

The owner-scoped preview service previously collapsed metadata lookup failures, invalid stored metadata, S3 authorization/object failures, timeout, cancellation, malformed response bodies, and stream failures into one undifferentiated `UNAVAILABLE` error. The Express route did not propagate request cancellation and emitted no safe correlation identifier. S3 response bodies were not explicitly disposed when consumption failed or exceeded the limit.

The service now records an internal stage (`metadata_lookup`, `metadata_validation`, `storage_request`, or `storage_stream`) and a bounded category (`persistence`, `configuration`, `access_denied`, `object_not_found`, `timeout`, `cancelled`, `malformed_response`, `size_limit`, or `provider`). Provider status is reduced to `4xx` or `5xx`. The route generates an `X-Request-ID`, propagates abort/close cancellation, removes its listeners in `finally`, and logs only the correlation ID, stage, category, and optional status class. It never logs owner IDs, prescription IDs, object keys, credentials, document bytes, patient data, or raw provider errors.

Public behavior remains:

- missing authentication: 401;
- owner-scoped missing prescription: 404;
- bounded-size rejection: 413;
- persistence, configuration, S3 access/object, timeout, cancellation, malformed-body, and stream failures: 503.

AWS SDK response streams are now destroyed or cancelled after early failure. Successful PDF/JPEG/PNG bytes continue to use private no-store response headers.

Mocked local tests prove the application behavior for success, anonymous/non-owner denial, missing rows, database failure, AccessDenied, NoSuchKey, provider timeout, malformed body, failing stream, size overflow, and caller cancellation. A genuine hosted S3 preview was outside this batch's authorization. Therefore the historical production 503 cannot be attributed conclusively to application code versus IAM/object configuration. If a live request now reports `access_denied` or `object_not_found`, AWS configuration needs a separately authorized investigation; no AWS permission was changed here.

### AUD-OBS-001: listener lifecycle

The historical `MaxListenersExceededWarning` was not reproduced in isolated tests, and the current launcher does not add listeners to the target `process.stdout`/`process.stderr` streams. Two lifecycle gaps were nevertheless confirmed:

- prefixed child streams had no explicit listener-disposal contract;
- the Node-to-Python adapter destroyed process streams but left its named child/stream listeners registered until garbage collection.

Both paths now remove their own listeners deterministically. A launcher regression initializes and closes 25 prefixed streams and verifies zero remaining `data`, `end`, `close`, and `error` listeners without changing EventEmitter limits. Subprocess timeout tests verify child and stream listener counts return to zero. The warning is mitigated and monitored, but its historical target-stream origin remains unproven.

### AUD-BE-001: Python subprocess timeout sensitivity

The full backend suite reproduced the real Layers 2-5 process crossing the 5-second production default under parallel test and PostgreSQL-cluster contention. Focused execution completed in under one second. Production timeout and cancellation behavior were not relaxed.

Corrections:

- the real Layers 2-5 contract test has an explicit 15-second test-only budget;
- the backend regression command runs test files serially so three disposable PostgreSQL clusters and heavyweight Python processes do not contend;
- dedicated 30 ms timeout, abort, process-tree termination, inherited-pipe, stdout-bound, and cleanup tests remain unchanged and passing;
- subprocess listeners are removed on every terminal path.

The full suite also exposed one Windows CRLF-only assertion in a migration source test. Its regular expression now accepts LF or CRLF; migration SQL was not modified.

## Files changed

- `backend/package.json`
- `backend/scripts/prescription-review-phase1f-server.ts`
- `backend/src/routes/prescription-document-preview.routes.ts`
- `backend/src/services/local-python-intelligence.client.ts`
- `backend/src/services/prescription-document-preview.service.ts`
- `backend/tests/local-python-intelligence.client.test.ts`
- `backend/tests/prescription-document-preview.test.ts`
- `backend/tests/processing-job-migration.test.ts`
- `scripts/dev-launcher.cjs`
- `scripts/dev-launcher.test.cjs`
- `backend/docs/BATCH_4_BACKEND_RELIABILITY.md`

## Verification evidence

- Focused backend preview, Python adapter, and migration-source tests: 38 passed.
- Backend full suite: 605 passed, 0 failed, 3 skipped (608 total) using serial scheduling and genuine disposable PostgreSQL 17 clusters.
- Backend typecheck: passed.
- Backend production build: passed.
- Frontend review/preview and V3 progress tests: 52 passed.
- Frontend typecheck: passed.
- Frontend production build: passed; existing large-chunk warning remains.
- Root launcher tests: 7 passed.
- `git diff --check`: passed.

The three skipped backend tests are approval-gated PostgreSQL integration paths already marked skip by the repository; they were not represented as passes. Initial sandbox execution could not start private PostgreSQL clusters in Windows temp. The exact full suite passed when run with permission to use its task-owned disposable temp resources.

## Remaining risks and external blockers

- No live hosted S3 object was read. IAM, bucket, key, or KMS drift remains possible and requires separate read-only/live authorization to classify.
- The historical listener warning was not reproduced, so the exact original emitter owner is not proven. Deterministic cleanup now covers the identified application listener lifecycles.
- Serial backend tests trade execution speed for deterministic isolation; production concurrency is unchanged.
- No hosted mutation, worker startup, prescription processing, upload, or schema change occurred.

## Issue disposition

- AUD-BE-001: resolved for the reproducible test-contention failure; production timeout semantics preserved.
- AUD-WF-001: application defects corrected and locally verified; live S3 outcome remains externally unverified.
- AUD-OBS-001: listener cleanup corrected; historical warning root cause remains partially unverified.
- AUD-OBS-002: resolved for preview and existing worker stage/RPC diagnostics with safe allowlisted fields.

## Finalization and owner-authenticated preview verification

The reviewed Batch 4 source, tests, and this report were committed as `bda2f5f8` (`fix(backend): harden preview and worker reliability`) and pushed normally to `origin/main`. The branch was synchronized with the remote before staging, and the staged set contained only the 11 reviewed Batch 4 paths. A staged-content scan found no credential patterns, target prescription identifier, or private medical information.

Preview verification result: `UNVERIFIED`.

The Windows/browser automation helper was unavailable after its prescribed retry and session-reset recovery sequence, so no owner-authenticated browser session could be inspected. In accordance with the authorization boundary, no browser storage, cookie, bearer token, environment credential, or direct hosted credential was extracted or substituted. No preview request reached the application, so there is no response code, diagnostic stage, S3 authorization result, content type, or byte count to report. This outcome does not establish `APP_ERROR`, `STORAGE_DENIED`, `OBJECT_MISSING`, or `CONFIG_DRIFT`.

AUD-WF-001 cannot yet be closed. Completion requires the user to make an already signed-in owner browser session available and rerun the narrowly scoped preview request. The other Batch 4 dispositions above are unchanged.
