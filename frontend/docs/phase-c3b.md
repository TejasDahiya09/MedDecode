# Phase C.3b — Medicine Insights refinement

Repository: `C:/Users/dahiy/MedDecode-dev`.
Branch: `feature/frontend-foundation`.
Starting HEAD: `83b56e7cb33d4639aac269ffa002d4c9cd1d87ef`.
Authority: complete C.3a report and actual CampusConnect sources listed below.

## A. Audit findings addressed

- Replaced the generic explorer composition with a dedicated, scoped page. The existing Inter assets, palette and approved shell are retained.
- Replaced the plain input with a CampusConnect search surface: labelled search form, 18px icon, 44px input, 46px bordered wrapper, 10.4px radius, source focus ring and explicit clear action.
- Normalized matching whitespace/case without changing the controlled input value. Clear works for results and no results, restores input focus and announces the change.
- Added native result-count and selection live regions. No announcement depends on the shared Card forwarding attributes.
- Compact selection now reveals a detail-first in-page view, focuses the heading and scrolls the surface below the header with Back visible. Closing restores the originating row, or the input if that row has been filtered out.
- Replaced the viewport-only tablet split with a container-width rule; 768px is a single column. Desktop remains a directory/detail pair.
- Raised selected-row supporting-text contrast using the existing `--cc-text-soft` token locally.
- Added accessible reference-code text and a real Compare Medicines link. Removed the decorative 150.8px illustration from this page only.
- Made no-selection reachable through Clear selection while preserving default Aster selection and the four unchanged fictional fixtures.

## B. Source components and presentation reused

Reference paths below are under `campusconnect-reference/frontend/`. The reference itself remains read-only.

| Source | Reuse / adaptation |
| --- | --- |
| `src/features/marketplace/MarketplaceSearch.tsx`; `marketplace.css:254–319` | Search form/label, icon size, wrapper/input heights, spacing, radius, focus-within border and soft ring. Immediate filtering uses only local fixtures; clear replaces the original submit-arrow position. Enter is still a real form submission, without a fake debounce/service delay. |
| `src/features/search/SearchResultItem.tsx` | Compact flex record composition, 44px identifier, 12px gap and 12px 16px padding. Native pressed buttons replace campus record Links because this is local selection. |
| `MarketplaceProductCard.tsx`; `marketplace.css:508–637` | 14px card radius, token border/shadow, 15px/650/21px title hierarchy, 160ms border/shadow treatment and 3px focus outline. No commerce image, price, seller, bookmark or share logic is copied. |
| `MarketplaceListingDetail.tsx`; `marketplace-detail.css:83–91,379–439` | Compact identity/title hierarchy, metadata, 12px information-card radius, 14.4px padding, 16px gaps, 13px/1.45 facts with 10.4px row gaps. Supporting sections share a row when the desktop detail column has room. |
| `ProfilePage.tsx:170` / `ProfileSection.tsx` | 22rem companion convention, 24px gap and 20px/24px outer panel padding. Directory/detail emphasis is deliberately reversed. |
| Shared `ui.tsx`, `Icon.tsx`, source EmptyState styling | Existing MedDecode Badge, Button, EmptyState, icons and theme tokens are reused. A native section carries detail semantics. Shared Card, modal and all other primitives are unchanged. |
| `MarketplaceFilters.tsx`, `MarketplaceCategoryNav.tsx` | Reviewed, deliberately not transplanted: four records do not justify price/seller/availability filters or a tall commerce category carousel. |
| Source Modal and existing target DemoModal | Reviewed for focus/dismissal conventions. A responsive in-page detail view was chosen over an overlay: there is no background isolation, focus trap or extra modal navigation to manage. |

Typography remains **Inter throughout Medicine Insights**, as explicitly required. Source commerce detail variants use Manrope; their sizing/weight/hierarchy are adapted while retaining Inter. The original storefront Georgia heading, hero and commerce fields are not suitable here. There is no claim that a different product workflow is whole-page pixel-identical.

## C. Search and directory

Raw input remains unchanged, including leading/trailing spaces. Matching uses trimmed, collapsed whitespace and lowercase against existing name, ingredient, formulation and reference-code fields. There is no semantic/medical search, remote request or recommendation algorithm. The input retains the source's 100-character limit.

The count is visible and has `role="status"`, `aria-live="polite"` and atomic text. A separate concise live region covers selection, clearing, closing and explicit form submission. Typing changes neither focus nor scroll through application code.

Directory rows show only the fixture's name, ingredient and formulation. They are native buttons inside a semantic list, with `aria-pressed` and `aria-controls`. They work with Tab, Enter and Space; they are not incorrectly labelled as tabs or a listbox. Selected state remains identifiable independently of filtering.

