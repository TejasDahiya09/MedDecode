# Phase C.3b.2 - Medicine Marketplace mobile and detail polish

The accepted Marketplace design is preserved. This phase changes only Medicine Insights presentation and its dialogs, with related browser checks and this handoff.

## Changes and source reuse

- Mobile order is heading/demo notice, compact hero, categories, search/filters/sort, result count and cards, pagination/footer. Desktop ordering and geometry remain unchanged.
- Below 700px, names use 15px/1.45 bold type; ingredient and formulation text use 14px/1.5. Names and primary metadata wrap without line clamping. Repeated ingredient prefixes, illustrative-group lines, reference-layout status and footer labels are omitted from narrow cards; the full information remains in details. View Reference and Compare have separate 44px action areas. Cards remain two columns at 390px, one below the existing 360px breakpoint.
- The catalog-only `MedicineCatalogDialog` adapts CampusConnect's actual `src/components/ui.tsx` Modal controls, focus cycle and backdrop dismissal, and `src/index.css` Modal surface and <=639px bottom-sheet geometry. The existing shared `DemoModal` and all other dialogs remain unchanged.
- Native `showModal()` puts the catalog sheet above fixed workspace navigation and makes background controls inert. Its header and Close control sit outside the internal scrollport. Desktop dialogs retain the source 34rem surface; mobile sheets use full visual-viewport width and the source 88%/46rem maximum height, with rounded top corners and safe-area padding.
- `visualViewport` resize/scroll events update viewport bounds, including reduced height and pinch zoom. Background body/root scrolling is locked while open; previous styles, scroll position and originating-card focus are restored on dismissal. Pointer activation explicitly focuses the originating card for browsers that do not focus buttons on touch.
- Escape, Close and a pointer press/click on the outside backdrop dismiss. Content clicks do not dismiss. Keyboard Tab wraps between first/last controls.
- The workspace skip link remains unchanged outside the catalog modal: it appears when keyboard-focused, activates the main landmark and hides on blur. A catalog-modal-only selector suppresses its background focus-transition frame while the native modal isolates the workspace. The focused skip-link screenshot is expected accessible behavior, not an always-visible page banner.

## Files

1. `src/features/demo/MedicineInsightsPage.tsx` - catalog-only dialog integration, reliable pointer focus origin, metadata spans for mobile-only simplification.
2. `src/features/demo/medicine-insights.css` - scoped mobile card/order rules and catalog dialog geometry/scrolling. Accepted desktop catalog styles are unchanged.
3. `src/features/demo/MedicineCatalogDialog.tsx` - feature-specific source-derived native modal, viewport tracking and scroll/focus lifecycle.
4. `tests/e2e/medicine-polish.spec.ts` - twelve focused browser cases covering both themes, layout, readability, non-overlapping actions, dialogs, viewport changes, keyboard skip link and desktop geometry.
5. `docs/phase-c3b2.md` - this handoff.

## Verification evidence

Final commands/results, screenshot comparison inventory, preservation hashes and final Git status are recorded in `playwright-report/c3b2/REPORT.md`. That ignored directory stays local. `comparison.html` provides the review gallery.

Final results: typecheck, lint (zero warnings), production build and 128 unit tests in 10 files pass. Focused catalog verification: 25 passed. Full development E2E: 154 passed. Production-preview E2E: 154 passed. No failures or skips. All four accepted desktop full-page catalog screenshots are pixel-identical, with matching computed geometry. Of 228 protected-page screenshot pairs, 224 are pixel-identical; the four differences are mobile navigation icon hover/capture colors, with no geometry changes. The preserved inventory has 358 files: only the two intended existing catalog files changed, and the other 356 match their starting hashes.

The evidence matrix covers 1440x900, 768x1024, 390x844 and 320x844, Light and Dark, in development and production preview. It includes full page, viewport, card section, focused skip link, open-dialog top and bottom, and compact filter dialogs. Additional 390px/320px tests reduce viewport height to 500px and use Chromium page-scale emulation to change the visual viewport independently of layout width.

Checks verify minimum mobile font sizes/line heights, unclipped primary card text, action dimensions and separation, viewport bounds, persistent Close geometry during internal scroll, hit-testing of Close/Compare/Back above navigation, scroll locking/restoration, all dismissal paths, focus trapping/return, mobile section order, preserved desktop measurements and zero fetch/XHR requests or page errors. Existing catalog tests retain all 16 fixtures, filtering, sorting, pagination, unavailable-data behavior, contrast and enlarged-text coverage. Protected landing/auth/Home/Upload/navigation and other workspace tests remain intact.

## Boundaries and remaining work

All data stays fictional and in memory. No backend, Prisma, database, OCR, real medicine API, authentication, storage or notification integration was added. No dependency or reference source was changed.

Compare Medicines is unchanged and still opens with its existing defaults. The upcoming Compare refinement must support a selected-medicine handoff from the catalog, preserve the selected medicine as the first comparison item, validate the second item and explicitly address the catalog's sixteen entries versus the current four comparison fixtures. This phase only records that requirement; it does not implement the handoff.

The browser checks simulate reduced viewport height and pinch zoom; they do not claim physical-device/iOS keyboard verification. Decorative SVG labels remain small and hidden from assistive technology. Full-page screenshots show fixed bottom navigation at the initial viewport boundary; viewport and scrolled-card/dialog captures establish actual usability. Await owner visual review before the Compare phase.
