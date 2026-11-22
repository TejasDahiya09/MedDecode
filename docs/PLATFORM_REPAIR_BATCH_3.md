# Platform Repair Batch 3

## Repairs

- Corrected the non-OCR local acceptance bootstrap's scoped-worker parameter binding.
- Added an explicit user-module-only harness mode so CRUD acceptance does not initialize OCR, models, or workers.
- Corrected nullable Reminder `scheduled_times` updates: SQL `NULL` is preserved while actual arrays remain JSONB encoded.
- Corrected missing/cross-owner dose operations to return the API's non-disclosing 404 instead of a storage 500.
- Made successful dose recording update the visible activity list immediately while the persisted-history refetch completes.
- Restored keyboard focus to the Cabinet control that opened a dialog after close, save, or Escape.

## Verified workflows

- Cabinet: invalid input rejection, two distinct lots for one medicine, edit, refresh persistence, cross-owner denial, deletion, and empty cleanup state.
- Reminders: linked creation, invalid schedule rejection, edit, pause, refresh persistence, deletion, cross-owner denial, and Cabinet deletion setting the optional link to null.
- Dose logging: persisted event, last-taken display, owner-scoped history, and existing duplicate protection contract.
- Catalogue/comparison: browse, search, empty search, invalid ID rejection, direct URL selection, refresh, Back/Forward, incomplete-field fallback, and fictional source data only.
- Responsive comparison: no page-level horizontal overflow at 390x844, 768x1024, and 1440x900.

## Evidence

- Playwright Batch 3: 1 passed using frontend, Express APIs, and disposable PostgreSQL 17; no genuine OCR rerun.
- Focused frontend: 62 passed across 6 files.
- Focused backend: 53 passed, 0 skipped.
- PostgreSQL security/cleanup marker: `BATCH3_PG17_SECURITY_AND_CLEANUP_OK`.
- Production lint, typechecks, builds, and final whitespace check are recorded in the task result.

All records and storage were synthetic and task-owned. No hosted Supabase, AWS, production worker, dataset, model, migration deployment, or `MedDecode-dev` resource was accessed or changed.
