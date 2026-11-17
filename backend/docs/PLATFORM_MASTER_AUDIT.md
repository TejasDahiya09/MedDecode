# MedDecode Platform Master Audit

**Audit date:** 2026-11-17
**Repository:** `C:\Users\dahiy\MedDecode-integration`
**Branch:** `integration/full-project`
**Mode:** audit only; no hosted SQL, worker start, job processing, or application-data mutation

## 1. Executive conclusion

MedDecode has a coherent three-service architecture and substantial automated coverage, but this exact working tree is **not release-ready**. The frontend unit suite and both production builds pass. Authentication boundaries, owner-scoped repositories, the supervised Python process boundary, and restricted-worker fencing have meaningful test coverage. However, the current full backend and Python suites do not pass, backend tools typechecking and frontend lint do not pass, and the repository cannot be reproduced from Git because 386 paths are untracked, including 19 migration directories.

The most consequential functional defect is confirmed in the Python suite: rows explicitly classified as unverified are still emitted as Contract v1 medicines. That violates the intended manual-review boundary. Reminder security verification is also blocked by two integration tests resolving migration paths as `backend/backend/...`. These are release blockers even though the application production builds compile.

No claim is made here about current hosted schema parity. The audit did not query Supabase because this phase did not require hosted state and the code/repository failures already prevent a deployment recommendation.

## 2. Audit method and limits

Evidence was collected from source, configuration, migrations, documentation, Git state, and commands executed against the current tree. Tests were not weakened or deleted. No browser flow requiring authenticated hosted data was run, and no genuine OCR model inference was repeated. Those remain explicit acceptance gaps rather than assumed successes.

The audit inspected 109 frontend source files, 85 backend source files, 110 Python application files, 106 backend test files, 67 frontend test files, 78 Python test files, and 19 integration-migration directories. Generated dependencies were excluded.

## 3. Current validation baseline

| Gate | Result | Evidence |
|---|---:|---|
| Git branch | PASS | `integration/full-project` |
| Working-tree cleanliness | FAIL | 490 changed paths: 103 modified, 386 untracked, 1 deleted |
| `git diff --check` | PASS with line-ending warnings | No whitespace errors; multiple LF-to-CRLF warnings |
| Backend full test | FAIL | 589 total: 582 pass, 4 fail, 3 skip |
| Backend focused local-Python client | PASS | 22/22; the full-suite timeout did not reproduce alone |
| Backend production build | PASS | `tsc` completed |
| Backend typecheck | FAIL | 6 diagnostics across confirmed-review, PG17, and reminders tests |
| Frontend unit suite | PASS | 34 files, 376/376 tests |
| Frontend production build | PASS with warning | 962.14 kB main JS, 261.11 kB gzip |
| Frontend lint | FAIL | 2 errors in hosted-results Playwright spec |
| Python full suite | FAIL | 440 pass, 1 fail |
| Python dependency consistency | PASS | `pip check`: no broken requirements |
| Root launcher tests | PASS | 6/6 |
| Backend production dependency audit | PASS | 0 known npm advisories across 198 dependencies |
| Frontend production dependency audit | PASS | 0 known npm advisories across 355 dependencies |
| Authenticated browser E2E | NOT RUN | Would require a controlled signed-in environment and data boundary |
| Hosted database parity | NOT RUN | Read-only hosted verification deliberately excluded from this local audit |

### Exact failing tests and gates

1. `intelligence/tests/layer2/test_numbered_medicine_rows.py:112`: four unverified numbered rows appear in `response["medicines"]` instead of remaining warning-only.
2. `backend/tests/reminders-security-fix-pg17-disposable-integration.test.ts`: migration path resolves to `backend/backend/database/...`.
3. `backend/tests/reminders-security-v2.pg17.test.ts`: same duplicated path defect.
4. `backend/tests/reminders-pg17-disposable-integration.test.ts`: file-level PG17 integration test failed; its truncated full-run output needs an isolated diagnostic after path fixes.
5. `backend/tests/local-python-intelligence.client.test.ts`: timed out in the resource-contended full suite but passed 22/22 alone; this is a confirmed flake/timeout sensitivity, not a confirmed adapter failure.
6. Backend tools typecheck reports TS1470, TS2769, two TS2307 diagnostics, and TS2379.
7. Frontend lint reports `no-explicit-any` and `no-useless-assignment` in `genuine-hosted-results-verification.spec.ts`.

## 4. Architecture and data flow

### Frontend

React 19, React Router, TanStack Query, Vite, Supabase Auth, Vitest, and Playwright. Public auth/landing routes and protected workspace routes are composed in `frontend/src/app/App.tsx`. Protected application routes include Home, My Prescriptions, Upload Prescription, Medicine Library, comparison, Cabinet, Reminders, learning resources, prescription results, and review/edit.

The frontend uses bearer authentication through its API client. It does not connect directly to PostgreSQL. Development-only fictional routes are lazy/conditional and remain distinct from the ordinary V3 workflow.

### Backend

