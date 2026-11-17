# Batch 1 Release Baseline

## Outcome

Batch 1 restored the executable local quality gates and preserved the interrupted working tree without resetting, cleaning, stashing, staging, committing, or overwriting unrelated work. The source and test corrections in this batch are verified, but the repository is not yet reproducible from a clean checkout because the working tree still contains a large body of unreviewed and untracked work, including 19 untracked migration directories.

**Batch 1 status: PARTIAL.** The repaired gates pass; release reproducibility remains blocked on team review and deliberate source-control lineage for the preserved work.

## Baseline Git State

- Repository: `C:\Users\dahiy\MedDecode-integration`
- Branch: `integration/full-project`
- HEAD: `503336431a31e47a38b98d6ff668818e7aa8d178`
- Preservation capture: `2026-11-17T12:32:44.8014522Z`
- Original collapsed porcelain view: 490 paths (103 modified, 386 untracked, 1 deleted)
- Expanded preservation inventory: 18,460 paths (103 modified, 18,356 untracked, 1 deleted)
- Current collapsed porcelain view after Batch 1 evidence and fixes: 495 paths (104 modified, 391 untracked)
- No destructive Git operation was used.

The expanded inventory records files inside untracked directories instead of treating each directory as a single porcelain entry. This accounts for the large difference between the two views.

## Preservation Evidence

- `backend/docs/batch-1-evidence/BATCH_1_PRESERVATION_MANIFEST.csv`
  - 18,460 baseline records.
  - Categories: configuration 6, documentation 107, generated 17,759, migration 102, other 27, private-risk 8, source 262, test 189.
  - 567 critical records carry both baseline and final SHA-256 values.
  - Eight intended Batch 1 test files changed hash after capture.
- `backend/docs/batch-1-evidence/BATCH_1_PRESERVATION_SUMMARY.json`
  - Captures branch, HEAD, timestamp, status counts, category counts, and ownership hints.
- `backend/docs/batch-1-evidence/BATCH_1_MIGRATION_HASHES.csv`
  - 115 files across all 20 current migration directories.
  - The preservation snapshot contained changed/untracked files from 19 untracked migration directories; the twentieth directory is clean and tracked.
  - No baseline migration candidate changed hash during Batch 1.
- `backend/docs/batch-1-evidence/BATCH_1_CHANGED_FILE_HASHES.csv`
  - Records baseline and final SHA-256 values for the eight modified test files.
  - Records final SHA-256 values for the two new Batch 1 support artifacts, for which no pre-creation hash exists.
- `backend/scripts/batch1-preservation-manifest.ps1`
  - Recreates the preservation inventory without reading or printing file contents.

Potentially sensitive filenames were identified without displaying their contents. They include the backend, frontend, and intelligence environment templates and the worker/backup credential scripts. The tracked-secret pattern scan identified only the backend environment example as a candidate configuration file; no committed live credential was established by this audit. The hosted browser test also contains environment-specific account configuration that needs owner review before publication even though its lint defects are fixed.

## Ownership and Parallel-Work Classification

- Generated artifacts: 17,759 paths; preserved and not treated as source.
- Intelligence/OCR ownership: 152 paths; not modified in Batch 1.
- Catalogue/Medicine Library ownership: 46 paths; preserved.
- Reminders/history ownership: 31 paths; existing work preserved while only test harness and typing defects were corrected.
- Unassigned/preserve: 472 paths; no broad rewrite performed.
- Migration candidates: preserved; none were staged, deployed, or rewritten by this batch.

## Files Changed by Batch 1

- `backend/tests/reminders-security-fix-pg17-disposable-integration.test.ts`
- `backend/tests/reminders-security-v2.pg17.test.ts`
- `backend/tests/reminders-pg17-disposable-integration.test.ts`
- `backend/tests/support/private-postgres17.ts` (new)
- `backend/tests/confirmed-review-intelligence.client.test.ts`
- `backend/tests/prescription-review-initial-completion.pg17.test.ts`
- `backend/tests/reminders-migration-and-persistence.test.ts`
- `backend/tests/reminders.test.ts`
- `frontend/tests/e2e/genuine-hosted-results-verification.spec.ts`
- `backend/scripts/batch1-preservation-manifest.ps1` (new)
- Batch 1 evidence files and this report.

## Defects, Causes, and Corrections

### AUD-REL-001 — unreproducible working tree and database lineage

The issue remains open as a release blocker. Batch 1 created a complete preservation manifest and independent migration hash inventory, but it did not infer ownership, stage, or commit the 19 untracked migration directories. A clean checkout therefore cannot reproduce the audited tree.

### AUD-DB-001 — cwd-dependent PostgreSQL 17 reminder tests

The reminder integration tests built migration paths from `process.cwd()`, causing different behavior from the repository root and backend package directory. SQL sources now resolve from the test module location. The tests use a task-owned PostgreSQL 17 cluster with a unique temporary data directory and loopback port.

The helper starts `postgres` through `pg_ctl` without inherited output pipes, enforces utility and server-start timeouts, validates every cleanup target beneath the task-specific temporary root, stops the cluster, and removes only task-owned resources. Final cleanup found zero `meddecode-batch1-pg17-*` directories and zero matching PostgreSQL processes. A pre-existing PostgreSQL service was not touched.

### AUD-QA-001 — backend typecheck diagnostics

The six reported diagnostics were resolved without `any`, `ts-ignore`, relaxed strictness, or test exclusion:

