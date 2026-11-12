# Phase C.3b.1 - Medicine Insights marketplace redesign

Medicine Insights now uses the actual CampusConnect Marketplace composition rather than the previous permanent master/detail list. The workspace shell and other feature pages are unchanged.

## Source and design

Adapted `campusconnect-reference/frontend/src/features/marketplace/` MarketplaceBrowse, MarketplaceHero, MarketplaceFilters, MarketplaceCategoryNav, category-carousel, MarketplaceProductCard and marketplace.css. The source stylesheet is nested under `.md-catalog`; the source field rules are scoped to the catalog and its modal. No reference file was edited.

The desktop hero has a 224px minimum rather than the source 280px (measured 225.1px at 1440px, 224px at 1280px). It retains the purple layered illustration composition and serif headline, with local unbranded SVG medicine/reference artwork. At 1440px the grid begins around y=756px, bringing card media above the fold. Small screens use a 152px minimum hero that grows with its text (182px at 390px in this capture; the added fictional-use explanation makes it taller than the source mobile minimum). Source responsive ordering puts search, categories and the hero before results; filters become a modal below 1100px. Source container queries give four, three, two or one card columns according to available width. No hero actions were added.

The left filter rail, icon-circle category carousel, search/sort toolbar, card image proportions, radii, borders, hover states and pagination follow Marketplace conventions. Product-specific copy, artwork and reference metadata replace prices and sellers. This is source-derived adaptation, not a claim of pixel-identical content.

## Behavior and demo boundaries

- Sixteen fictional references, with twelve cards per page. The original four medicine records remain intact; a Liquid formulation preserves Cedar's existing value.
- Search normalizes whitespace for matching while preserving the entered value and input focus. Clear search and Clear all restore search focus.
- Category, formulation, ingredient, reference-layout and fictional-verification filters work locally. Filter drafts apply only on Apply. Categories, removable chips, sorting and pagination update the grid.
- Categories support arrow/Home/End keyboard navigation and scroll controls. Cards are native buttons; details use the existing native-dialog wrapper with focus trapping, Escape dismissal and focus return.
- Details include overview, general information, unavailable precautions/interactions and an honest Compare route link. Compare retains Aster/Birch defaults; the selected catalog record is not transferred.
- Therapeutic labels are explicitly illustrative browsing groups. Reference-layout availability is not clinical verification. No medical claims, prices, payments, authentication, backend, database, OCR or cloud behavior was introduced. No dependencies were added.

## Files

- `src/features/demo/MedicineInsightsPage.tsx` - catalog assembly, local interactions and details.
- `src/features/demo/medicine-insights.css` - scoped Marketplace presentation.
- `src/features/demo/MedicineCategoryNav.tsx` - source-derived accessible category strip.
- `src/features/demo/catalog-carousel.ts` - source carousel geometry helper.
- `src/features/demo/MedicineIllustration.tsx` - code-native hero/card SVGs.
- `src/features/demo/catalog-data.ts` - fictional catalog and pure discovery/filter/sort function.
- `tests/unit/catalog.test.ts` - fixtures, search, combined filters, sorts and immutability.
- `tests/unit/shell.test.tsx` - updated concise page explanation assertion.
- `tests/e2e/medicine-insights.spec.ts` - responsive catalog workflows, keyboard/focus, enlarged text, contrast and screenshot evidence.
- `tests/e2e/demo.spec.ts` - existing workflow adapted to modal semantics.
- `docs/phase-c3b1.md` - this handoff.

## Verification and review evidence

Final checks: typecheck passed; lint passed with zero warnings; unit tests 128 passed in 10 files; production build passed; development E2E 142 passed; production-preview E2E 142 passed. No final failures or skips. The initial preview Upload scroll-clearance failure did not reproduce in a complete repeat; Upload source and its assertion remain unchanged. Full intermediate results and preservation evidence are recorded in `playwright-report/c3b1/REPORT.md`; the directory is ignored and remains local.

The pre-edit inventory has 352 files: 347 remain byte-identical and only five existing catalog/test files changed. All backend/Prisma and protected source files match their starting hashes. Protected screenshot comparison: 223 of 228 pairs pixel-identical; the five differences are confined to mobile navigation icon/label capture states and one-pixel rasterization. No page geometry changed in those pairs.

The screenshot matrix covers 1440x900, 1280x800, 768x1024, 390x844 and 320x844 in both themes, in development and production preview: full catalog, viewport, search, no results, applied filters, details and Compare affordance. `comparison.html` links original Marketplace evidence, the prior Insights implementation and the new catalog. Measurements and normal/hover text-contrast JSON accompany the captures. Full-page screenshots place the fixed bottom navigation at the initial viewport boundary; viewport captures and scroll/reflow checks establish actual clearance.

Existing landing, authentication, Home, Upload and other workspace regression tests remain. Backend/Prisma and reference-file hashes are checked against the pre-edit inventory. No remote Git operation or deployment is part of this phase.

## Intentional limitations

Illustrations are generic SVGs rather than branded packaging. There is no saved/favorite state, persistence, clinical dataset, interaction assessment or selected-record Compare handoff. All newly added entries are interface fixtures. Existing Home, Upload, navigation, authentication and Compare designs remain outside this change. Further visual approval belongs to the owner before the next page phase.
