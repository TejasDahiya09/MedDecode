# MedDecode Platform Issue Register

**Snapshot:** 2026-11-17, branch `integration/full-project`
**Conventions:** Confirmed means reproduced by command, direct source inspection, or a recorded runtime symptom with an exact path. Suspected means plausible but requiring a controlled reproduction. Severity reflects release and patient-safety risk, not implementation effort.

## Summary

| Severity | Confirmed open | Suspected/open verification | Fixed but not released |
|---|---:|---:|---:|
| Critical | 0 | 0 | 0 |
| High | 4 | 2 | 2 |
| Medium | 6 | 3 | 2 |
| Low | 5 | 0 | 0 |

No critical issue was proven in this audit. That does not mean hosted security is verified; hosted parity was out of scope and is tracked as a high-severity verification blocker.

## Register

### AUD-REL-001 — Working tree and database lineage are not reproducible

- **State / severity:** CONFIRMED OPEN / HIGH
- **Module:** repository and release engineering
- **Location:** repository-wide; especially `backend/database/integration-migrations/`
- **Description:** 490 paths differ from Git: 103 modified, 386 untracked, 1 deleted. Nineteen migration directories are untracked.
- **Reproduction:** `git status --short`; count states; inspect `git status --short backend/database/integration-migrations`.
- **Expected:** reviewed source and deployed migration candidates are traceable to an immutable revision; generated/private artifacts are ignored.
- **Actual:** a fresh checkout cannot reproduce the audited platform or migration lineage.
- **Root cause:** long-running parallel work accumulated without an integration/release checkpoint.
- **Impact:** code loss/overwrite risk, impossible rollback provenance, uncertain deployed-to-source parity.
- **Fix:** classify every path by owner; exclude generated/private data; review and integrate source/migrations in bounded changesets without discarding concurrent work.
- **Tests:** fresh-clone build/typecheck/test; migration hash manifest comparison; secret scan.
- **Dependencies:** all batches.

### AUD-INT-001 — Unverified numbered rows leak into Contract v1 medicines

- **State / severity:** CONFIRMED OPEN / HIGH
- **Module:** Python Layers 1-2 and Contract v1 mapping
- **Location:** `intelligence/app/layer2_information_extraction/pipeline.py:57-84`, `intelligence/app/integration/contract_v1_mapper.py:68-100`, failing assertion `intelligence/tests/layer2/test_numbered_medicine_rows.py:112`
- **Description:** four rows marked `unverified_numbered_rows` also become medicine records in the mapped response.
- **Reproduction:** `intelligence/.venv/Scripts/python.exe -m pytest intelligence/tests -q`.
- **Expected:** unverified rows remain evidence/warnings for human correction and are absent from `medicines`.
- **Actual:** fixed locally: the four review-only rows remain evidence/warnings and zero medicines are emitted from them.
- **Root cause:** unverified-row detection annotates OCR pages but does not exclude overlapping extracted medicine entries before Contract mapping.
- **Impact:** uncertain text can reach matching/recommendation and review as if it were a medicine.
- **Fix:** Layer 2 now reconciles page/block provenance before Layers 3-5, fails closed on ambiguous provenance, and carries an internal eligibility invariant through Layer 4 and Contract mapping.
- **Tests:** original regression plus copied/overlapping evidence, missing provenance, multipage isolation, adjacent valid medicine, legitimate numbered medicines, Layer 4 exclusion, Contract v1 defense, and the full 447-test Python suite.
- **Dependencies:** Batch 2.

### AUD-DB-001 — Reminder security integration tests use a cwd-dependent duplicated path

