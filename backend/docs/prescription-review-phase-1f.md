# Prescription Review Phase 1F Completion

Date: 2026-11-15

## Outcome

Phase 1F completes the missing genuine browser-to-database acceptance path:

`Chromium -> ephemeral local authentication -> Express -> authenticated review RPCs -> PostgreSQL 17 -> draft persistence -> confirmation 1 -> real local Layers 4-5 -> result 1 -> reopen -> confirmation 2 -> real local Layers 4-5 -> result 2 -> current/history reads -> exact fixture cleanup`.

The review API, domain operations, PostgreSQL repository, reviewed migrations, confirmed-review intelligence adapter, result finalizer, React review workspace, and private document transport are reused. No production startup or authentication behavior was changed.

## Files added

- `backend/scripts/prepare-prescription-review-phase1f.ps1` — creates/starts only the named loopback PostgreSQL 17 test cluster and installs the already reviewed local migration chain.
- `backend/scripts/prescription-review-phase1f-server.ts` — fail-closed test composition using ephemeral local sessions, owner-bound PostgreSQL RPC claims, the local fictional document store, real confirmed-review intelligence, and fenced result finalization.
- `frontend/vite.phase1f.config.ts` — isolated ports 5176/3011; normal Vite configuration is unchanged.
- `frontend/playwright.phase1f.config.ts` — generates per-run 256-bit synthetic account secrets and launches only the test composition.
- `frontend/tests/e2e/prescription-review-phase1f.spec.ts` — one uninterrupted genuine acceptance scenario.
- `backend/docs/prescription-review-phase-1f.md` — this report.

## Run command

From the repository root in normal Windows PowerShell:

```powershell
& .\backend\scripts\prepare-prescription-review-phase1f.ps1 -Action Prepare
Set-Location .\frontend
npx playwright test --config playwright.phase1f.config.ts
Set-Location ..
& .\backend\scripts\prepare-prescription-review-phase1f.ps1 -Action Stop
```

The runner requires the existing fictional Phase 1D.4 files under `C:\Users\dahiy\MedDecode\tmp`, refuses any host except `127.0.0.1`, refuses any database name except `meddecode_phase1f_20261115`, requires both ordinary review and hosted worker flags to remain `false`, and uses unique ports 3011, 5176, and 55440.

## Verified evidence

- Browser authentication used a random per-run secret and an opaque in-memory session issued by the existing `createLocalSyntheticAuth` facility.
- Browser review calls were not mocked. Vite proxied them to the isolated Express server.
- Express used `PostgresPrescriptionReviewRepository`; each authenticated RPC transaction set the `authenticated` role and the matching local `auth.uid()` claim.
- The PDF preview came from the fictional local store through the authenticated backend route. The response retained `private, no-store` and `nosniff` protections. A second owner received the same 404 boundary as a missing prescription.
- Revision 1 persisted `Examplemed Revision One`, survived reload, and was confirmed.
- Revision 2 persisted `Examplemed Revision Two` at 20 mg and was confirmed.
- Both confirmations ran the genuine existing Python confirmed-review adapter through Layers 4-5 and were finalized through `meddecode_finalize_review_result_v1` under `meddecode_scoped_worker`.
- The current results endpoint returned Revision 2. Result history contained exactly two rows, one current; Revision 1 remained immutable and non-current.
- The browser revision-history dialog displayed both revisions.
- Test cleanup removed the exact prescription, jobs, scopes, review rows, result rows, projections, and fictional document. Independent post-run counts were `0|0|0|0`, and the file was absent.
- Express and Vite stopped after Playwright. The isolated PostgreSQL cluster was stopped explicitly.

## Test results

- Genuine Phase 1F Playwright: 1/1 passed.
- Existing prescription-review Playwright regression: 12/12 passed.
- Backend full suite: 547/547 passed.
- Frontend unit suite: 325/325 passed.
- Python full suite: 415/415 passed (two non-failing dependency/cache warnings).
- Backend TypeScript typecheck and production build: passed.
- Frontend TypeScript typecheck and production build: passed; existing bundle-size advisory only.
- Changed-file ESLint: passed.
- `git diff --check`: passed; existing line-ending notices only.

## Security and boundaries

- Local test authentication cannot be reached through normal application startup and cannot be constructed without two distinct 32-byte secrets plus the explicit isolation assertion.
- Test identities are fixed fictional UUIDs and are restricted by the same owner-scoped review functions used by the application.
- No in-memory review repository is used.
- No hosted Supabase, AWS, hosted worker, Google OCR, TrOCR, Contract v1 change, or memory-limit change is involved.
- `MEDDECODE_PRESCRIPTION_REVIEW_V3_ENABLED=false` and `PROCESSING_WORKER_ENABLED=false` remain the ordinary-environment defaults.
- The local cluster is retained, stopped, at `C:\Users\dahiy\MedDecode\tmp\phase1f-pg17`. Controlled removal may delete that exact directory only after confirming the cluster is stopped; the acceptance fixture itself is already removed.

## Final status

BROWSER_TO_EXPRESS: VERIFIED

TEST_AUTH_ISOLATION: VERIFIED

EXPRESS_TO_POSTGRESQL: VERIFIED

TWO_REVISION_BROWSER_FLOW: VERIFIED

INTELLIGENCE_FINALIZATION: VERIFIED

RESULT_HISTORY: VERIFIED

PRIVATE_PREVIEW: VERIFIED

OWNER_ISOLATION: VERIFIED

PLAYWRIGHT_E2E: VERIFIED

LOCAL_FULL_APPLICATION_DEMO: VERIFIED

HOSTED_MIGRATIONS_EXECUTED: NO

HOSTED_WORKERS_ENABLED: NO

READY_FOR_FINAL_DEMO: YES
