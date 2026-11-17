# PR Merge Conflict Resolution

## Branch and topology

- Pull request: `#2`, `integration/full-project` into `main`
- Source checkpoint: `710b31ab66e55addbbd59ad40c95d10df712d3c6`
- Target commit: `4f07f751017c236f44bcd5b394f4695349c8b09a`
- Merge base: `0b7f1043a2933ec859e76d09c517d21d4052df96`
- Resolution method: normal non-fast-forward merge of `origin/main`; no rebase, history rewrite, force push, or PR merge
- Conflict cause: the target is a squash-style publication snapshot whose tree also exists at `df964cdb08fbe5446cca4943f98655a7fca7dd55`. It is not an ancestor of the later integration lineage, so Git reported add/add conflicts for overlapping files.

## Conflict inventory and decisions

Git reported 160 add/add conflicts. Index stage 2 was verified against the pre-merge integration HEAD and index stage 3 against `origin/main` before resolution.

- 9 migration conflicts were resolved to the integration artifacts only after verifying their recorded SHA-256 identities against `backend/docs/batch-1-evidence/BATCH_1_MIGRATION_HASHES.csv`.
- 9 configuration conflicts were separately compared and resolved to the integration versions: `.gitignore`, both environment examples, both package manifests, both Playwright configurations, `frontend/vite.config.ts`, and `intelligence/requirements.txt`.
- `backend/package-lock.json` was separately regenerated from the resolved backend manifest with Node `v24.11.1` and npm `11.6.2`; its root dependency sets match `backend/package.json`.
- The remaining 141 backend, frontend, intelligence, test, and documentation add/add paths were resolved to the explicitly authorized current integration implementation because the target contained the older overlapping publication snapshot.
- The only target-exclusive path, `frontend/tests/e2e/prescription-workflow.spec.ts`, was excluded because it is credential-bearing. It and the other ten local browser specifications are hash-preserved outside this worktree at `C:\Users\dahiy\MedDecode\pr-conflict-preservation-20261117`.

The resolved tree therefore preserves the current V3 review and confirmation workflow, scoped worker authorization, claim-generation and lease fencing, owner isolation, Contract v1 validation, supervised OCR, catalogue access restrictions, and current frontend routes. It does not reintroduce obsolete target implementations.

## Migration provenance

The two conflicting migration directories are documented as local integration candidates and not as hosted-deployed migrations. Their source-side identities are preserved unchanged.

### `202611120002_processing_worker_claim_heartbeat`

| File | SHA-256 |
| --- | --- |
| `001_preflight.sql` | `982FBF15C7292B9AEA9155754436C3DBCDCA518A7DDC32A2FA35DB6FF0D0302C` |
| `002_up.sql` | `A1FA6E5324D717353B27056C88F4AE48D127CD859423B3EFD07C1832C7937A7C` |
| `003_verify.sql` | `77D26B83D34508489E739CC066133B58027CF5BFAAEC746FD7DE9582DA342AE2` |

### `202611120003_processing_worker_finalization_recovery`

| File | SHA-256 |
| --- | --- |
| `001_preflight.sql` | `059C27411829D16AD0FED4B398565E68BEAFDB4A4FA708339452D6F319F79126` |
| `002_up.sql` | `34D162813570F27FA6D9FCA950DA6FE7D23B296C02D4139E06EDF93450075C0F` |
| `003_verify.sql` | `F6CA8A1BBA76B5D5F3E6286F8DCEF2254EBCB8E6BC6977F2DE25CF47158A38D5` |

All 115 migration files match the Batch 1 preservation manifest after resolution. No hosted SQL was executed.

## Verification

| Gate | Result |
| --- | --- |
| Unmerged paths | PASS: 0 |
| Conflict-marker scan | PASS: 0 |
| `git diff --check` | PASS |
| Staged secret scan | PASS: 0 hits |
| Backend typecheck | PASS |
| Backend production build | PASS outside the sandbox; the sandbox attempt encountered the known `backend/dist` ownership boundary |
| Backend full suite | 583 passed, 3 skipped; the three sandbox-only private-PG startup failures were rerun below |
| PostgreSQL 17 reminder/security suite | PASS outside the sandbox: 17 passed, 0 failed |
| Frontend lint | PASS |
| Frontend typecheck | PASS |
| Frontend production build | PASS; existing 962.14 kB chunk warning remains |
| Frontend unit suite | PASS: 376 passed |
| Python full suite | EXPECTED PARTIAL: 440 passed, 1 failed |
| Root launcher suite | PASS: 6 passed |

The one Python failure is the pre-existing Batch 2 boundary defect in `tests/layer2/test_numbered_medicine_rows.py`: unverified numbered rows are still emitted as Contract v1 medicines. It is not a merge regression and was not changed here.

## Finalization

The merge commit and push status are recorded in the final task report after commit creation. The pull request itself must not be merged automatically.
