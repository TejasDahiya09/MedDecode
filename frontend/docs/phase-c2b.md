# Phase C.2b — Upload Prescription refinement

Repository: `C:/Users/dahiy/MedDecode-dev`, branch `feature/frontend-foundation`.
Starting HEAD: `091dae4205c1e51deae8065c2a57b097a70984ac`.
Scope: Upload presentation, metadata-only selection, associated tests and this report.

## A. Root causes corrected

- The generic demo grid used equal columns at tablet widths and a 384px minimum companion height. The Upload editor now uses the source profile editor's `minmax(0,1fr) 22rem` pattern from 1024px and stacks below it; both panel heights follow content.
- The old empty zone remained visible after selection and occupied 304px on desktop, with a 64px icon. A valid selection now replaces it with a source-style attachment row. The new desktop zone is 210.58px with the original 48px icon container.
- Generic demo heading overrides and repeated notices competed with the workflow. Upload now has scoped CSS, the existing source-derived SectionHeader, one compact Demo Mode badge and the requested concise explanation.
- The hidden input previously participated in Tab order; removed controls and closed results left focus on BODY. All visible actions now support keyboard operation and deliberate focus restoration.
- Empty picker changes previously closed the sample. Cancellation now leaves existing state intact. Nested drag transitions now use balanced enter/leave counting, including transitions with a related target.

## B. CampusConnect source used

All reference paths are under `campusconnect-reference/frontend/`; reference files remain unchanged.

| Original source | Adaptation |
| --- | --- |
| `src/features/profile/ResumeAnalyzer.tsx` and `resume-file.ts` | Native picker, metadata validation, drag/drop and compact wrapping selected-file row. Its service calls and processing states are excluded. MedDecode's existing accepted formats and size policy remain authoritative. |
| `src/features/marketplace/ImagePicker.tsx` | `.cc-upload-surface` appearance, selected-file metadata and removal pattern. Image previews, object URLs, upload progress and multi-image policy are excluded. |
| `src/index.css` `.cc-form-surface`, `.cc-upload-surface`, `.cc-icon-box`, `.cc-section-title`, `.cc-section-description` | Form border/padding/shadow, dashed surface, radii, icon geometry and heading hierarchy. Copied values are scoped to Upload. |
| `src/features/profile/ProfilePage.tsx` and `ProfileSection.tsx` | Content-first desktop editor with a 22rem companion and 24px gap; compact companion padding of 20px/24px. |
| `src/components/ui.tsx` and `Icon.tsx` | Existing MedDecode source-derived Badge, Button, Card, SectionHeader and icon glyphs. Focus-managed native buttons use the exact existing `.cc-button` classes, avoiding changes to shared component APIs. |
| `src/features/marketplace/marketplace-detail.css` | Sample metadata, compact information cards, 12px radii, 14.4px padding, 13px detail rows and the source's 16px/750 Manrope detail headings. |

The original product has no prescription-upload page. This is a source-based adaptation of its components and editor conventions, not a claim of whole-page pixel identity with a different workflow.

## C. Component structure

`UploadPage` contains a compact introduction, document-selection region, independent sample companion, conditionally revealed sample-analysis section and secondary memory-only footer. `upload-file.ts` holds metadata validation and accurate size/type labels. `upload.css` applies only to Upload classes.

The existing workspace `.md-page` container is retained: at 1440px its outer width is 1376px, with 32px internal side padding and 1312px content width. No shell, global tokens or other page styles changed.

## D. State behavior

- **Empty:** one native button forms the complete dashed drop target. Enter/Space opens the native picker; Browse is not a decorative control. Formats, one-file policy and size guidance remain visible.
- **Selected:** filename, normalized extension, accurate B/KiB/MiB size, “Selected locally, not analyzed,” Replace file and Remove file replace the empty presentation. Long filenames wrap.
- **Invalid:** an associated live alert explains format, size or multiple-file rejection. Invalid replacement retains the previous valid file and explicitly says so. Repeating the same invalid choice remounts the alert for a fresh announcement.
- **Sample:** View Sample Analysis opens only the existing two fictional medicine entries and RX-DEMO-01 metadata. No dosage, confidence or clinical assessment is fabricated. The selected filename is never used as a result. Close and Back restore appropriate focus. Existing reference-card navigation remains; comparison and cabinet links are working frontend destinations.
- **Lifetime:** selection and sample are component memory only and reset on reload. No new storage or authentication is introduced.

## E. Accessibility and safety

The visually hidden input is deliberately removed from Tab order and activated through the visible native Browse/Replace buttons. This avoids an invisible 1px tab stop while retaining genuine keyboard picker access. Instructions and errors use `aria-describedby`; the input reflects invalid state. Selection/removal/sample messages use a polite atomic live region; errors use `role="alert"`.

Sample control exposes `aria-expanded` and `aria-controls`; opening focuses its heading, closing returns to its trigger, and Back returns to Browse or Replace. Removal returns to Browse. Focus scrolling respects the approved shell's top/bottom clearance. Existing source focus, hover and disabled button styling is retained; no fake busy/disabled processing state is introduced.

Balanced drag-depth counting prevents child transitions from clearing feedback prematurely or leaving it stuck. Every drop resets the depth/highlight. Picker cancellation does not change the sample or selection; clearing the native input permits same-file reselection.

Browser tests instrument Blob/FileReader/object-URL APIs and fetch/XHR requests: no document content reads, preview URLs, uploads or service requests are allowed. Fixtures are synthetic bytes with synthetic filenames.

## F. Layout and typography measurements

1440px Light measurements (Dark geometry matches):

