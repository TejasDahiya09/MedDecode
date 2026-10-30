# Phase C.1b.1 - Full desktop navigation and balanced Home

Repository: `C:/Users/dahiy/MedDecode-dev`.
Branch: `feature/frontend-foundation`.
Starting HEAD: `975fe6a47c72e6c6bfb3738a0cb968ed41dd1083`.
Local checkpoint subject: `fix(frontend): improve full navigation and Home balance`.

## A. Root causes

The four hidden desktop destinations were controlled by `.md-wide-link { display:none }` until a hard-coded 1920px media query. This was unrelated to actual label widths. The original source's inline search minimum width, multiple utility labels at wider breakpoints and inherited 96rem header maximum also reserved width before required product navigation. Browser zoom was not the cause.

Home placed two prescription rows in a wide left panel, while reminders and all six actions occupied the narrow right column. The grid's row height followed the taller right stack; the unoccupied left area was a structural consequence, not an excessive margin to hide. The source Continue and action-tile styling was appropriate; its content allocation needed changing for MedDecode.

The mobile bar already reserved normal bottom padding. Additional action-by-action checks now verify that interactive content can scroll fully clear of it. The redundant bottom More opened the same complete directory as header Explore.

## B. Header changes

Brand geometry, Inter 12.8px navigation typography, source clamped link padding, 5.6px link gaps, active underline, icon/control sizes, focus, hover and theme styling remain unchanged. No global zoom, scale or font reduction was added.

The allocation policy now gives required labels priority:

- Below 1120px: the source compact Explore header; all seven full labels and section search are in its modal directory.
- 1120-1279px: five direct labels plus More for Reminders and Learn & Resources. Cabinet/Reminders/Resources utilities use a source-styled shortcuts disclosure. Search is icon-triggered.
- 1280-1439px: **all seven direct labels**; utility shortcuts remain grouped, search is icon-triggered.
- 1440-1679px: **all seven direct labels**, direct utility icons and icon-triggered search.
- From 1680px: **all seven direct labels**, source inline search (192-256px range) and direct utility icons.

The header can use up to 120rem rather than being capped at 96rem. Its normal height remains 75px. Search retains the source field/popover style, autofocus, ArrowDown/Enter selection, Escape and focus restoration. Its temporary search surface closes after route selection. The utility menu uses the existing source dropdown/disclosure surface, with working shortcuts and tooltips; no services or account behavior were introduced.

## C. Direct-label visibility and measured widths

CSS pixels at 100% browser zoom and device scale 1. Navigation budget is the available interval between the brand-side navigation start and the next allocated search/utility block, subtracting the source gap. The nav width is its actual occupied width.

| Viewport | Direct labels | Brand width | Nav occupied width | Nav available width | Inline search width | Utility group width |
| --- | --- | --- | --- | --- | --- | --- |
| 1200 | 5 | 142.11 | 670.78 | 782.33 | 0 | 190.39 |
| 1280 | 7 | 142.11 | 842.50 | 856.64 | 0 | 190.39 |
| 1440 | 7 | 142.11 | 862.62 | 907.68 | 0 | 287.98 |
| 1728 | 7 | 142.11 | 893.91 | 966.70 | 256 | 239.19 |

Zero inline search width means the 44px search trigger opens the accessible search surface. It does not mean search was removed. All seven destinations are directly visible at **1280, 1440 and 1728px**. At 1200px the full seven-label budget would exceed the available width, so More contains the final two routes. More retains an active underline when one of them is selected.

The 1440px individual label/control widths, in route order, are 62.48, 148.94, 135.88, 150.31, 97.03, 92.52 and 141.91px. At 1728px they are 66.95, 153.41, 140.34, 154.78, 101.50, 96.98 and 146.38px; the increase follows CampusConnect's clamped padding, not enlarged or reduced typography. Full precision and other widths are in `header-measurements.json`.

Additional fit checks at 1120, 1200, 1280, 1440, 1600, 1680, 1728 and 1920px verify no brand/nav/search/utility overlap or horizontal document overflow. Normal visual viewport scale and CSS zoom are 1; application transform is none.

## D. Home composition

The compact welcome and primary action remain first. The overview row now holds a prescription Continue panel beside a reminder Continue panel in a 1.15:0.85 desktop grid. Both use the source row/heading/icon conventions and the same content-driven padding. No fixed height, stretched panel, negative margin or artificial blank spacer was introduced.