No-results uses the shared source-derived EmptyState and the persistent search clear action. Filtering retains an existing selected record as before. The code does not mutate the dataset or transfer state into other features.

## D. Compact selection and focus

Below the content-width threshold, details are initially closed and the directory is the priority. Selecting any example opens the existing detail section before the directory in document layout. The selected heading receives programmatic focus; the **surface** scrolls below the header so the top Back to results action remains visible. The directory and search remain in the document. This is an inline responsive detail view, not a modal or drawer.

Back to results and Close details restore the originating selection. If filtering removed that row, focus returns to the search input. Clear search closes the compact detail view, retains the selected record, clears input and focuses it. Clear selection sets selection to null, closes compact details and returns to the origin/input; desktop then displays the source EmptyState.

The same content is rendered once. Desktop-only/compact-only presentation is scoped CSS; controls hidden on desktop cannot enter keyboard navigation. No overlay traps focus. No history entries or query parameters are fabricated: Back within the view is a local action; browser Back continues normal route navigation. Compare navigation and browser Back are verified.

ResizeObserver uses actual page content width. When resizing would hide a focused detail control, the page remembers the detail focus, keeps the compact surface open when needed, or returns focus to the selected heading when a compact Close/Back control disappears on desktop. The resize regression covers both directions and a constrained container in a wide viewport.

## E. Tablet and responsive geometry

The page establishes an inline-size container. At **60rem of actual content width** the explorer uses `22rem minmax(0,1fr)` with a 24px gap. Below it, the explorer uses one column. The 60rem threshold corresponds to the source 1024px editor convention after the existing 64px desktop gutters, while also supporting constrained containers and enlarged text.

| Viewport | Before | After initial layout |
| --- | --- | --- |
| 1440×900 | 441.33 / 882.66px columns, 20px gap | 352 / 936px columns, 24px gap; existing 1376px outer workspace container. |
| 1280×800 | 398.66 / 797.34px columns | 352 / 840px columns. |
| 768×1024 | Cramped 240 / 459.98px columns | One 720px directory column; selected details open first at the same width. |
| 390×844 | Stacked directory then always-visible off-screen detail | 358px directory first; selected detail opens before it with focus/Back handoff. |
| 320×844 | Long stacked presentation | 288px content with wrapping records and full-width action grouping. |

Search wrapper is 46px high at all requested widths. Input is 44px, 14.4px desktop and 16px below 700px. Rows are about 94px at regular widths, growing with wrapped content at 320px; the old 72px rows lacked the visible ingredient field. The new row height is content-driven, not a fixed-height mismatch.

The desktop detail is about 601.48px high at 1440px, compared with the former 630.28px, despite adding reference identity and Compare/Clear actions. No fixed matching heights are imposed. Exact final measurements are saved in the local evidence files.

## F. Accessibility and contrast

- Real search label/form, result-count status, selected/cleared/closed status and native named detail region.
- Focus restoration after clear/close, filtered-out origin fallback and responsive resizing.
- Source-style visible focus rings, normal button semantics, no full-article live announcement and no shared Card API changes.
- Reference code is real accessible text, rather than part of aria-hidden artwork.
- Existing global safe-area/scroll-margin behavior is retained. Compact details have a source-consistent 6rem scroll offset, with both Back and Compare actions checked against the fixed header/bottom navigation.
- Reduced motion removes the scoped row transition. Twofold text enlargement and intermediate-width reflow are tested.

Measured minimum row supporting-text contrast:

| State | Light | Dark |
| --- | --- | --- |
| Selected | **7.89:1** (previously 4.37:1) | **10.62:1** |
| Unselected | 9.48:1 | 12.32:1 |
| Hover | 9.48:1 | 12.32:1 |
| Keyboard focus on unselected row | 9.48:1 | 12.32:1 |

These measurements composite the actual solid/alpha CSS backgrounds; all tested row title/ingredient/formulation text exceeds 4.5:1. No global color token changed. This is not a certification of all assistive technologies or native mobile browsers; manual screen-reader speech was not tested.

## G. Compare and medical boundaries

Compare Medicines is a visible Link to the existing `/compare-medicines` route. Its nearby note explicitly says it opens the comparison demo with default examples. Tests select Dune here and verify that Compare still starts with Aster/Birch. No new shared state or selection-transfer claim is introduced.

The same four fictional medicine objects remain unchanged. Dune's unavailable ingredient is displayed explicitly. Precautions/interactions remain unavailable and unassessed. General information remains instructional demo copy. No prices, real medical facts, treatments, substitutions, patient dosage, interaction severity, clinical scores, citations or AI processing were added. Filtering and selection are in memory; no API/storage/auth/OCR integration exists.

## H. Visual evidence

Ignored evidence root: `frontend/playwright-report/c3b/`.