- **State / severity:** CONFIRMED OPEN / HIGH
- **Module:** database security test harness
- **Location:** `backend/tests/reminders-security-fix-pg17-disposable-integration.test.ts:14-15`, `backend/tests/reminders-security-v2.pg17.test.ts:14-15`
- **Description:** running the documented backend suite from `backend/` resolves `process.cwd()/backend/database`, producing `backend/backend/database` and ENOENT.
- **Reproduction:** `npm --prefix backend test` or `npm test` from `backend/`.
- **Expected:** tests resolve repository paths from the module location or a verified repository root.
- **Actual:** two independent security tests fail before executing SQL.
- **Root cause:** cwd is treated as repository root although npm sets it to the package directory.
- **Impact:** reminder ACL/RLS repairs are not continuously verified; a security regression may ship unnoticed.
- **Fix:** use `import.meta.url`/`fileURLToPath` or a single tested repo-root helper; never weaken SQL assertions.
- **Tests:** execute from repository root and backend directory; fresh disposable PG17 baseline.
- **Dependencies:** Batch 1, then Batch 3.

### AUD-DB-002 — Current hosted Reminder ACL/RLS parity is not independently established

- **State / severity:** SUSPECTED / HIGH
- **Module:** Supabase PostgreSQL Reminders
- **Location:** migrations `202611160001`, `202611160009`, `202611160012`
- **Description:** source contains multiple reminder security repair generations, while the current local security harness is broken and this audit did not query hosted catalogs.
- **Reproduction:** separately authorized aggregate/catalog-only hosted preflight plus corrected PG17 suite.
- **Expected:** exact eight policies, correct Cabinet outer-row correlation, anon/PUBLIC zero privileges, authenticated CRUD only, composite owner FK, dose uniqueness.
- **Actual:** source intent exists; current hosted state is unverified in this audit.
- **Root cause:** historical remediation plus broken continuous verification and untracked migration sources.
- **Impact:** possible owner-isolation or privilege drift.
- **Fix:** first repair local tests; then run read-only `pg_policy`, ACL, membership, FK, index, and effective-privilege checks under an explicit approval.
- **Tests:** full attack matrix with real roles; hosted catalog parity.
- **Dependencies:** AUD-REL-001, AUD-DB-001.

### AUD-QA-001 — Backend repository typecheck fails

- **State / severity:** CONFIRMED OPEN / HIGH
- **Module:** backend tests/tools
- **Location:** `confirmed-review-intelligence.client.test.ts:14-15`, `prescription-review-initial-completion.pg17.test.ts:24`, `reminders-migration-and-persistence.test.ts:14`, `reminders.test.ts:8,104`
- **Description:** `npm --prefix backend run typecheck` returns six TypeScript diagnostics.
- **Reproduction:** run the command above.
- **Expected:** production and tools/test TypeScript projects compile with no errors.
- **Actual:** TS1470, TS2769, TS2307, and TS2379.
- **Root cause:** mixed module assumptions, readonly PG parameter typing, wrong import paths, and incomplete Express response mock typing.
- **Impact:** test code can drift from production contracts; CI cannot use typecheck as a gate.
- **Fix:** align test module configuration and imports; use correct PG query configuration types and typed response fixtures.
- **Tests:** backend typecheck, build, full suite.
- **Dependencies:** Batch 1.

### AUD-QA-002 — Full backend suite is red

- **State / severity:** CONFIRMED OPEN / HIGH
- **Module:** backend-wide
- **Location:** four failures described in the master audit
- **Description:** 582 pass, 4 fail, 3 skip out of 589.
- **Reproduction:** `npm --prefix backend test`.
- **Expected:** zero failures from the supported package command.
- **Actual:** three PG17/reminder failures and one resource-sensitive local-Python timeout.
- **Root cause:** path defects plus full-suite resource contention/timeout sensitivity.
- **Impact:** no dependable regression signal.
- **Fix:** correct path handling, diagnose PG17 test independently, then bound/schedule heavyweight subprocess tests without hiding genuine timeouts.
- **Tests:** repeated full runs on clean process state; targeted subprocess timeout tests.
- **Dependencies:** AUD-DB-001, AUD-BE-001.

### AUD-E2E-001 — No current signed-in composed V3 browser acceptance evidence