Express 5 composes public health, auth, profile, upload, history, result, V3 review, private-document preview, Cabinet, Reminders, catalogue, family-member, and processing routes in `backend/src/app.ts`. Supabase user clients preserve owner/RLS context for application reads and writes. PostgreSQL connections are used for reviewed RPC/repository paths and the restricted worker. AWS S3 stores private prescription objects.

The V3 review and preview routes are feature-gated. Automatic submission requires the durable job store. Development fixture intelligence requires explicit local paths and development mode.

### Intelligence service

FastAPI exposes `/health`, `/ready`, and the private `/api/v1/intelligence/process`. Requests require a constant-time bearer-token check, bounded metadata, streamed body-size enforcement, document magic/resource validation, and a single-request concurrency gate. Native OCR executes behind a supervised process boundary with timeout, memory, output, and cleanup controls. EasyOCR is the baseline; adaptive PaddleOCR and TrOCR are explicitly configured. Catalogue readiness requires a real restricted read-only connection.

### Database and worker

The repository contains migrations for queue submission/claim/finalization, official catalogue reads and pagination, review V1, result history, V3 worker RPCs, reminders and security repairs, rollout generations, initial-review completion, Generation 2 activation, and exact-job recovery. The restricted worker design uses dedicated identity, scoped RPCs, leases, attempt/claim-generation fences, one-job controls, and single-attempt operation. Because 19 migration directories are untracked, the reviewed/deployed database lineage is not reproducible from Git.

## 5. Feature inventory and current status

| Feature | Implementation | Audit status |
|---|---|---|
| Sign-up/sign-in/password flows | Supabase Auth + backend token verification | Implemented; backend auth tests pass |
| Dashboard | Protected React workspace with backend health/data cards | Implemented; frontend unit coverage passes |
| Prescription upload | Multipart validation, private S3, metadata, optional automatic submission | Implemented; live upload not repeated |
| Job status | Authenticated processing-status endpoints and frontend polling | Implemented; V3 browser acceptance not repeated |
| OCR | PDF/JPEG/PNG safety, EasyOCR, optional adaptive providers, supervised child | Implemented; full Python suite currently fails |
| Review initialization | OCR evidence to draft review, revision/lock version | Implemented; repository regression tests exist |
| Review editing/confirmation | Owner-scoped draft/update/confirm/reopen | Implemented; signed-in browser acceptance outstanding |
| Confirmed intelligence | Layers 4-5 and revision-bound finalization | Implemented; focused real adapter test passes |
| Results/history | Current and immutable revision results | Implemented; current live API not audited here |
| Document preview | Owner-scoped metadata + private S3 stream | Implemented; historical 503 remains unresolved |
| Medicine Library | Official catalogue browse/search/detail/compare RPC APIs | Implemented; current hosted parity not checked |
| Medicine Cabinet | Authenticated CRUD and owner-scoped repository | Implemented; navigation description is stale |
| Reminders/dose logs | Authenticated CRUD, dose log, RLS migrations | Implemented; PG17 security suite currently broken |
| Family members/profile | Authenticated CRUD/owner boundaries | Implemented; backend tests pass |
| Learn/resources | Workspace destination/static UI | Present; content depth not clinically audited |
| Root runtime | Frontend + backend + FastAPI; worker opt-in | Launcher unit tests pass |
| Restricted worker | Scoped RPC, dedicated login, concurrency one, fencing | Strong unit coverage; no worker started in audit |

## 6. Workflow findings

### Upload to review

The intended path is upload -> durable initial job -> genuine OCR/Layers 2-3 -> evidence and draft review -> initial-job completion without an intelligence result. Migration 010 and the RPC store encode this separation. The current Python regression shows that unverified numbered rows can nevertheless enter Contract v1 medicines, so the human-review boundary is not consistently enforced at the mapping boundary.

### Review to results

The frontend preserves revision and lock version and navigates to prescription status after confirmation. The confirmed-review adapter sends only canonical confirmed fields, executes Layers 4-5, and persists through fenced RPCs. Unit tests cover duplicate confirmation and stale-claim behavior. A current authenticated browser run is still required to prove the composed user flow.

### Failure and recovery

Revision-specific failure fencing and exact-job recovery artifacts exist. Tests cover restricted function names, stale generations, leases, worker identity, and safe error mapping. Operational recovery remains intentionally approval-bound and must not become an automatic retry path.

## 7. Security and privacy assessment

### Confirmed strengths

- The frontend receives no worker or internal-service credentials in launcher tests.
- Authenticated application requests use user-scoped Supabase clients; the frontend never receives PostgreSQL credentials.
- Health endpoints do not claim jobs; worker construction performs no execution.
- Production CORS and Supabase URL parsing fail closed.
- Upload and intelligence boundaries cap bytes and timeout values.
- FastAPI disables public API documentation and compares the internal bearer token in constant time.
- S3 object metadata is owner-queried before private retrieval.
- Worker transports allowlist exact RPC function names and sanitize provider failures.
- `.env` files are ignored at root and service levels.
- `npm audit --omit=dev` reports no known production advisories; `pip check` reports a consistent environment.

