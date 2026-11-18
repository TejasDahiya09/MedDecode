# MedDecode Release Evidence Manifest

Evidence date: 2026-11-18 (Asia/Calcutta)

Branch: `main`

Batch 7 release-candidate commit: `37aa3166b3d7345592d06e5ec25dfa85feffcc76`

Batch 8 status: working-tree documentation review; intentionally uncommitted

## Evidence classes

- **Current** means executed against the commit above during Batch 8.
- **Historical local** means a dated repository report records a local run; it
  was not repeated in Batch 8.
- **Historical hosted** means a dated report records an authorized hosted check
  or deployment; Batch 8 did not reconnect or mutate that environment.
- **Unverified** means no acceptable current or historical evidence proves the
  behavior claimed.

## Current executed gates

| Scope | Command or method | Result | Classification |
| --- | --- | --- | --- |
| Backend non-PG suite | `npm test` in `backend` | 588 passed, 3 PG failures caused by sandbox process restrictions, 3 approval-gated skips | Current local |
| PostgreSQL Reminder security | three focused PG17 test files, rerun outside sandbox | 17 passed on PostgreSQL 17.11 | Current local disposable DB |
| Backend typecheck | `npm run typecheck` | passed | Current local |
| Backend build | `npm run build`, rerun outside sandbox after `dist` EPERM | passed | Current local |
| Frontend lint | `npm run lint` | passed | Current local |
| Frontend typecheck | `npm run typecheck` | passed | Current local |
| Frontend unit suite | `npm test`, rerun outside sandbox after config-read denial | 34 files, 378 passed | Current local |
| Frontend build | `npm run build` | passed; main entry 102.89 kB minified / 29.36 kB gzip | Current local |
| Browser review/UI | Chromium review and Batch 6 specs | 14 passed, one worker | Current local mocked browser |
| Python | full `pytest` with task-owned base temp | 451 passed, one third-party deprecation warning | Current local |
| Python dependencies | `pip check` | no broken requirements | Current local |
| Root launcher | `npm run test:dev` | 7 passed | Current local |
| Workspace integrity | `git diff --check` and candidate secret scan | passed; no candidate secret patterns | Current local |

The combined backend result is 591 passing tests plus 3 explicit skips: 588
passed in the initial serial run and the three sandbox-blocked PostgreSQL tests
passed unchanged in the focused privileged rerun. It is not represented as one
single uninterrupted command.

## OCR evidence

Batch 7 genuinely executed local EasyOCR sequentially on generated fictional
inputs. This evidence belongs to commit `37aa3166` and was not repeated in
Batch 8.

| Format | Result | Elapsed | Peak sampled process-tree RSS | Expected identities |
| --- | --- | ---: | ---: | ---: |
| two-page scanned PDF | pass | 26.888 s | 1556.77 MiB | 2/2 |
| EXIF-rotated JPEG | pass | 17.301 s | 1551.56 MiB | 1/1 |
| PNG | pass | 18.415 s | 1531.84 MiB | 2/2 |

This limited synthetic set had zero critical numeric substitutions. It does not
establish handwriting, photographed-prescription, real-world, or clinical
accuracy. Genuine PaddleOCR adaptive fallback and a genuine FastAPI-supervised
request were not executed in Batch 7 or Batch 8.

## Historical local integration evidence

`backend/docs/BATCH_5_E2E_WORKFLOW_ACCEPTANCE.md` records a 2026-11-18 isolated
PostgreSQL-backed browser flow: review, edit, confirmation, genuine local Layers
4-5, current/history results, and owner-bound local preview passed. A separate
supervised EasyOCR run passed. The report explicitly states that browser upload
and OCR were not one uninterrupted transaction. Batch 8 did not rerun that
database-backed acceptance.

`backend/docs/BATCH_4_BACKEND_RELIABILITY.md` records safe preview diagnostics,
stream disposal, subprocess cleanup, and listener cleanup. Its hosted preview
attempt was `UNVERIFIED` because no approved signed-in owner browser session was
available.

## Historical hosted evidence

The untracked, preserved report
`backend/docs/BATCH_3_MIGRATION_012_DEPLOYMENT_RESULT.md` records the separately
authorized 2026-11-17 hosted Migration 012 deployment against Supabase project
`wyripeqruhvbksjfsvlr`, database `postgres`, with TLS `verify-full`. It records:

- deployment SHA-256
  `EA91E558696AEF60A950C4D4DEDD71913277271D1BB4EC5C5866C0392361F509`;
- preflight marker `MEDICATION_REMINDERS_SECURITY_FIX_V2_PREFLIGHT_OK`;
- verify marker `MEDICATION_REMINDERS_SECURITY_FIX_V2_VERIFY_OK`;
- eight exact RLS policies, corrected Cabinet correlation, zero anon/PUBLIC
  privileges, authenticated CRUD only, zero worker table privileges, composite
  owner FK, dose-event uniqueness, and seven valid indexes;
- unchanged aggregate counts, with zero Reminder and dose-log rows.

This is historical hosted evidence, not a Batch 8 live query. The same report
notes broad default privileges for future `public` objects were out of scope.
Batch 8 made no hosted connection or mutation.

## Skips and excluded evidence

- Backend: 3 explicitly guarded PostgreSQL exact-recovery/transport tests were
  skipped by their source gates.
- Python: default configuration excludes opt-in runtime/hosted tests; one
  Starlette/AnyIO deprecation warning remains.
- Playwright: only 14 safe local Chromium cases ran in Batch 8. The full browser
  inventory, authenticated hosted spec, and PostgreSQL-backed Phase 1F browser
  acceptance were not rerun.
- Eleven credential-bearing browser specifications plus one target-only file
  remain excluded from Git and preserved privately, as recorded in the cleanup
  and consolidation reports. They are not release evidence.

## Unverified behavior

- One uninterrupted browser upload -> supervised OCR -> draft review -> manual
  confirmation -> Layers 4-5 -> result/history run.
- Authenticated hosted S3 preview for an existing owner-bound fictional file.
- Genuine adaptive PaddleOCR under the current supervised request.
- A clean-install, lockfile-reproducible Python OCR environment.
- Clinical accuracy, efficacy, or safety on real prescriptions.