- CommonJS tests now use `__dirname` instead of `import.meta`.
- PostgreSQL argument arrays use the mutable parameter type expected by `pg`.
- Reminders tests import configuration from the actual `src` location.
- Express request/response mocks use explicit type-boundary casts.

### AUD-QA-002 — backend regression failures

- The reminder PG17 failures were test-harness defects, not weakened database assertions.
- The disposable reminder fixture now includes the actual Cabinet column required to reproduce the historical policy-correlation defect.
- Expected PostgreSQL failures run in independent transactions so one aborted transaction cannot mask subsequent assertions.
- Heavyweight tests run sequentially in the full backend command; no production timeout was increased.

### AUD-QA-003 — frontend lint failure

The hosted results Playwright test now uses the Supabase `Session` type instead of `any`, performs an explicit non-null session check, and removes the useless initial response-body assignment. Existing assertions and browser behavior were preserved.

## Verification Results

| Gate | Result | Evidence |
| --- | --- | --- |
| Reminder PG17 focused tests | PASS | 17 passed, 0 failed, 0 skipped; PostgreSQL 17.11 |
| Reminder path tests from repository root | PASS | 16 passed, 0 failed, 0 skipped |
| Backend full suite | PASS | 600 passed, 0 failed, 3 skipped; 603 total |
| Backend typecheck | PASS | TypeScript completed without diagnostics |
| Backend production build | PASS | `tsc` completed successfully |
| Frontend lint | PASS | No lint errors |
| Frontend typecheck | PASS | Completed successfully |
| Frontend production build | PASS | Completed; main bundle warning remains (962.14 kB, gzip 261.11 kB) |
| Frontend unit suite | PASS | 34 files, 376 passed |
| Root launcher tests | PASS | 6 passed |
| `git diff --check` | PASS | Exit 0; line-ending conversion warnings are informational |

Three pre-existing opt-in PostgreSQL tests remained skipped by their explicit environment guards:

1. Exact-job recovery PG17 (`MEDDECODE_EXACT_RETRY_PG17`).
2. Initial-review PG17 (`MEDDECODE_INITIAL_REVIEW_TEST_DATABASE`).
3. V3 RPC encoding PG17 (`MEDDECODE_RPC_PG17`).

They are not counted as passing tests. The required reminder PostgreSQL tests did execute against genuine disposable PostgreSQL 17 instances.

## Remaining Warnings and Team Review

- Nineteen migration directories remain untracked and require owner-by-owner review before any source-control action.
- The current tree contains generated virtual environments, caches, reports, and other non-source artifacts that must not be swept into a commit.
- Several files emit LF-to-CRLF working-copy warnings. `git diff --check` still passes.
- The frontend main bundle exceeds Vite's chunk warning threshold; this is outside Batch 1.
- Full Python regression was not rerun in Batch 1 because the known clinical extraction failure belongs to Batch 2. No Python success is claimed here.
- No hosted schema, data, worker, feature flag, or job state was accessed or changed.

## Batch 2 Plan — Clinical Extraction Boundary (Plan Only)

No Batch 2 source file was modified in this batch.

### Reproduced mechanism

`test_numbered_medicine_rows.py` supplies uncertain rows such as `1. unclear once daily`. The numbered-row detector correctly records warning/evidence, but the Layer 2 medicine extractor independently strips the numeric prefix and promotes `unclear` to a `RawMedicineEntry`. The pipeline exposes both collections without reconciling them, so Layers 3–5 and the Contract v1 mapper can receive an entry that the warning simultaneously describes as unverified.

### Proposed implementation boundary

1. Fix the Layer 2 extraction boundary, before Layers 3–5, rather than hiding the record only in the Contract mapper.
2. Give every unverified numbered row stable page/block provenance. Prefer explicit source block indexes if the current evidence model cannot express them losslessly.
3. Build an exclusion set from `(page_number, source_block_index)` evidence and reject a medicine identity only when its identity evidence is wholly attributable to an unverified row.
4. Preserve a valid adjacent medicine whose identity has independent evidence outside the excluded row. Do not filter solely by page, text similarity, or instruction overlap.
5. Keep the uncertain row and its OCR evidence in warning/manual-review output. Do not invent a name.
6. Add a pipeline invariant so excluded identities cannot reach Layer 3, catalogue lookup, recommendations, or Contract v1 medicines. Retain a defensive mapper validation for inconsistent upstream results.

### Required Batch 2 tests

- The currently failing four-row regression.
- Mixed valid medicine and unverified rows on the same page.
- Multiple medicines, side notes, repeated OCR blocks, and page-number isolation.
- Identity evidence overlapping instructions but not medicine-name evidence.
- Preservation of warning text and OCR provenance for manual review.
- A Layer 4 spy proving rejected identities are never queried.
- Contract v1 output with zero medicines and `completed_with_warnings` when all candidates are uncertain.
- Existing valid numbered-medicine fixtures to prevent over-filtering.
- Full Python suite plus focused Layer 2, offline-pipeline, Contract mapper, and synthetic PDF/JPEG/PNG cases after implementation.

## Release Decision

The Batch 1 test and static-analysis baseline is trustworthy for this working tree. It is not a clean-checkout release baseline until migration/source ownership is reviewed and the preserved untracked work is deliberately brought under source control or excluded by its owners.

Do not proceed to hosted deployment from this tree. Batch 2 may begin as a separate, narrowly scoped change after owner review of the affected intelligence files.