- **State / severity:** SUSPECTED COVERAGE GAP / HIGH
- **Module:** browser -> Express -> PostgreSQL -> worker -> Python
- **Location:** frontend Playwright suites and V3 workflow
- **Description:** unit/integration evidence is broad, but this audit did not execute the full fictional Upload -> Review -> Confirm -> Result -> History flow.
- **Reproduction:** controlled isolated account/data run with no unrelated job eligibility.
- **Expected:** a repeatable, non-hosted or explicitly authorized acceptance test proves each pause and ownership boundary.
- **Actual:** historical phase reports exist; no current run against this 490-path working tree.
- **Root cause:** acceptance requires coordinated services, credentials, database state, and job authorization.
- **Impact:** composition/configuration defects can escape unit suites.
- **Fix:** create a current, isolated acceptance runbook and evidence artifact; do not reuse unrelated hosted jobs.
- **Tests:** desktop/mobile Playwright with API/database aggregate assertions.
- **Dependencies:** Batches 1-5.

### AUD-BE-001 — Local Python adapter test is timeout-sensitive under full load

- **State / severity:** CONFIRMED OPEN / MEDIUM
- **Module:** backend subprocess integration
- **Location:** `backend/src/services/local-python-intelligence.client.ts:124`, `backend/tests/local-python-intelligence.client.test.ts:75`
- **Description:** the Contract v1 local-PDF adapter timed out in the full parallel suite but all 22 file tests passed alone, including the same test in ~1.2 s.
- **Reproduction:** full backend suite; compare focused file run.
- **Expected:** deterministic timeout behavior under supported test parallelism.
- **Actual:** a false timeout occurs under contention.
- **Root cause:** heavyweight Python subprocesses compete in the default Node test runner; deadline lacks test-runner scheduling headroom or isolation.
- **Impact:** flaky CI and pressure to raise production timeouts incorrectly.
- **Fix:** isolate/serialize heavyweight integration tests or provide a test-only bounded deadline justified by measurements; retain production timeout tests.
- **Tests:** repeated full suite under normal CI load and explicit timeout/termination cases.
- **Dependencies:** Batch 4.

### AUD-WF-001 — Document preview historically returns an opaque 503

- **State / severity:** CONFIRMED RUNTIME SYMPTOM, ROOT CAUSE OPEN / MEDIUM
- **Module:** review document preview
- **Location:** `backend/src/services/prescription-document-preview.service.ts:47-70`, route `prescription-document-preview.routes.ts:20-22`
- **Description:** a prior controlled V3 run returned preview unavailable while structured review persisted. Almost all DB, metadata, S3, abort, and stream errors map to `UNAVAILABLE` and then one 503.
- **Reproduction:** owner-authenticated GET `/api/v1/prescriptions/:id/document/preview` for the known fictional prescription in a controlled environment.
- **Expected:** preview works or produces a sanitized diagnostic category that distinguishes configuration, metadata, storage, timeout, and stream failures.
- **Actual:** client receives only `DOCUMENT_PREVIEW_UNAVAILABLE`; root cause is not observable.
- **Root cause:** broad catches intentionally sanitize but discard stage/category telemetry.
- **Impact:** review usability degraded; operators cannot repair storage/configuration safely.
- **Fix:** add privacy-safe internal stage/category logging and metrics; retain generic client response. Keep structured review usable without preview.
- **Tests:** owner/cross-owner, bucket mismatch, S3 denied/not-found/timeout, oversized and malformed stream.
- **Dependencies:** Batch 4.

### AUD-OBS-001 — Worker listener-growth warning is unresolved

- **State / severity:** SUSPECTED / MEDIUM
- **Module:** launcher/worker process streams
- **Location:** controlled worker runtime; historical `MaxListenersExceededWarning` on `WriteStream`
- **Description:** a completed run reported 11 error listeners on a WriteStream. Focused tests did not reproduce it.
- **Reproduction:** run one controlled fictional worker with `--trace-warnings` in an isolated environment; inspect listener attach/detach counts.
- **Expected:** bounded listeners across start, process, exit, and restart.
- **Actual:** warning occurred once; ownership of the accumulating listener is unknown.
- **Root cause:** possibly repeated stream piping or signal/error registration; not yet proven.
- **Impact:** memory leak and duplicate log/error handling over long sessions.
- **Fix:** instrument listener registration and cleanup; do not globally raise listener limits.
- **Tests:** repeated worker lifecycle and shutdown without warnings.
- **Dependencies:** Batch 4.

