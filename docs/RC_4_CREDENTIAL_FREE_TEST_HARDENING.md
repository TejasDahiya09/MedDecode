# RC-4 Credential-Free Test Hardening

Date: 2026-11-19
Branch: `main`
RC-3 commit: `a50467e4e19925f1cf6cc0b45d0c17092a996b06`
Status: COMPLETE for the authorized local RC-4 scope; hosted execution remains RC-2 approval-gated

## Scope and security boundary

RC-4 reviewed the 11 browser specifications retained outside Git at `C:\Users\dahiy\MedDecode\pr-conflict-preservation-20261117`. Only filenames, hashes, test titles, environment-variable names, and counts of credential-shaped assignments were emitted during review. No credential value was printed, copied into this report, or added to Git. The originals remain unchanged in the private directory.

The private set contains one hardcoded identity assignment and two hardcoded secret/token assignments per file. Regardless of whether some literals were originally synthetic, those files are treated as credential-bearing and remain prohibited from Git.

No hosted browser session, Supabase request, upload, application mutation, or worker execution occurred.

## Private specification assessment

### Supported behavior retained through safe current tests

| Private file | Current disposition |
| --- | --- |
| `compare-medicines-live-verification.spec.ts` | Current comparison route remains supported. Covered by versioned comparison tests and the new approval-gated hosted workspace smoke test. Private source not copied. |
| `medicine-cabinet-live-verification.spec.ts` | Cabinet authentication and current route remain supported. Covered by unit/API tests and the approval-gated hosted workspace smoke test. Mutating hosted flows require separate authorization. |
| `prescription-workflow-live-verification.spec.ts` | Current workflow is supported. Replaced by the credential-free isolated RC-1B acceptance and existing review/results tests. No hosted upload is performed by RC-4. |
| `prescription-workflow.spec.ts` | Target-only overlapping workflow. Replaced by RC-1B plus current review, results, history, and responsive tests. Private source remains preserved. |
| `reminders-live-verification.spec.ts` | Current reminders route remains supported. Covered by current unit/API tests and the approval-gated hosted workspace smoke test. Hosted reminder mutations are not authorized. |
| `reminders-ui-verification.spec.ts` | Current empty/error/retry behavior is supported and covered by current tests. Historical assumptions are not restored. |

### Retired as release evidence

| Private file | Reason |
| --- | --- |
| `master-gallery.spec.ts` | Screenshot/gallery evidence generator with broad overlap and no stable release assertion contract. |
| `medicine-insights-premium.spec.ts` | Historical visual review duplicated by current component and responsive tests. |
| `medicine-library-capture.spec.ts` | Capture-oriented test writes visual artifacts and duplicates current catalogue/API tests. |
| `responsive-demonstration.spec.ts` | Broad demonstration capture superseded by focused responsive tests. |
| `visual-qa.spec.ts` | Large historical screenshot suite with overlapping, brittle visual assertions. |

Retirement means these private files are not restored to Git or counted as passing evidence. They were not deleted.

## Sanitized replacement

Three versioned files were added:

- `frontend/tests/e2e/support/hosted-test-credentials.ts`
- `frontend/tests/e2e/hosted-current-workflows.spec.ts`
- `frontend/tests/unit/hosted-test-credentials.test.ts`

The loader requires all of the following at runtime:

- `MEDDECODE_HOSTED_E2E_APPROVED=true`
- `MEDDECODE_E2E_TARGET_ORIGIN`
- `MEDDECODE_E2E_PROJECT_ID`
- `MEDDECODE_E2E_EMAIL`
- `MEDDECODE_E2E_PASSWORD`

It fails closed when approval or any credential is absent, requires HTTPS, rejects URL-embedded credentials, and accepts only project `wyripeqruhvbksjfsvlr`. The Playwright spec is skipped unless separately approved. It performs authentication and read-only navigation only; it contains no password, access token, refresh token, cookie, storage state, or hosted user identifier.

The focused loader suite passed four cases: missing approval, incomplete runtime input, wrong target/URL credentials, and valid allowlisted configuration. The actual hosted test was intentionally not run because this task contains no hosted access authorization.

## PostgreSQL approval gates

The three backend gates were classified independently:

1. `exact-job-recovery.pg17.test.ts` is an explicit opt-in test that creates a uniquely named database on loopback PostgreSQL 17 and cleans up its roles/database. With `MEDDECODE_EXACT_RETRY_PG17=true`, 39 tests passed with zero skips.
2. `v3-rpc-encoding.pg17.test.ts` is an explicit opt-in test using the same task-owned loopback server. With `MEDDECODE_RPC_PG17=true`, one genuine JSONB/scalar/fencing transport test passed with zero skips.
3. `prescription-review-initial-completion.pg17.test.ts` requires a separately prepared database through `MEDDECODE_INITIAL_REVIEW_TEST_DATABASE`. Review found that the harness hardcoded the `postgres` role, assumed fixed fixture rows, and counted unrelated results globally. It now accepts an explicit disposable administrative role and port, seeds only its fictional target rows, scopes result invariants to its target prescription, and makes the historical fixture replay-safe. The test passed against the reviewed port-55440 PostgreSQL 17 fixture without weakening any RPC assertion.

