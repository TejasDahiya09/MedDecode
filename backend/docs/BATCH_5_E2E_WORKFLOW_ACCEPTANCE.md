# Batch 5 End-to-End Workflow Acceptance

Date: 2026-11-18

## Outcome

Batch 5 is **PARTIAL**. The repository now has a passing, isolated browser-to-Express-to-PostgreSQL two-revision acceptance path with genuine local Layers 4-5 execution and owner-bound document preview. A fresh supervised EasyOCR run also passed on the existing fictional scanned PDF. These two executions are separate: the browser run consumes the already validated OCR Contract v1 fixture rather than performing upload and OCR inside the same browser transaction. No hosted service was used or mutated.

`AUD-E2E-001` is reduced but not closed until a fresh browser upload drives the supervised OCR worker in one uninterrupted isolated run. The local `AUD-WF-001` preview path is accepted; the historical hosted S3 preview remains unverified because this batch intentionally used local synthetic storage and no hosted owner session.

## Environment and isolation

- Git checkpoint: `610306d7485d28ea897eae3055c86393057330e5` on `main`.
- PostgreSQL 17: private loopback cluster at `127.0.0.1:55440`, database `meddecode_phase1f_20261115`.
- Authentication: per-run random synthetic Alice/Bob credentials, accepted only by the guarded test server.
- Document storage: task-owned local synthetic store under `C:\Users\dahiy\MedDecode\tmp\phase1f-documents`.
- Browser application: the real React application, Express routers, PostgreSQL review RPCs and result persistence.
- Intelligence: the real local confirmed-review Python subprocess for Layers 4-5.
- Workers, hosted Supabase, AWS S3 and hosted application data: not used.
- Cleanup: the fixed synthetic prescription, jobs and results were all verified at count zero after the browser run. The private PostgreSQL cluster was stopped.

## Fresh genuine OCR evidence

The supervised fictional-document harness processed `phase1d4-scanned.pdf` using EasyOCR with adaptive OCR and TrOCR explicitly disabled:

- SHA-256: `4920c32cbb5e4e5fe33b5fa253adc7ee0dcc6766567472fc9ab8356d35a6645b`
- Bytes: 1,043,066
- Contract status: `completed_with_warnings`
- Medicines: 1
- Warnings: 3
- Providers: EasyOCR 19, PaddleOCR 0, TrOCR 0
- Elapsed: 22,469 ms
- Peak supervised child RSS: 1,294,336,000 bytes (below the unchanged 2 GiB boundary)
- Machine-readable fictional output: `C:\Users\dahiy\MedDecode\tmp\batch5-genuine-ocr-contract.json` (outside Git)

This proves current genuine local OCR execution. The browser acceptance server still initializes its review from the prior validated `phase1d4-contract.json`; it must not be described as fresh browser-driven OCR.

## Browser routes and behavior

The PostgreSQL-backed Chromium acceptance exercised:

- `/sign-in`: synthetic owner login and session use.
- `/prescriptions/:id/review`: persisted draft load, owner-bound PDF preview, medicine edit, save, refresh and optimistic-lock metadata.
- `/prescriptions/:id`: post-confirmation pending state, no-result boundary, genuine Layers 4-5 final result and refresh.
- `/prescriptions`: history list, result navigation, browser Back and Forward navigation.
- Revision history: revision 1 remained historical while revision 2 became current.

The acceptance also asserted:

- `GET /document/preview`: owner 200 with `application/pdf` and non-zero bounded bytes; anonymous 401; other owner 404.
- `GET /results`: 409 after confirmation and before finalization, proving no premature intelligence result.
- Cross-owner review access: 404.
- Exactly one current result after two revision-bound finalizations.
- All fixed fictional records removed by the guarded cleanup endpoint.

No successful-run screenshot was retained because Playwright is configured for screenshots only on failure. Final evidence is the passing command output and database cleanup assertion; stale failure traces in the task-owned temporary output are not acceptance evidence.

## State-transition model

| Prescription / job / review evidence | UI projection | Result visibility |
| --- | --- | --- |
| Uploaded, no job | Upload successful / submission available | Hidden |
| Queued or processing initial job | OCR processing | Hidden |
| Draft review exists | OCR complete - Review Required / Review & Edit | Hidden |
| Confirmed review, queued or processing revision job | Review Confirmed - Intelligence Processing | Hidden |
| Confirmed review, result job differs from authoritative processing job | New revision pending; previous result is not presented as current | Hidden |
| Confirmed review, result job matches authoritative completed job | Results Ready | Visible |
| Failed confirmed job | Intelligence processing failed | No fabricated new result |
| Legacy completed prescription with a validated result and no V3 review | Results Ready | Visible |

The previous implementation treated an available old result as current whenever processing status was missing. The new fail-closed correlation requires a confirmed review's result job ID to match the authoritative processing job ID.

## Focused fixes