### AUD-OBS-002 — Preview error sanitization lacks actionable server telemetry

- **State / severity:** CONFIRMED OPEN / MEDIUM
- **Module:** backend observability
- **Location:** `prescription-document-preview.service.ts:55-69`
- **Description:** provider exceptions are converted to a code with no preserved safe stage, provider status class, or correlation metadata.
- **Reproduction:** inspect catch blocks; simulate each dependency failure.
- **Expected:** no sensitive leakage to client, but internal structured stage/category/correlation logs.
- **Actual:** diagnosis requires code instrumentation or provider logs.
- **Root cause:** sanitization was implemented without parallel structured telemetry.
- **Impact:** slow incident response.
- **Fix:** structured sanitized logging keyed by request/prescription ID, never object keys or payloads.
- **Tests:** log allowlist/denylist assertions.
- **Dependencies:** Batch 4.

### AUD-UI-001 — Frontend main bundle exceeds the build threshold

- **State / severity:** CONFIRMED OPEN / MEDIUM
- **Module:** frontend performance
- **Location:** Vite production output
- **Description:** main JavaScript is 962.14 kB minified (261.11 kB gzip), triggering the 500 kB warning.
- **Reproduction:** `npm --prefix frontend run build`.
- **Expected:** route/provider chunks keep initial protected-shell load bounded.
- **Actual:** most application code ships in one main chunk.
- **Root cause:** limited route-level lazy loading/manual chunking.
- **Impact:** slow first load and parse on mobile/low-end devices.
- **Fix:** lazy-load workspace features and split vendor/OCR-independent UI chunks; measure rather than suppress warning.
- **Tests:** bundle budget, cold-load Lighthouse/Web Vitals, route smoke tests.
- **Dependencies:** Batch 6.

### AUD-UI-002 — Navigation describes implemented features as future placeholders

- **State / severity:** CONFIRMED OPEN / LOW
- **Module:** frontend navigation
- **Location:** `frontend/src/app/navigation.ts:17-18`
- **Description:** Cabinet and Reminders descriptions say “future” although functional pages and APIs exist.
- **Reproduction:** inspect navigation/search descriptions.
- **Expected:** current, accurate capability descriptions without clinical overclaim.
- **Actual:** stale placeholder copy.
- **Root cause:** navigation copy not updated with feature implementation.
- **Impact:** examiner/user confusion and reduced discoverability.
- **Fix:** update copy after feature/security readiness is confirmed.
- **Tests:** navigation/search copy assertions.
- **Dependencies:** Batch 6.

### AUD-QA-003 — Frontend lint gate fails

- **State / severity:** CONFIRMED OPEN / LOW
- **Module:** Playwright test code
- **Location:** `frontend/tests/e2e/genuine-hosted-results-verification.spec.ts:15,61`
- **Description:** `no-explicit-any` and `no-useless-assignment` fail `eslint --max-warnings 0`.
- **Reproduction:** `npm --prefix frontend run lint`.
- **Expected:** lint clean.
- **Actual:** two errors.
- **Root cause:** loosely typed response helper and dead initial assignment.
- **Impact:** CI gate failure and weaker test contract typing.
- **Fix:** type the response shape and remove the unused assignment.
- **Tests:** lint and the affected Playwright test.
- **Dependencies:** Batch 1 or 6.

### AUD-INT-002 — Manual-review exclusion is not a single invariant

- **State / severity:** FIXED LOCALLY / MEDIUM
- **Module:** intelligence evidence/reconciliation
- **Location:** numbered-row detection, Layer 2 extraction, Contract mapper
- **Description:** classification and exclusion are separate operations, allowing the AUD-INT-001 overlap.
- **Reproduction:** current failing Python test.
- **Expected:** one provenance-aware invariant controls whether evidence may become a medicine identity.
- **Actual:** fixed locally: source page/block provenance determines automatic identity eligibility before matching, while mapper and Layer 4 enforce the same fail-closed signal.
- **Root cause:** pipeline stages communicate lists without stable exclusion linkage.
- **Impact:** future extractors can reintroduce unsafe promotion.
- **Fix:** stable page/block indexes plus exact block fingerprints and geometric overlap provide the linkage; `automatic_identity_eligible` is the explicit internal disposition consumed by later layers.
- **Tests:** provenance intersection, copied evidence, ambiguous provenance, adjacent and multipage separation, and mapper/Layer 4 defense-in-depth regressions.
- **Dependencies:** Batch 2.

