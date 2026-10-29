# CampusConnect presentation provenance

Source root: local-only `campusconnect-reference/frontend/src/`. These are selectively reused presentation sources, not MedDecode service contracts. No source reference was modified.

| Reference source | Reuse | SHA-256 of reference snapshot |
| --- | --- | --- |
| `components/ui.tsx` | Selected Button, Badge, Card, EmptyState, PageHeader, SectionHeader and Skeleton functions; safe button type added. | `dac9a4ecc7772e49fddd43a1110bcc5ee04429cca9d0eddf3635870c8b0dc152` |
| `components/Icon.tsx` | SVG Icon implementation copied unchanged. | `92b95d4954e20c4f358347a4e65905ac768e2bc82c5eb8fcc888166b0c3d2c71` |
| `components/class-names.ts` | Existing MedDecode class-name helper retained; no duplicate helper imported. | `85017b982736b4ab3f7c59d2becc3a397465228d1df1fb4101eac1a89040943f` |
| `features/theme/ThemeControl.tsx` | Markup/options copied; imports point to MedDecode theme context. | `6c6862ce007712ff94049c4ab78739ff528728c116d4e4aaddbf3a4228e7b698` |
| `app/AppShell.tsx` | ExploreSheet structure, focus containment/restoration, scroll locking and navigation markup adapted; auth/admin/search/notification services excluded. | `66ebea2db93fc19db9813b8c70594f31ba7bc20e42044b8c9e0b8b3a18f8aef1` |
| `app/app-navigation.ts` | Navigation-item concept reused; exactly seven MedDecode destinations replace campus routes. | `d58f4d36661d808b096aa6a48160a97ada8baac1c19980095e47eab09c95f403` |
| `app/app-shell.css` | Selected header/brand/drawer/mobile rules and motion; desktop sidebar and breakpoints deliberately adapted. | `5ca1ef05b20c4cb38a3ac1bd640f431223c719feeb00bc0acc230cc31a0f7cd5` |
| `index.css` | Base geometry/status tokens and selected primitive rules; application palette overrides win; only one Tailwind import retained. | `3e99c845d56d001f5dda2352b5af0e52b491b16ece5ae386dbc4b970ec5944ee` |
| `assets/fonts/manrope-latin-wght-normal.woff2` | Bundled Manrope font copied unchanged. Inter font not copied. | `a30ddcd349703aff7464c34bef3fffdff405ee50c113440d7c8693c02d210972` |
| `assets/fonts/OFL.txt` | Supplied Manrope SIL OFL notice retained alongside font; trailing whitespace normalized. | `58172e0c0fac2cda8a37b348164bb55e44b0e69051e557e92b1d3f6910141f7b` |

## Selection and intentional differences

- Application palette: `app-shell.css` original lines 1-56 override the older base palette. Base radii, shadows, spacing and semantic statuses come from `index.css` lines 19-113.
- Shared CSS selection includes card, button, badge, page/section headers, empty state, icon box, skeleton, theme control, focus and skip-link rules, retaining applicable media queries. Unneeded components such as modal/tabs/toast are not imported.
- Scoped shell CSS uses the original header/brand/Explore/mobile patterns. Four mobile entries replace the original six.
- Desktop navigation becomes a persistent sidebar at 1200 CSS px. Between 768 and 1199 px, Explore opens the drawer. Below 768 px, Home/Upload/Cabinet/More provides navigation.
- Body font uses system fallbacks because the copied Inter font has unresolved notice provenance. Display typography uses licensed Manrope.
- The original compact theme control is enlarged to 44px minimum targets. Light empty-state copy uses the existing muted token rather than the source subtle token to meet the tested normal-text contrast threshold.
- Existing MedDecode provider, storage key, Query provider, API transport and proxy remain authoritative. Theme-color metadata is aligned with the adopted canvas.
- New sidebar/route placeholders contain no accounts, medical records, feature services or invented application endpoints.
- Source CSS, authentication providers, business workflows, API wrappers, sockets, environment values, generated bundles and reference tests were not copied wholesale.

The original source does not supply an Inter-specific notice in its font folder. No Inter binary is redistributed. Manrope notice: `src/assets/fonts/OFL.txt`. Screenshots remain ignored local evidence; visual owner approval is still required.

