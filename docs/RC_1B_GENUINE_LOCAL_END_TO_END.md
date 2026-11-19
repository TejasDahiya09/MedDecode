# RC-1B Genuine Local End-to-End Acceptance

Date: 2026-11-19

Branch: `main`
Starting checkpoint: `4039f8a1eabbd7260328ca37c4374e60f31616dc`

## Outcome

RC-1B passed in a fully isolated local environment. A Playwright-controlled user uploaded the real bytes of the fictional scanned PDF through the normal upload UI. The backend created one owner-bound PostgreSQL job, the restricted worker claimed it once, emitted at least one fenced heartbeat, retrieved the private bytes from the local storage adapter, and invoked loopback FastAPI. FastAPI executed the supervised EasyOCR child process; no precomputed OCR response was injected.

The initial job persisted one OCR evidence set and one draft review, then completed without creating an intelligence result. Playwright opened the ordinary review workspace, verified a non-empty extracted medicine identity, and performed the explicit confirmation interaction. The acceptance backend then exercised the real confirmed-review Python entry point through Layers 4 and 5 and finalized one revision-bound result. Results, history, preview, refresh, Back/Forward navigation, anonymous denial, and cross-owner denial all passed.

No hosted Supabase, AWS, cloud OCR, or external catalogue endpoint was contacted. No hosted mutation occurred.

## Isolation and runtime

- PostgreSQL 17: task-owned cluster on `127.0.0.1:55440`, database `meddecode_phase1f_20261115`.
- Catalogue: four records from the repository's `synthetic_test` fixture.
- Catalogue identity: `meddecode_catalogue_rc1a_reader`, read-only and limited to the synthetic catalogue relation.
- FastAPI: `127.0.0.1:18000` with a random per-run internal token.
- Backend: `127.0.0.1:3011`.
- Frontend: `127.0.0.1:5176`.
- Auth: two isolated fictional accounts with random per-run secrets.
- Storage: task-owned `C:\Users\dahiy\MedDecode\tmp\rc1b-documents`.
- Worker: `rc1a-local-worker-001`, restricted database login, concurrency one, controlled single attempt, exact admission generation 2.
- OCR: local EasyOCR assets already present on disk; adaptive PaddleOCR, TrOCR, and cloud OCR were disabled.
- Fixture: `C:\Users\dahiy\MedDecode\tmp\phase1d4-scanned.pdf` (fictional scanned PDF).

The Playwright service environment is built from an explicit operating-system variable allowlist. It does not inherit repository or hosted credentials. All application and database destinations are fixed loopback values. The upload store rejects any owner, prescription ID, or bucket outside the single fixture contract.

## Implemented boundary

`createApp` now accepts an optional automatic-processing-store factory, retaining the production default while allowing the isolated acceptance server to supply its exact owner-scoped store.

When and only when `RC1B_REAL_OCR=true`, the Phase 1F server:

1. omits the historical precomputed Contract v1 initialization;
2. registers the actual upload endpoint against local private storage;
3. creates one fixed owner-bound job, generation-2 admission, and worker scope atomically on one PostgreSQL session;
4. starts the existing controlled single-attempt worker graph;
5. uses the real HTTP FastAPI client and Migration 010 initial-review completion RPC;
6. exposes only owner-authenticated, aggregate acceptance evidence and finalization helpers;
7. keeps the historical fixture-driven Phase 1F behavior unchanged when RC-1B mode is absent.

The FastAPI service is launched with `intelligence` as its working directory. This is required because the supervisor intentionally removes `PYTHONPATH` from the OCR child's environment; launching from the repository root caused the first diagnostic run to fail safely with `INTELLIGENCE_TRANSPORT_FAILED`. No supervisor isolation rule was weakened.

The local database bootstrap installs the missing local compatibility columns and Migration 010 function only in the disposable database. No checked-in or hosted migration was altered or deployed.

## State evidence

Before confirmation, the owner-authenticated aggregate evidence endpoint asserted:

```text
job_status=completed
attempt_count=1
claim_generation=1
heartbeat_recorded=true
evidence_count=1
review_count=1
result_count=0
```

After the explicit browser confirmation and Layers 4-5 execution:

```text
result_count=1
history_count=1
result_status=completed or completed_with_warnings
```

The results page displayed the fictional `Examplemed` identity. The preview returned HTTP 200, `application/pdf`, and non-zero bytes. An anonymous preview returned 401. The second fictional owner received 404 for the first owner's review.