### AUD-INT-003 — Genuine OCR/resource behavior was not revalidated for this tree

- **State / severity:** SUSPECTED COVERAGE GAP / MEDIUM
- **Module:** FastAPI/EasyOCR/PaddleOCR
- **Location:** `intelligence/app/integration/http_service.py`, supervisor and Layer 1
- **Description:** full unit regression ran, but no genuine PDF/JPEG/PNG inference or process-tree measurement was repeated.
- **Reproduction:** privacy-safe fictional harness with adaptive off/on, TrOCR off.
- **Expected:** current evidence for bytes/pages/pixels/memory/timeout/cleanup and provider routing.
- **Actual:** historical evidence only; one Python regression is red.
- **Root cause:** genuine models are expensive and should not be casually repeated during static audits.
- **Impact:** resource/configuration drift could be missed.
- **Fix:** run after Batch 2 in a controlled sequential environment.
- **Tests:** genuine formats, corrupt/decompression cases, cancellation, no orphan tree.
- **Dependencies:** Batch 7.

### AUD-DEP-001 — Cloud OCR is a mandatory Python dependency despite local-default policy

- **State / severity:** CONFIRMED OPEN / MEDIUM
- **Module:** Python packaging/provider surface
- **Location:** `intelligence/requirements.txt:10`, Google provider branches in Layer 1 and local worker
- **Description:** `google-cloud-vision` is installed in the base requirements even though cloud OCR must remain explicit and disabled by default.
- **Reproduction:** inspect requirements and provider selection.
- **Expected:** local baseline installs only local runtime; cloud providers are optional extras with explicit credentials/approval.
- **Actual:** cloud SDK is always part of the environment and supply chain.
- **Root cause:** provider experiments were added to one flat requirements file.
- **Impact:** larger install/attack surface and accidental configuration complexity; no evidence of an actual cloud call.
- **Fix:** split locked base/dev/provider requirement groups and retain explicit runtime allowlisting.
- **Tests:** base install runs all local tests without cloud SDK; provider-specific tests in optional job.
- **Dependencies:** Batch 7.

### AUD-OPS-001 — Windows launcher shutdown is forceful, not graceful

- **State / severity:** CONFIRMED KNOWN LIMITATION / MEDIUM
- **Module:** root development launcher
- **Location:** `docs/platform-local-runtime.md`, `scripts/dev-launcher.cjs`
- **Description:** Windows cleanup uses `taskkill /T /F` for bounded tree termination.
- **Reproduction:** inspect launcher and runtime documentation.
- **Expected:** graceful signal/drain phase followed by bounded force termination.
- **Actual:** in-flight OCR can be terminated forcefully.
- **Root cause:** cross-platform process-tree cleanup limitations.
- **Impact:** interrupted local request and incomplete diagnostics; database fencing limits persistent corruption.
- **Fix:** staged shutdown with child acknowledgment, then taskkill fallback.
- **Tests:** in-flight cancellation, port release, no orphan children.
- **Dependencies:** Batch 4 or 8.

### AUD-DOC-001 — Root README contradicts the actual launcher

- **State / severity:** CONFIRMED OPEN / LOW
- **Module:** documentation
- **Location:** `README.md:15` versus root `package.json`
- **Description:** README says no root-level start command; root provides `dev`, `build`, `test`, and E2E scripts.
- **Reproduction:** compare files.
- **Expected:** documented supported root workflow.
- **Actual:** new contributors are directed to three manual terminals.
- **Root cause:** README predates launcher integration.
- **Impact:** duplicate services, wrong environment loading, and inconsistent startup.
- **Fix:** document `npm run dev` as primary, manual service starts as troubleshooting.
- **Tests:** documentation command smoke in CI.
- **Dependencies:** Batch 8.