Six quick actions are now a **full-width three-column, two-row grid** from 980px. Tablet and mobile use two columns. Source tile colors, accent rails, typography, radii, shadows, icons and hover states are retained. Desktop labels fit on one line. The sample activity cards follow immediately using the original section gap, then the dynamic cabinet strip and small disclaimer.

| Width | Outer Home width | Prescription panel | Reminder panel | Full action-grid width | Section gap |
| --- | --- | --- | --- | --- | --- |
| 1440 | 1376 | 736.00 x 305.56 | 544.00 x 305.56 | 1312 | 34.40 |
| 1728 | 1376 | 736.00 x 305.56 | 544.00 x 305.56 | 1312 | 34.40 |
| 1280 | 1280 | 681.53 x 302.80 | 503.73 x 302.80 | 1216 | 30.72 |
| 768 | 768 | 720.00 x 278.06 | 720.00 x 278.06 | 720 | 22.40 |
| 390 | 390 | 358.00 x 291.41 | 358.00 x 278.06 | 358 | 20.00 |
| 320 | 320 | 288.00 x 335.66 | 288.00 x 296.03 | 288 | 20.00 |

Measurements are Light mode; Dark mode has the same geometry. Both desktop overview panels are 305.56px high at 1440/1728 and 302.80px at 1280, from their real content. They naturally change height when reminder state or narrow-screen text wrapping changes. Gaps from overview to actions and actions to activity equal the source root gap within measurement rounding; they are not stretched rows. The old large blank region beneath the prescription panel is gone.

## E. Responsive behavior and bottom clearance

768px stacks prescription overview, reminders and actions, keeping the source 22.4px gap. 390px and 320px use the same ordered stack with 20px gaps, compact source welcome and two-column action tiles.

Explore is now the single complete mobile section directory/search surface. The bottom bar has six direct common destinations: Home, Upload, Insights, Cabinet, Reminders and Learn. Compare remains discoverable through Explore and its Home action. There is no duplicate More overlay opener.

Main content reserves the bar height, device safe-area inset and one additional rem. Focus/scroll targets have a matching bottom scroll margin and sticky-header top margin. Tests scroll each of the six action links to the viewport bottom, confirm its bounds are **above** the fixed bar and click it through to the correct rendered page. They also check the final disclaimer.

At 390px, all action bottoms clear the bar by approximately 15.83px and the disclaimer by 39.53px. At 320px, action clearance is 15.45-16.11px and disclaimer clearance 39.62px. No pointer-forced clicks were used. The tests retain drawer focus trapping, inert background, Escape/restoration, history and 200% text reflow. Full-page screenshots composite fixed bars at a viewport position; dedicated bottom-clearance screenshots show the actual scrolled end state.

## F. Light/Dark screenshots and measurements

[Open the before/after visual viewer](../playwright-report/c1b1/comparison.html).

Local evidence lives in `frontend/playwright-report/c1b1/` (ignored by Git):

- `{dev,preview}-{1440,1728,1280,768,390,320}-{light,dark}-{full,viewport}.png`: 48 final Home/header screenshots.
- `{dev,preview}-{390,320}-{light,dark}-bottom-clearance.png`: eight scrolled mobile screenshots.
- `{dev,preview}-<width>-<theme>-measurements.json`: geometry, individual labels, section gaps, mobile clearance, errors and service requests.
- `header-measurements.json`: eight additional desktop widths, available navigation budgets and occupied geometry.
- `more-1200-<theme>.png`, `utilities-{1200,1280}-<theme>.png`, `search-{1200,1280,1440}-<theme>.png`: source-styled menu/search evidence.
- `protected-visual-regression.json`: protected landing/auth pixel comparisons.
- `backend-verification.json`: preservation result; no secrets printed.
- `header-evidence.mjs`: local fit/menu capture script; run from `frontend/` with frontend on 5174.

Screenshots use Chromium, normal browser zoom, device scale 1, loaded local fonts and reduced motion. This is browser viewport verification, not a claim of physical-device Safari coverage.

## G. Source reuse evidence

Read-only authority: `campusconnect-reference/frontend/src/app/AppShell.tsx` and `app-shell.css`, plus `src/features/home/HomePage.tsx` and `home.css`.