The final Playwright acceptance passed in 27.9 seconds (36.2 seconds including service startup). Earlier diagnostic attempts are not counted as passes: one exposed the FastAPI/OCR-child working-directory defect; another exposed an incorrect 409 expectation where the API correctly returned 404 for no result; and later runs tightened heartbeat and UI-load evidence. All failures were confined to disposable local data and were cleaned before the final run.

## Verification

- RC-1B Playwright acceptance: 1 passed, 0 failed.
- Python full suite: 451 passed, 0 failed, 1 dependency deprecation warning (outside the restricted token with a task-owned `--basetemp`).
- Backend full suite in sandbox: 590 passed, 3 skipped, 3 disposable-PG startup failures caused by the Windows restricted token.
- The same three PostgreSQL suites outside that token: 17 passed, 0 failed on PostgreSQL 17.11.
- Frontend unit suite: 378 passed across 34 files.
- Frontend lint: passed.
- Backend typecheck: passed.
- Frontend typecheck: passed.
- Backend production build: passed outside the sandbox write restriction.
- Frontend production build: passed; main application chunk 102.89 kB minified / 29.36 kB gzip.
- Root launcher tests: 7 passed.
- `git diff --check`: passed before this report and rerun after it.

The initial sandbox Python run produced 160 fixture-setup errors because the restricted token could not access pytest's temp root; 291 tests ran without assertion failures. The complete outside-token rerun is the authoritative Python result.

## Files changed

- `backend/src/app.ts`
- `backend/scripts/prepare-prescription-review-phase1f.ps1`
- `backend/scripts/prescription-review-phase1f-server.ts`
- `backend/scripts/rc1a-local-runtime.ts`
- `backend/tests/rc1a-local-runtime.test.ts`
- `frontend/playwright.rc1b.config.ts`
- `frontend/tests/e2e/prescription-review-rc1b.spec.ts`
- `docs/RC_1B_GENUINE_LOCAL_END_TO_END.md`

Existing unrelated untracked reports were preserved. Datasets, `MedDecode-dev`, migrations, model assets, environments, and historical application data were not modified.

## Cleanup and limitations

The acceptance cleanup removed the exact prescription, job, admission, scope, evidence, review, medicines, result, and history fixtures. Administrator-side counts for the fixed prescription were all zero afterward. Playwright stopped frontend, backend, FastAPI, and worker processes. The disposable PostgreSQL cluster was stopped. Task-owned RC-1B storage, Playwright output, and pytest temp directories were removed. No listener remained on ports 3011, 5176, 18000, or 55440.

This validates the local academic/fictional-data workflow, not production clinical accuracy. It covers one fictional scanned PDF and EasyOCR. It does not establish genuine adaptive PaddleOCR behavior, TrOCR behavior, hosted S3 preview, hosted worker activation, concurrency beyond the enforced one-job path, or medical correctness. Peak process-tree memory was not independently sampled by this acceptance test; the existing supervisor memory limit remained in force.

## Final status

```text
RC_1B_STATUS: PASS
BROWSER_UPLOAD: PASS - normal UI uploaded real fictional PDF bytes
OWNER_SCOPED_JOB: PASS - one owner-bound job, attempt 1, claim generation 1
RESTRICTED_WORKER: PASS - dedicated scoped identity, one claim, heartbeat recorded, one attempt
GENUINE_FASTAPI_OCR: PASS - loopback FastAPI and supervised local EasyOCR child; no injected Contract v1
DRAFT_REVIEW: PASS - one evidence set and one review persisted
HUMAN_CONFIRMATION: PASS - explicit Playwright action through ordinary review UI
LAYER_4: PASS - real confirmed-review Python execution against synthetic local catalogue
LAYER_5: PASS - real conservative recommendation pipeline completed
RESULT_PERSISTENCE: PASS - one revision-bound current result
HISTORY: PASS - one result-history entry and browser navigation verified
DOCUMENT_PREVIEW: PASS - owner 200/application-pdf; anonymous 401
AUTHORIZATION: PASS - owner access, anonymous denial, cross-owner 404
ISOLATION: PASS - loopback-only services, disposable DB/storage/auth, explicit environment allowlist
TESTS: PASS - results itemized above
RESOURCE_CLEANUP: PASS
REMAINING_BLOCKERS: production/hosted acceptance, adaptive PaddleOCR evidence, and independent peak-memory measurement remain outside RC-1B
HOSTED_MUTATIONS: NONE
```