## Phase B.3 public landing reuse

| Reference source | Adaptation | Reference SHA-256 |
| --- | --- | --- |
| `features/landing/LandingPage.tsx` | Journey, trust, closing CTA and one-shot IntersectionObserver reveal; removed all highlight fetching. | `a75024d592d49641acd9e8f36abaaef4b118ea3c584bc9c4043279715b18984e` |
| `features/landing/LandingHero.tsx` | Hero markup, typography, actions and assurance row; MedDecode copy replaces campus content. | `90c2328f642b6a006498db54a866e63d38d11d28022b475b49dc5dada7d3446d` |
| `features/landing/ProductPreview.tsx` | Canvas chrome, feature panel and compact rows; static generic labels replace all records, prices and timers. | `b5311daff5fcc293471b8050457178a54a873d84c00a0128905fd32dd35ea194` |
| `features/landing/PlatformShowcase.tsx` | Selector, aria-pressed controls, live frame and responsive layout; six planned capabilities replace module scenes. | `b84976874e1d4691103369f162ae836970c4c1baec73d3565b0f2b1ef4410366` |
| `features/landing/ContentVisual.tsx` | Media-free grid/gradient artwork composition; existing shared Icon SVGs replace campus category paths. | `d89415968d570e456f569cce209add745a97d16a49475096c6288a0c1f39bdb4` |
| `components/PublicChrome.tsx` | Public branding, sticky/scrolled header, mobile disclosure and footer; no auth providers or support identifiers. | `75760100d6e1b9403ec442fadd8fe4f33477b5ff94f2a3ffff2ea1c8836ce919` |
| `components/PublicThemeToggle.tsx` | Inspected; binary toggle excluded in favor of existing three-mode ThemeControl. | `f9b9cfb35cac5b7e79d1afad719bac5138a536bfd1ffe9ea1e042d9cd12eb4db` |
| `features/landing/landing-refinement.css` | Selectively extracted matching rules, nested media queries, palettes and reveal keyframes; unrelated scenes excluded. | `5c28673770e5cc03f5debc429c5ac96def4103e7350ac4060386eabce30cdcc2` |
| `index.css` | Only relevant public header, brand, footer and responsive base rules extracted and scoped. | `3e99c845d56d001f5dda2352b5af0e52b491b16ece5ae386dbc4b970ec5944ee` |

The source hierarchy is hero/workspace preview, module showcase, three-step journey, editorial experiences, trust, closing CTA and footer. MedDecode retains the hero, adapted showcase, journey, trust, closing CTA and footer; campus editorial records are excluded. The selected stylesheet retains the winning public palette, content-sized hero, 1100px header/hero breakpoint, 1200px showcase breakpoint, 767px and 359px adaptations, source shadows and restrained reveals. Base public rules load before scoped landing overrides. No workspace selectors are added or changed.

Source CSS is selected by used class names, keeping applicable nested media rules and shared tag/pseudo rules within `.cc-landing-page`; the entire feature stylesheet is not copied. Two preview heading selectors are adapted to maintain a single h1 and sequential heading levels. Unused highlight/data scenes, timed spotlights, auth links, account identifiers, price examples, remote requests and campus artwork paths are excluded. The shared Icon, UI primitives, licensed font and theme provider are reused without edits. Body typography remains a system fallback pending Inter notice resolution.

The public menu is a nonmodal disclosure: normal Tab order remains available; focus moves to its first link, Escape restores the trigger, navigation/outside interaction/focus departure closes it, and widening to desktop closes it. Source scroll locking is deliberately omitted because this is not a modal drawer. Links remain ordinary links. Hash navigation focuses and scrolls to labelled sections below the sticky header. Existing workspace drawer behavior remains unchanged.

`/get-started` and `/sign-in` are temporary frontend-only coming-next states. They contain no forms, credential collection, sessions or authentication requests. Phase B.4 can replace their route elements; all landing CTAs already share these destinations. `/home` and the other six workspace routes remain available as development previews.

Public palettes retain the source landing-specific dark canvas `#0b0d14` and light canvas `#f8f9fc`; the accepted workspace palette remains untouched. All three theme modes share `meddecode-theme`. Neutral illustrations show no prescription results, medicine names, warnings, prices or savings. Intended capabilities and current implementation limits are identified in visible copy.