1. The Phase 1F server now injects owner-scoped local history and processing-status adapters. This fixes the results-route HTTP 500 after confirmation and lets the browser test observe real local PostgreSQL state.
2. Post-confirmation browser assertions now follow the real navigation to `/prescriptions/:id`, verify the pending state, and prove the result endpoint returns 409 before finalization.
3. A confirmed revision no longer displays an older result when processing status is absent or references another job.
4. “Add Missing Medicine” now asks for a user-verified medicine name before calling the domain operation. It no longer sends a null name or invents a placeholder medicine identity.
5. The acceptance adds owner, anonymous and cross-owner preview checks plus history refresh/Back/Forward navigation.

## Real versus mocked coverage

- Real local: PostgreSQL RPC persistence, browser authentication boundary, review editing/confirmation, result fencing/history, local document stream, Node-to-Python Layers 4-5.
- Real but separate: supervised EasyOCR on the fictional scanned PDF.
- Mocked/simulated: the broader 13-test Playwright review/state matrix (missing preview, expired auth, stale revision, demo modes, responsive layout).
- Not run: credential-dependent hosted Playwright verification and any hosted upload/worker path.

## Verification results

- Backend focused preview/review/Python adapter: 43 passed.
- Backend full suite: 605 passed, 0 failed, 3 skipped. Skips are explicitly guarded PG17 exact-recovery/transport scenarios.
- Backend typecheck: passed.
- Backend production build: passed.
- Frontend full unit suite after fixes: 377 passed across 34 files.
- Frontend focused V3 state tests: 7 passed.
- Frontend review/results Playwright: 13 passed.
- PostgreSQL-backed Phase 1F Playwright: 1 passed.
- Python full suite: 447 passed, 1 dependency deprecation warning.
- Root launcher: 7 passed.
- Frontend typecheck and production build: passed. Vite retained its existing large-chunk warning.
- `git diff --check`: passed before report generation and must be rerun with the final report.

## Remaining gaps

- No one-transaction browser upload -> live worker -> supervised OCR -> draft review run exists in the isolated harness. Upload endpoint behavior is covered by backend tests, while genuine OCR and browser review are independently real.
- The hosted AWS-backed document preview remains unverified. No owner session or S3 access was used in this batch.
- Network-failure, worker-failure, stale claim fencing, duplicate confirmation/result prevention and OCR uncertainty have strong unit/integration coverage, but were not all injected into the PostgreSQL-backed browser run.
- The default 182-test Playwright inventory includes a credential-dependent genuine-hosted specification and broad visual suites; it was not run wholesale. Only the relevant safe local suites were executed.

## Files changed

- `backend/scripts/prescription-review-phase1f-server.ts`
- `frontend/src/features/prescription-review/PrescriptionReviewWorkspace.tsx`
- `frontend/src/features/prescriptions/PrescriptionResultsPage.tsx`
- `frontend/src/features/prescriptions/prescription-result-state.ts`
- `frontend/tests/e2e/prescription-review-phase1f.spec.ts`
- `frontend/tests/e2e/prescription-review.spec.ts`
- `frontend/tests/unit/v3-progress.test.tsx`
- `backend/docs/BATCH_5_E2E_WORKFLOW_ACCEPTANCE.md`

## Final status

```text
BATCH_5_STATUS: PARTIAL
ENVIRONMENT: VERIFIED ISOLATED LOCAL POSTGRESQL/AUTH/STORAGE; HOSTED SERVICES UNUSED
UPLOAD: PARTIAL - ENDPOINT TESTED, NOT BROWSER-DRIVEN IN THE COMPOSED RUN
OCR: VERIFIED GENUINE LOCAL EASYOCR, SEPARATE FROM BROWSER RUN
REVIEW: VERIFIED
CONFIRMATION: VERIFIED
LAYER_4: VERIFIED GENUINE LOCAL SUBPROCESS
LAYER_5: VERIFIED GENUINE LOCAL SUBPROCESS
RESULTS: VERIFIED
HISTORY: VERIFIED
DOCUMENT_PREVIEW: VERIFIED LOCAL OWNER/ANON/CROSS-OWNER; HOSTED S3 UNVERIFIED
AUTHORIZATION: VERIFIED LOCAL OWNER ISOLATION
NEGATIVE_TESTS: PARTIAL AT BROWSER LEVEL; VERIFIED ACROSS UNIT/INTEGRATION SUITES
FRONTEND_TESTS: 377 UNIT + 13 RELEVANT PLAYWRIGHT PASSED
BACKEND_TESTS: 605 PASSED, 3 SKIPPED
PYTHON_TESTS: 447 PASSED
PLAYWRIGHT: 1 POSTGRESQL-BACKED + 13 RELEVANT LOCAL TESTS PASSED
HOSTED_MUTATIONS: NONE
REMAINING_BLOCKERS: ONE UNINTERRUPTED ISOLATED BROWSER UPLOAD/OCR RUN; HOSTED S3 PREVIEW ACCEPTANCE
```