### Security/deployment gaps

- Reminder security cannot be independently accepted while its disposable PG17 tests do not run from the documented backend command.
- Migration sources that define deployed security boundaries are untracked.
- Hosted ACL/RLS/function parity was not checked; source review cannot substitute for catalog evidence.
- `google-cloud-vision` is installed as a mandatory Python dependency and cloud provider branches remain compiled, despite the normal local policy being cloud-disabled. Activation is explicit, but the dependency and configuration surface are larger than necessary.
- Document-preview failures collapse most database, metadata, AWS, timeout, and stream errors into one 503, limiting safe diagnosis.

## 8. UX, accessibility, and performance

The frontend has skip links, protected routing, responsive navigation, loading/error/empty-state components, and broad unit coverage. The V3 review UI does not fabricate results and treats confirmation as transcription confirmation rather than clinical validation.

Outstanding issues include stale navigation copy describing Cabinet and Reminders as future features, no current signed-in browser acceptance in this audit, and a 962.14 kB minified main JavaScript chunk. The build warning indicates route-level code splitting is insufficient. Accessibility must be revalidated in a real browser for keyboard focus, modal behavior, small screens, and result/review state announcements.

## 9. Maintainability and documentation

The service boundaries and tests are generally explicit, but the working tree combines extensive concurrent implementation, migrations, documents, reports, fixtures, and generated artifacts. Root `README.md` incorrectly says no root-level start command even though `npm run dev`, `npm test`, and `npm run build` exist. Feature descriptions for Cabinet and Reminders are stale. Multiple phase reports provide useful evidence but increase the risk of treating historical results as current; a single release evidence index is needed.

## 10. Prioritized fix batches

### Batch 1 — Restore a trustworthy release baseline (P0)

Resolve AUD-REL-001, AUD-DB-001, AUD-QA-001, and AUD-QA-002. Inventory every untracked artifact, preserve concurrent work, place reviewed source/migrations under version control only after owner review, fix path-independent PG17 harnesses, and make typecheck/lint/full suites deterministic. Exit: cleanly reproducible checkout and all static gates pass.

### Batch 2 — Enforce the clinical extraction boundary (P0)

Resolve AUD-INT-001 and AUD-INT-002. Ensure unverified numbered rows never enter Contract v1 medicines, preserve them as warning/evidence only, and run genuine synthetic PDF/JPEG/PNG regression with label/value ambiguity. Exit: full Python suite passes and no uncertain row is silently promoted.

### Batch 3 — Re-establish Reminders database assurance (P0)

Resolve AUD-DB-002. Run migrations 001/009/012 from a fresh PG17 baseline, execute the complete owner/anon/authenticated/worker negative matrix, and perform separately authorized hosted read-only catalog verification. Exit: local security suite and hosted parity evidence both pass.

### Batch 4 — Backend reliability and observability (P1)

Resolve AUD-BE-001, AUD-OBS-001, and AUD-OBS-002. Classify preview failures without exposing secrets, reproduce listener growth with traces, and make subprocess timeouts resilient under the full suite. Exit: useful sanitized stage diagnostics and no listener/timeout flakes.

### Batch 5 — V3 composed workflow acceptance (P1)

Resolve AUD-E2E-001 and AUD-WF-001. Run a fictional signed-in Upload -> OCR -> Review -> Confirm -> Result -> History test with isolated data, proving no result before confirmation, immutable history, and owner isolation. Exit: browser/API/database evidence captured without touching unrelated jobs.

### Batch 6 — Frontend quality, accessibility, and performance (P1)

Resolve AUD-UI-001, AUD-UI-002, and AUD-QA-003. Split the main bundle by route, correct stale copy, fix Playwright lint, and run desktop/mobile keyboard and screen-reader-state checks. Exit: build without chunk warning, lint pass, critical browser scenarios pass.

### Batch 7 — Intelligence/provider hardening (P2)

Resolve AUD-INT-003 and AUD-DEP-001. Make optional cloud providers optional dependency groups, keep cloud execution disabled by default, validate model/provider availability, and measure supervised memory/timeout behavior sequentially. Exit: baseline local path remains reproducible with no cloud package or credentials required.

### Batch 8 — Documentation and operational consolidation (P2)

Resolve AUD-DOC-001 and AUD-DOC-002. Update root commands, current feature status, deployment-state caveats, rollback/backup boundaries, and create a current release-evidence index that distinguishes current execution from historical phase reports.

## 11. Recommended first batch

Start with **Batch 1**, immediately followed by **Batch 2**. A repository whose migrations and tests are not reproducible cannot safely accept deeper fixes, while the unverified-row promotion is the first functional safety defect to correct once the baseline is stable.

## 12. Release decision

**Platform readiness:** NO-GO.
**Reason:** failed backend/Python/static gates, unreproducible migration/source state, and a confirmed review-boundary regression.
**Hosted mutation recommendation:** none; resolve and independently verify local blockers first.

The detailed, deduplicated findings and acceptance tests are in `PLATFORM_ISSUE_REGISTER.md`.