The first two suites used the already-running loopback PostgreSQL 17 service at port 5433. They created only unique disposable databases, used fictional identifiers, exercised real roles/RPC calls, and reported successful cleanup. The third used the reviewed Phase 1F disposable cluster on port 55440. In total, all three approval-gated suites executed: 41 tests passed, none failed, and none were skipped. No hosted connection was used.

## Verification

### Backend

- Full suite after the harness correction: 607 passed, 3 explicit opt-in tests skipped, 0 failed.
- The three Reminder private-cluster failures were traced to Windows `pg_ctl start`: under `ACERPREDATOR\CodexSandboxOffline`, `initdb` and task-owned temporary-directory creation succeeded, but `pg_ctl` failed while attempting to create another restricted token (`error 87`, followed by startup error 3). This was a sandbox token-composition failure, not a PostgreSQL, migration, ACL, or RLS failure.
- `private-postgres17.ts` now launches `postgres.exe` directly on Windows under the existing restricted identity, redirects output to the task-owned log file, polls readiness with a bounded deadline, retains random loopback port allocation, and performs bounded `pg_ctl` shutdown and exact-prefix cleanup. It does not elevate privileges or weaken any security assertion.
- All three affected Reminder suites then passed inside the restricted environment: 17 passed, 0 failed. No private cluster directory or listener remained.
- Approval-gated PostgreSQL suites run separately: 41 passed, 0 failed, 0 skipped.
- Typecheck: passed.
- Production type compilation passed to a task-owned output directory. The existing `backend/dist` ACL still prevents the restricted token from overwriting prior artifacts; no permission was escalated or changed.

### Frontend

- Full unit suite: 382 passed across 35 files.
- New hosted-configuration unit suite: 4 passed.
- Lint: passed.
- Typecheck: passed.
- Production build: passed; main application chunk remained 102.89 kB minified.
- Playwright: 6 credential-free local authentication tests passed; the new hosted workflow test was correctly skipped pending separate authorization.
- Isolated genuine RC-1B acceptance: 1 passed in 36.3 seconds, covering browser upload, supervised OCR, owner-bound draft review, explicit confirmation, Layers 4-5, result/history, and cleanup.

### Python and launcher

- Local/offline Python suite: 453 passed, 0 failed; five hosted Supabase cases remained excluded under the no-hosted-access boundary.
- Root launcher tests: 7 passed.
- `git diff --check`: passed.

## Secret and artifact checks

The new RC-4 source contains no embedded credential values or session storage. Pattern scans cover private-key headers, URL credentials, Supabase/service keys, AWS secrets, passwords, tokens, and common API-key assignments. No match was found in the RC-4 candidate files. Playwright traces were disabled and no hosted screenshot, cookie, storage-state file, or response payload was created.

The private originals remain hash-preserved outside Git. Historical credentials in those files must be independently confirmed rotated before the private copies can be destroyed; RC-4 makes no rotation claim.

## Remaining blockers and release implication

- The hosted workflow smoke test requires a separate target-specific authorization and runtime secret injection. It must not be enabled in ordinary CI.
- Historical secret rotation is unverified.
- Cross-owner hosted browser verification requires a second explicitly approved synthetic account and fixture and is not inferred from local mocks.

RC-4's local reliability and security scope is complete: the full backend suite is green, all three PostgreSQL approval gates ran, the genuine isolated browser workflow passed, and the hosted harness fails closed without runtime authorization. Actual hosted preview/browser execution and historical credential rotation remain separate RC-2 authorization boundaries rather than local RC-4 defects.

## Files changed

- `backend/tests/prescription-review-initial-completion.pg17.test.ts`
- `frontend/tests/e2e/support/hosted-test-credentials.ts`
- `frontend/tests/e2e/hosted-current-workflows.spec.ts`
- `frontend/tests/unit/hosted-test-credentials.test.ts`
- `docs/RC_4_CREDENTIAL_FREE_TEST_HARDENING.md`

Only the reviewed RC-4 source, tests, and documentation are included in finalization. Unrelated Batch 3 and workspace-cleanup reports remain untracked and untouched.

## Finalization record

This report is included in the single RC-4 commit. A Git commit cannot embed its own final SHA without changing that SHA, so the immutable commit identifier and push verification are recorded in the task's final execution report. The commit is pushed only after the explicit staged-file scan, `git diff --cached --check`, and origin synchronization gates pass.

RC-2 preparation is documented in `docs/RC_2_HOSTED_PREVIEW_VERIFICATION_PLAN.md`. Its runtime-only hosted test remains disabled pending target-specific authorization, fresh/rotated synthetic credentials, and an approved second account for the cross-owner denial check.

```text
RC_4_STATUS: COMPLETE_LOCAL
BROWSER_TESTS_REVIEWED: 11
SANITIZED_TESTS: 1 approval-gated E2E spec plus 1 four-case configuration unit suite
RETIRED_TESTS: 5 historical visual/capture specs; originals preserved privately
POSTGRESQL_TESTS: 58 real PostgreSQL 17 security/integration tests passed
BACKEND_TESTS: 607 passed, 3 explicit opt-in skips, 0 failed; all 3 skips passed separately
FRONTEND_TESTS: 382 passed; lint/typecheck/build passed
PYTHON_TESTS: 453 local/offline passed
PLAYWRIGHT: 7 passed, 1 correctly skipped
SECRET_SCAN: PASS for RC-4 candidates
HOSTED_MUTATIONS: NONE
```