- Header DOM still follows source brand / primary-nav / Explore / search / utilities order. The grouped shortcuts use the source dropdown and menu-item classes.
- `.cc-shell-brand-mark` remains 40px square; wordmark remains source Manrope styling. The Home/body/nav use the existing licensed Inter asset.
- `.cc-shell-nav-link`, its `::after` underline, `.cc-shell-utility`, `.cc-shell-avatar`, `.cc-global-search-form`, `.cc-explore-sheet` and `.cc-mobile-nav-link` retain source styling.
- Home reuses source Welcome, Continue headings/rows, QuickActions tiles, Discover record cards and ProfilePrompt-style final strip. The three-column action arrangement is a product-content adaptation of the source grid convention.
- No palette, asset, font license, icon system, public landing or authentication styles changed.

## H. Automated verification

- `npm run typecheck`: passed.
- `npm run lint`: passed, zero warnings.
- `npm run test:unit -- --run`: 96 passed, zero skipped.
- `npm run build`: passed.
- `npm run test:e2e`: 120 passed, zero skipped.
- `npm run test:e2e:preview`: 120 passed, zero skipped.
- Additional fit/menu script: eight widths and six theme/menu/search cases passed.
- Protected screenshot comparisons: 32/32 pixel-identical against the approved landing/auth baselines (both development and preview).
- `git diff --check -- frontend`: passed.

New assertions cover all seven visible labels at supported widths, no forced zoom/scaling, measured non-overlap, genuine constrained More, active routes, keyboard search/utilities, all six Home actions, balanced panel heights, full action-grid width, exact section gaps and mobile scroll/click clearance. Existing coverage was adapted to direct desktop labels and the single Explore directory, rather than removed.

The first focused browser run had four failures in the newly added mobile test: it requested browser Back immediately after the URL changed, before the destination render/focus cycle had completed. The test now waits for the destination heading and main focus before going back, preserving the route-focus assertions. Final test failures: zero failures, zero skips. No implementation failure was hidden by forcing clicks or dropping checks.

## I. Preserved behavior and regression boundaries

Other six feature interiors were not edited. Their full existing browser tests still verify cabinet CRUD/filter/validation and visit-state count, reminder CRUD/toggles, local file validation/removal and independent sample analysis, fictional-reference search, compare selection/swap/reset, resource search/articles and modal keyboard/focus handling. Header search still performs frontend section navigation only. Theme persistence, OS fallback and cross-tab synchronization remain covered.

No real service requests are recorded in the new captures or existing local-only tests. No auth, Supabase, Prisma, OCR, notifications, cloud saving or medical service was connected. The reference, backend, intelligence and database files remain unchanged.

## J. Exact changed files

- `src/app/AppShell.tsx`
- `src/app/WorkspaceHeader.tsx`
- `src/app/app-shell.css`
- `src/app/navigation.ts`
- `src/features/demo/HomePage.tsx`
- `src/features/demo/home-layout.css`
- `tests/e2e/shell.spec.ts`
- `tests/e2e/workspace-header.spec.ts`
- `tests/e2e/home-refinement.spec.ts` (new)
- `tests/unit/shell.test.tsx`
- `docs/phase-c1b1.md` (this report)

## K. Git checkpoint and workspace state

Frontend-only local commit subject: `fix(frontend): improve full navigation and Home balance`. The completion message provides the exact hash; `git log -1 --format=%H` identifies the commit containing this report. No push, fetch, pull, merge or deployment occurred.

The nine snapshotted backend/configuration files retain their original SHA-256 hashes, including ignored local environment configuration. Pre-existing unstaged changes remain in `backend/.env.example`, `.gitignore`, `README.md`, `package-lock.json`, `package.json`, with untracked `prisma.config.ts` and `prisma/`. No backend file is staged. Frontend status after the local checkpoint is clean.

## L. Remaining deviations and stopping point

All seven labels are directly visible at 1280/1440/1728px. At 1120-1279px, five direct labels and two overflow links avoid overlap with the source-sized brand and controls. Below that, Explore provides all seven destinations. Intermediate search is intentionally icon-triggered and constrained-width utilities are grouped; their styles and functions remain source-derived.

The overview ratio and three-column action layout adapt CampusConnect's patterns to this product's six actions and local synthetic records. They are not an identical CampusConnect content arrangement. Mobile copy wraps naturally; content-driven heights may differ by state. No clinical data, invented metrics or new dependencies were introduced.

Stop here for owner visual approval. Upload Prescription and the other six page interiors have not been redesigned.
