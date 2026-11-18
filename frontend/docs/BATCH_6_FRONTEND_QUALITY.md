# Batch 6 Frontend Quality

Date: 2026-11-18

Branch: `main`

Starting Batch 6 commit: `d428e8340c7d3e3d67e92e5ae25f319c4cf40e25`

## Scope and outcome

Batch 6 resolved the oversized frontend entry bundle and stale workspace navigation descriptions without changing routes, API contracts, clinical processing, hosted data, or application state. The public landing page, authentication UI, protected shell, providers, and primary dashboard remain eager. Feature-heavy workspace routes are loaded only when visited.

## Files changed

- `frontend/src/app/App.tsx`
- `frontend/src/app/WorkspacePage.tsx`
- `frontend/src/app/navigation.ts`
- `frontend/vite.config.ts`
- `frontend/tests/unit/navigation.test.tsx`
- `frontend/tests/unit/prescription-upload.test.tsx`
- `frontend/tests/unit/shell.test.tsx`
- `frontend/tests/e2e/batch6-frontend-quality.spec.ts`
- `frontend/docs/BATCH_6_FRONTEND_QUALITY.md`
- `backend/docs/PLATFORM_ISSUE_REGISTER.md`

## Bundle comparison

| Artifact | Before | After |
| --- | ---: | ---: |
| Main application JavaScript | 963.67 kB / 261.39 kB gzip | 102.89 kB / 29.36 kB gzip |
| Largest emitted JavaScript chunk | 963.67 kB | 261.38 kB (`vendor-react`) |
| Vite chunks over 500 kB | 1 | 0 |

The main entry decreased by 860.78 kB minified (89.3%) and 232.03 kB gzip (88.8%). The build threshold was not raised or suppressed.

### Lazy-loading boundaries

- Prescription history
- Prescription results
- Prescription review workspace
- Authenticated upload
- Medicine Library
- Compare Medicines
- Medicine Cabinet
- Medication Reminders
- Fictional demonstration workspace

React/router, Supabase and TanStack Query are stable vendor chunks. The protected shell and providers stay eager so authorization and navigation do not flash or remount across route changes. Every deferred route exposes a polite `role=status`, `aria-live=polite`, `aria-busy=true` loading announcement.

## Navigation and interaction changes

- Upload now describes the implemented PDF/image upload and processing tracking.
- Compare explicitly avoids implying clinical equivalence.
- Cabinet describes saved medicine quantities, refill dates and expiry details.
- Reminders describes implemented schedules and recorded dose events.
- No routes, API calls, review confirmation rules, or result-history behavior changed.

## Accessibility and responsive evidence

The authenticated Batch 6 Playwright check verified:

- Desktop lazy navigation from Cabinet to Reminders.
- Mobile navigation at 390 x 844 without horizontal overflow.
- Keyboard opening of the navigation dialog.
- Initial dialog focus on the close control.
- Escape closes the dialog and restores focus to its trigger.
- Updated descriptions are exposed in the mobile navigation directory.
- The existing mobile prescription-results regression remains readable without horizontal overflow.

## Verification

- Frontend lint: passed, zero warnings.
- Frontend typecheck: passed.
- Frontend production build: passed; no chunk-size warning.
- Frontend unit suite: 378 passed across 34 files.
- Focused current-contract Playwright: 3 passed (Batch 6 desktop, Batch 6 mobile/keyboard, mobile prescription results).
- `git diff --check`: rerun after this report and recorded in the final handoff.

An initial broader Playwright selection was not counted as passing evidence. It exposed an existing test-contract mismatch: legacy `foundation`, `shell`, `upload`, catalogue and comparison specifications expect protected production routes to expose the old unauthenticated `Demo Mode`. The current router correctly redirects unauthenticated access to sign-in. Those files require a separate test-harness modernization or explicit `/demo/*` routing; authentication was not weakened for Batch 6.

## Outstanding Batch 5 acceptance gaps

- No single uninterrupted isolated browser upload -> worker -> supervised OCR -> draft-review run.
- Hosted AWS/S3 document-preview acceptance remains unverified.
- Some negative/concurrency scenarios remain covered below browser level rather than in the PostgreSQL-backed browser acceptance.
- Credential-dependent hosted browser verification was not run.

## Remaining issues

- Modernize the older demo-era Playwright suites to either establish a synthetic authenticated session for protected routes or use the explicit `/demo/*` routes.
- Establish a measured cold-load/Web Vitals budget in CI; build artifact size is verified, but network and device-level performance were not fabricated.
- Learn & Resources remains accurately labelled as future/unavailable and was not changed.

No hosted mutations, worker starts, migrations, dataset changes, or `MedDecode-dev` changes occurred.