| Property | Original source component | Updated Upload |
| --- | --- | --- |
| Form surface | 19.2px radius, 32px padding, 1px token border, source small shadow | Same |
| Dashed surface | 15.2px radius, 17.6px padding, 1px dashed strong border, muted panel | Same |
| Shared section heading | Inter 18.4px / 700 / 27.6px line height | Same; Chrome platform-font inspection confirms Inter in both |
| Button | Inter 14px / 675 / 21px, 43px height, 8.8px radius, 10px 16px padding, 8px gap | Same; widths depend on label |
| Icon container | 48px square, 13.6px radius | Same; 24px glyph, source 1.8 stroke |
| Editor | 24px gap, 22rem companion, stacks below 1024px | Same breakpoint/proportion convention |

Before/after empty-state geometry:

| Viewport width | Old upload card | New upload card | Old drop height | New drop height | New companion |
| --- | --- | --- | --- | --- | --- |
| 1440 | 662 × 421.44 | 936 × 390.55 | 304.09 | 210.58 | 352 × 327.72 |
| 768 | 350 × 448.22, cramped two columns | 720 × 387.98, stacked | 324.48 | 210.58 | 720 × 262.97 |
| 390 | 358 × 448.22 | 358 × 366.55 | 324.48 | 210.58 | 358 × 319.72 |
| 320 | 288 × 494.92 | 288 × 412.94 | 371.19 | 256.97 | 288 × 347.33 |

The source ImagePicker surface itself is 80.19px high and ResumeAnalyzer is 145px at desktop; neither contains this page's centered icon/action/instructions. Upload intentionally adapts their styling and content-driven sizing. Longer product text reflows rather than forcing identical component heights.

Both themes and all four requested viewport sizes are covered, including file/sample state reflow, long filenames, 200% text enlargement, complete scrolling and bottom-navigation clearance. No horizontal page overflow was observed.

## G. Local screenshot evidence

Ignored evidence root: `frontend/playwright-report/c2b/`.

- `comparison.html`: original source / previous Upload / refined Upload at matched viewports, with links to each state at original resolution.
- `{dev|preview}-{1440|768|390|320}-{light|dark}-{empty|selected|error|sample}.png`: 64 full-page state screenshots.
- `{dev|preview}-{width}-{theme}-bottom-clearance.png`: 16 viewport captures at the final sample action.
- `source/reference-{width}-{theme}-empty.png`: 8 fresh original-source fixture captures.
- `source/{reference|target}-{width}-{theme}-component.png`: 16 component captures.
- `source/measurements.json`: 16 source/target measurement records, actual rendered-font inspection and network/error observations.
- `{dev|preview}-{width}-{theme}-measurements.json`: detailed target empty-state measurements.
- `../c2a/target-{width}-{theme}-empty-full.png`: preserved before screenshots.

Full-page browser captures place a fixed bottom bar at the initial viewport boundary within the long image. This is a capture artifact; dedicated scrolled viewport screenshots and clearance assertions verify that final actions remain reachable.

## H. Verification

Required final checks: typecheck, lint, unit, build, development E2E and preview E2E. Unit suite: 108 tests. Development and preview suites: 129 tests each, including 9 new Upload cases per mode; no removed coverage. Exact final results and logs are recorded in the ignored evidence report.

The first implementation run caught a stale shared unit assertion for the replaced large disclaimer and a hardcoded synthetic fixture byte count in the new browser test. Assertions now verify the requested disclaimer and actual fixture size. The source comparison harness initially used the wrong isolated URL; it was corrected to `/source`. Final review also added a native related-target drag transition regression. These were corrected before the final verification/commit.

## I. Preservation

The 240-file pre-edit hash inventory covers application code, reference source and existing backend files. Only the intended existing Upload source changes within that inventory. The shell unit assertion is also intentionally updated; new scoped files/tests/documentation are explicitly staged.

Protected Home, header, navigation, Landing, authentication, all six other feature implementations, fixtures, dependencies and configuration remain byte-identical. The full regression suites retain seven-route discovery, theme persistence, dialogs and in-memory feature interactions. Saved screenshot comparisons and their exact pixel differences are in `protected-comparison.json`; native control/label rasterization differences are reported rather than claiming every screenshot is pixel-identical.

## J. Files changed

1. `src/features/demo/UploadPage.tsx`
2. `src/features/demo/upload-file.ts`
3. `src/features/demo/upload.css`
4. `tests/e2e/upload.spec.ts`
5. `tests/unit/upload-file.test.ts`
6. `tests/unit/shell.test.tsx` — replaces only the Upload disclaimer assertion with the requested concise explanation.
7. `docs/phase-c2b.md`

## K. Git scope

Requested local-only commit: `feat(frontend): refine prescription upload experience`.
The resulting hash and final status are recorded in the local evidence report and completion message. Only the seven files above are staged. Existing backend `.env.example`, `.gitignore`, README/package changes, Prisma configuration/schema files and ignored environment files are preserved. No remote operations or deployment.

## L. Remaining limitations / stopping point

- Selection is metadata-only. Supported extensions and matching nonempty MIME labels are checked; file signatures/content are deliberately not inspected. Blank MIME is allowed for supported extensions, preserving the previous policy.
- The existing limit is exactly 10 MiB (10,485,760 bytes), inclusive, while the requested help text retains “10 MB.” Selected sizes accurately say MiB/KiB.
- There is no OCR, clinical validation, upload, backend connection, cloud saving or real account. Sample medicines remain fictional.
- Visual evidence uses Chromium, synthetic data and reduced-motion captures; native picker appearance and screen-reader speech vary by platform. Live-region semantics/focus are verified, not a manual certification of every assistive technology.
- Original CampusConnect components serve different workflows. Form tokens/type/controls match; product-specific text, column widths and surface heights are intentional adaptations. Owner visual approval remains necessary.
- Phase C.2b stops here. Medicine Insights and the other protected pages are not redesigned.