- `comparison.html`: source/current-before/current-after at matching viewport/theme/state, with original-resolution links.
- `{dev|preview}-{1440|1280|768|390|320}-{light|dark}-{initial|search-results|no-results|selected-details}.png`.
- `{dev|preview}-{width}-{theme}-compare-action.png`: Compare action visible and fixed-navigation clearance checked.
- `{dev|preview}-{768|390|320}-{light|dark}-selected-viewport.png`: compact selection and visible Back control.
- `{dev|preview}-{width}-{theme}-measurements.json`: computed dimensions, typography, radii, padding and columns.
- `contrast-{light|dark}.json`, `protected-comparison.json`, `preservation-verification.json` and test logs.
- Source/before evidence is the unchanged C.3a capture set under `../c3a/`; reference hashes are rechecked. No reference stylesheet or source fixture is rewritten to look like the target.

Full-page captures can place fixed navigation at the first viewport boundary within a long image. The dedicated viewport captures and geometry assertions establish actual action clearance; that compositing effect is not treated as a new navigation defect.

## I. Verification and iteration

Required final verification: typecheck, lint, 118 unit tests across 9 files, build, 142 development E2E tests and 142 preview E2E tests. Exact outcomes, failures/skips and logs are recorded in the ignored completion report after the final runs.

New coverage comprises 10 search unit cases and 13 browser cases per server mode: 10 matched viewport/theme workflows, one constrained-container/resizing/larger-text workflow, and two theme-specific contrast workflows. Existing feature interactions are retained; the shell unit assertion changes only to check the new concise Medicine Insights explanation. No meaningful test is removed or weakened.

Visual review found and corrected a CSS specificity issue that exposed the compact Close action on desktop, and adjusted mobile scrolling to keep Back below the sticky header. An added resize-focus test initially failed because the browser drops focus when CSS hides a control before ResizeObserver runs. Remembering detail focus fixes that case; its focused regression passed before the final full runs. Initial focused checks otherwise passed. Final results are distinguished from those intermediate findings.

## J. Files changed

1. `src/features/demo/MedicineInsightsPage.tsx` — new page.
2. `src/features/demo/medicine-insights.css` — fully scoped source-derived styling.
3. `src/features/demo/medicine-search.ts` — pure matching helper.
4. `src/features/demo/DemoWorkspace.tsx` — Medicine Insights import/dispatch only.
5. `tests/unit/medicine-search.test.ts` — new search cases.
6. `tests/unit/shell.test.tsx` — concise-explanation assertion for this route.
7. `tests/e2e/medicine-insights.spec.ts` — focused functionality, accessibility, visual and safety cases.
8. `docs/phase-c3b.md` — this report.

`MedicinePages.tsx` remains byte-identical because it also implements protected CompareMedicines and its private Properties renderer. Its legacy MedicineInsights export is temporarily unused; unrelated cleanup is deliberately excluded.

## K. Protected-page regression

The fresh pre-edit inventory covers 346 files, including application/test/configuration files, backend dirty files and reference source. Only DemoWorkspace and the scoped shell test assertion are expected changes among existing inventoried files; all other implementation changes are new feature files.

Home, Upload, navigation, Landing, authentication, Compare implementation/content, cabinet, reminders, resources, shared components, providers, data, dependencies, intelligence and reference source remain byte-identical. Existing backend modifications/untracked Prisma files remain uncommitted and unstaged. The full browser suites exercise all seven destinations and existing in-memory workflows with no fetch/XHR service requests. Saved protected screenshots are compared; exact pixel matches and any control/font rasterization differences are listed in the completion evidence rather than asserting universal pixel identity.

## L. Local Git checkpoint

After successful required checks, create only the requested frontend-local checkpoint:

`feat(frontend): refine Medicine Insights experience`

The actual resulting hash and final status are appended to the ignored report/completion message. Only the eight files above are staged. No fetch, pull, push, merge, deployment, dependency installation, backend/Prisma edit or database operation.

## M. Remaining deviations and stopping point

- CampusConnect has no medicine page. This adapts its search/compact-row/commerce-detail patterns, keeps Inter as requested, omits commerce fields and uses a content-width breakpoint. It is not a whole-page pixel-match claim.
- Compact details use an in-page responsive view instead of a drawer; search/results remain accessible, close focus is restored and no overlay traps users. No extra history entry is created.
- Four fictional records have no clinically verified medicine information. Missing data remains explicit. Compare is navigation only, without prefill.
- No category carousel/sort is added for the four records. The optional filters were not needed to complete this phase.
- Browser evidence uses Chromium and synthetic fixtures. Native Safari/Android and manual assistive-technology certification are outside this verification.
- The old unused Insights export is retained to protect the co-located Compare file.

Stop after C.3b. Compare Medicines and all other pages await owner visual approval before any separate design work.