### AUD-DOC-002 — Historical phase reports are not a current release manifest

- **State / severity:** CONFIRMED OPEN / LOW
- **Module:** documentation/evidence
- **Location:** `backend/docs/`, `intelligence/docs/`
- **Description:** many phase reports contain dated pass counts and deployment statements without one current index.
- **Reproduction:** list docs and compare claims with current failing suites.
- **Expected:** current release evidence distinguishes executed-now, historical, hosted-verified, and unverified.
- **Actual:** readers can mistake an older 547/415 pass report for current status.
- **Root cause:** phase-by-phase development without consolidation.
- **Impact:** incorrect readiness decisions.
- **Fix:** generate a release evidence manifest with commit/hash, date, environment, command, result, and authorization scope.
- **Tests:** doc-link checker and freshness rule.
- **Dependencies:** Batch 8.

### AUD-QA-004 — Python suite emits a dependency deprecation warning

- **State / severity:** CONFIRMED OPEN / LOW
- **Module:** Python test dependencies
- **Location:** Starlette TestClient import of deprecated AnyIO alias
- **Description:** all HTTP tests emit a deprecation warning from installed Starlette/TestClient compatibility.
- **Reproduction:** full Python suite.
- **Expected:** warning-clean supported dependency set or explicitly tracked upstream warning.
- **Actual:** one deprecation warning.
- **Root cause:** current Starlette/AnyIO API transition.
- **Impact:** future upgrade may become breaking; currently no functional failure.
- **Fix:** pin/upgrade a verified compatible set and remove suppression only after validation.
- **Tests:** full Python suite with deprecations treated as errors in a canary job.
- **Dependencies:** Batch 7.

### AUD-WF-002 — Review status uses multiple domain states across prescription, job, review, and result

- **State / severity:** SUSPECTED DESIGN RISK / MEDIUM
- **Module:** frontend/backend V3 state model
- **Location:** results polling, review workspace, prescription/job/result APIs
- **Description:** initial OCR job completion is not final intelligence completion; UI correctness depends on composing prescription, review, job, and result state.
- **Reproduction:** exercise initial completed/review-pending, confirmed queued/processing/failed, and current-result states.
- **Expected:** one documented state projection with exhaustive transitions.
- **Actual:** recent fixes handle known cases, but no current property/exhaustive browser verification exists.
- **Root cause:** V3 evolved over a legacy prescription status field.
- **Impact:** “Results Ready” or failure messaging can regress.
- **Fix:** formalize and test a pure state projector used by timeline and controls; preserve API compatibility.
- **Tests:** transition table and browser cases for every state combination.
- **Dependencies:** Batch 5.

## Closed/recently corrected findings retained for regression

### AUD-FIX-001 — Supabase RPC method lost its receiver

- **State / severity:** FIXED LOCALLY / HIGH
- **Location:** `backend/src/repositories/postgres-prescription-review.repository.ts`
- **Prior defect:** extracting `client.rpc` and calling it unbound caused the owner review GET to return 503 with the real SDK.
- **Correction/evidence:** RPC is bound to the client; focused backend review/API tests passed 14/14 and production build passed.
- **Release requirement:** retain receiver regression and include in Batch 1 integration.

### AUD-FIX-002 — Template labels were accepted as medicine names

- **State / severity:** FIXED LOCALLY / MEDIUM
- **Location:** Layer 2 medicine extractor and Layer 3 parser
- **Prior defect:** values such as `Strength: Dosage form:` became medicine identities.
- **Correction/evidence:** label-only identities are rejected and adjacent labeled attributes are associated; 108 focused OCR/parser tests passed.
- **Remaining relation:** AUD-INT-001 proves a separate unverified-row promotion path still exists.

## Recommended disposition

Do not deploy or activate additional hosted behavior from this tree. Complete Batch 1, then Batch 2, rerun all gates, and only then perform the separately authorized Reminder/hosted parity checks in Batch 3.
