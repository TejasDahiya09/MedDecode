> Current checkpoint: B.4a.2 below supersedes earlier font, Google-control and public-theme decisions. Earlier phase sections document historical checkpoints.

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
| `components/PublicThemeToggle.tsx` | Binary public toggle restored in B.4a.1, with explicit System preference disclosure using the existing provider. | `f9b9cfb35cac5b7e79d1afad719bac5138a536bfd1ffe9ea1e042d9cd12eb4db` |
| `features/landing/landing-refinement.css` | Selectively extracted matching rules, nested media queries, palettes and reveal keyframes; unrelated scenes excluded. | `5c28673770e5cc03f5debc429c5ac96def4103e7350ac4060386eabce30cdcc2` |
| `index.css` | Only relevant public header, brand, footer and responsive base rules extracted and scoped. | `3e99c845d56d001f5dda2352b5af0e52b491b16ece5ae386dbc4b970ec5944ee` |

The source hierarchy is hero/workspace preview, module showcase, three-step journey, editorial experiences, trust, closing CTA and footer. MedDecode retains the hero, adapted showcase, journey, trust, closing CTA and footer; campus editorial records are excluded. The selected stylesheet retains the winning public palette, content-sized hero, 1100px header/hero breakpoint, 1200px showcase breakpoint, 767px and 359px adaptations, source shadows and restrained reveals. Base public rules load before scoped landing overrides. No workspace selectors are added or changed.

Source CSS is selected by used class names, keeping applicable nested media rules and shared tag/pseudo rules within `.cc-landing-page`; the entire feature stylesheet is not copied. Two preview heading selectors are adapted to maintain a single h1 and sequential heading levels. Unused highlight/data scenes, timed spotlights, auth links, account identifiers, price examples, remote requests and campus artwork paths are excluded. The shared Icon, UI primitives, licensed font and theme provider are reused without edits. Body typography remains a system fallback pending Inter notice resolution.

The public menu is a nonmodal disclosure: normal Tab order remains available; focus moves to its first link, Escape restores the trigger, navigation/outside interaction/focus departure closes it, and widening to desktop closes it. Source scroll locking is deliberately omitted because this is not a modal drawer. Links remain ordinary links. Hash navigation focuses and scrolls to labelled sections below the sticky header. Existing workspace drawer behavior remains unchanged.

`/get-started` and `/sign-in` are temporary frontend-only coming-next states. They contain no forms, credential collection, sessions or authentication requests. Phase B.4 can replace their route elements; all landing CTAs already share these destinations. `/home` and the other six workspace routes remain available as development previews.

Public palettes retain the source landing-specific dark canvas `#0b0d14` and light canvas `#f8f9fc`; the accepted workspace palette remains untouched. All three theme modes share `meddecode-theme`. Neutral illustrations show no prescription results, medicine names, warnings, prices or savings. Intended capabilities and current implementation limits are identified in visible copy.

## Phase B.4a authentication presentation

| Reference source | Selected reuse | Reference SHA-256 |
| --- | --- | --- |
| `features/auth/LoginPage.tsx` | Split-screen/page/form-card composition; provider/session/redirect operations excluded. | `a6e1ec55e63c6e07f0df182f06a3a5de501de0733cb8ac27b58aeeb44db48419` |
| `features/auth/LoginForm.tsx` | Field grouping, label row, eye SVG and visibility control, input classes and inline-error relationships. Local validation replaces async submit callbacks. | `716781e77916d2ce12ec4b1c68ad0ffbc1841e2b6a31fb44d67734cc72340d24` |
| `features/auth/LoginStory.tsx` | Introduction structure and MedDecode story copy; session-restoration component excluded. | `43041c9362f602664129926eece55efa302e9cdf77dc5e5b3638565e8aa9a3d9` |
| `features/auth/LoginKineticRibbon.tsx` | Original SVG paths, gradients, SMIL morphs, CSS layers and lifecycle handling restored in B.4a.1 (initial B.4a adaptation was static). | `71d9e60fed7701a4431f3642c8bfc01aa898989c06238bbad58c0670cd3a3029` |
| `features/auth/AuthPages.tsx` | PremiumAuthLayout and register/recovery compositions reviewed; required identity fields and confirmation pattern retained. Success states, recovery-session checks, token/callback handling, provider operations and Google controls excluded. | `2a87e7c510e987498ba7018bae19bfb27340c4c8b433453f2c268c0312086c22` |
| `features/auth/login.css` | Only matching auth layout/story/ribbon/field/action/feedback rules, palettes and responsive overrides selected; shared Button-dependent selectors explicitly retained. | `79c5ea4b57c30c12f7ca808d087076fa75ea77f23ed9efcec0137989f036a6fd` |
| `components/PublicChrome.tsx` | Already adapted PublicBrand exported for auth reuse; landing markup unchanged. | `75760100d6e1b9403ec442fadd8fe4f33477b5ff94f2a3ffff2ea1c8836ce919` |
| `components/ui.tsx` | Existing MedDecode Button retained unchanged. Source FieldMessage/InlineAlert inspected; inline field feedback adapted locally to support stable IDs and one submit-level announcement. | `dac9a4ecc7772e49fddd43a1110bcc5ee04429cca9d0eddf3635870c8b0dc152` |
| `index.css` | Only base public-brand and brand-mark rules copied with an auth ancestor scope. | `3e99c845d56d001f5dda2352b5af0e52b491b16ece5ae386dbc4b970ec5944ee` |

`AuthPage` shares the source-derived layout across Sign In, Create Account, Forgot Password and Reset Password. It reuses the existing ThemeControl, Icon, Button and licensed Manrope. Body typography retains the current system fallback. The source 1120px split and 600px/359px form adaptations remain. On mobile, the toolbar/footer participate in normal flow to prevent overlap at 200% root text sizing; form centering and source surfaces remain. B.4a initially used three-mode controls; B.4a.1 restores the contextual binary toggle with an explicit System disclosure; no alternate provider or storage key is introduced. Input text uses 16px at the default root size, field/help/error text 14px, password toggles and theme controls at least 44px. The source primary gradient geometry retains white text in both themes; its normal/hover stops use existing #4f46e5/#4338ca/#5550e8 indigos so every stop exceeds 4.5:1 (the source #6366f1 and #7174f5 stops measured 4.47:1 and 3.81:1).

The source registration field spacing is composed from shared LoginForm classes rather than copied label-wrapped controls. Each password and confirmation gets its own labelled visibility toggle. Errors appear on blur/submit, revalidate after correction, remain associated through `aria-describedby` and `aria-invalid`, and focus the first invalid input on submit. A persistent polite status region announces honest unavailable outcomes. No fake loading, account existence, success, session restoration or recovery verification is presented.

New-password/registration use a provisional client-only 8-128-character preview baseline with matching confirmation; sign-in only requires a nonempty password. This is not a Supabase policy. Email syntax follows the HTML email pattern. Values remain in local React state while the screen is mounted; keyed auth routes discard them when navigating away. No form handler invokes a service, logs input, reads recovery query/fragment values, or writes storage/cookies. Social-login UI is excluded because no provider contract is approved.

`/get-started` now replaces its history entry with `/sign-up`. `/sign-in`, `/sign-up`, `/forgot-password` and `/reset-password` render standalone auth presentation without public/workspace navigation. The existing route-focus helper handles cross-page focus; it interprets section fragments only at `/`, so recovery URLs are not treated as content anchors. Actual secure recovery validation, provider loading/errors, sessions and integration remain future work. Approved landing styles/components, workspace shell and generic transport remain authoritative and unchanged apart from the PublicBrand export and retired temporary access component.


## Phase B.4a.1 motion and theme fidelity

Root causes: B.4a removed all four SVG SMIL path morphs and CSS motion from the original kinetic ribbon, omitted its visibility/intersection/media-query lifecycle, and explicitly disabled descendant animation. Auth/public headers used the workspace three-part ThemeControl instead of the source PublicThemeToggle. Source brand styling and compact premium-registration rules were also omitted.

AuthRibbon now reuses LoginKineticRibbon.tsx directly: identical SVG geometry, gradients, layer order, keyTimes, keySplines (0.45 0 0.55 1), spline mode and indefinite durations 12s/9s/11s/6.5s. Source CSS restores back drift (12s), main flow (9s), fold drift (11s), highlight (6.5s) and aura (22s), all ease-in-out alternate; entry remains 560ms/140ms cubic-bezier(0.22,1,0.36,1). Browser SVG methods are capability-checked for non-SVG test environments. Original visibilitychange listener, IntersectionObserver threshold .05 and matchMedia listener pause offscreen/hidden SVG and CSS motion, remove morph elements for reduced motion, and clean up on unmount. No per-frame React state or animation dependency. Source tests login-ui.test.ts and auth-pages-ui.test.ts were reviewed.

PublicThemeToggle.tsx reuses components/PublicThemeToggle.tsx icon, next-mode label and two-state action. Public CSS comes from features/landing/landing-refinement.css lines 136-169 (44px icon control). Auth CSS comes from features/auth/login.css lines 276-322 and 881-893 (desktop pill, mobile icon, source hover/active/transitions). A separate 44px disclosure sits to the left, leaving the main toggle at the source right edge. It exposes the existing three-mode ThemeControl, closes on selection/Escape/outside/focus departure, and identifies the current preference. ThemeProvider, early initialization, meddecode-theme and workspace controls are unchanged. The extra disclosure is a deliberate visual deviation required to retain discoverable System support.

Layout: original 1.18fr/.92fr desktop split, 1120px breakpoint, story backgrounds/circles, 29rem login and 30rem premium card widths, premium registration padding/heading/gaps are retained/restored. MedDecode story text is preserved. Secondary recovery links share a wrapping row to avoid excess card height/toolbar overlap. Earlier 16px inputs, 14px field/help/error text, 44px touch targets, contrast-corrected indigo buttons, honest preview messaging and normal-flow mobile toolbar/footer remain. Inter is still not redistributed because the reference has no Inter-specific license notice; existing system body fallback/Manrope headings remain a known typography difference. Different copy, no Google block and preview/helper/link content change card heights and ribbon placement relative to longer source stories.

Direct reference runtime: isolated Chromium context against localhost:5173, with fetch/XHR and WebSockets blocked and no credentials or submissions. Source ribbon and login.css SHA-256 match the read-only reference. All four source screens were captured in both themes at 1440x900 and 390x844, including the source reset form's unavailable-link state. Comparisons and computed metrics are ignored local evidence under playwright-report/b4a1. No pixel-perfect claim is made. Actual visible path coordinates and layer transforms change over wall-clock time; reduced-motion samples are identical and offscreen pausing is asserted. Original source SVG/CSS are used for deterministic time-aligned comparison and recordings.

Protected: auth-presentation.ts, AuthField.tsx, API client, theme provider, package/lock/config, backend/intelligence, landing sections/styles/content, workspace and read-only reference are unchanged. Validation, ephemeral form state and unavailable submissions are unchanged; no service imports, Google UI, session/token handling or real requests were added.

Final regression checks preserve the existing public-header height via a 54px appearance wrapper; normal 390px and 1440px Light/Dark landing pixels below the header match the pre-change captures exactly. At 320px with 200% root text, public icon controls retain 44px targets and the preference panel aligns inside the viewport. These are layout safeguards around the source toggle, not landing-section changes.


## Phase B.4a.2 exact presentation reconciliation

Audit: oversized composition came from the in-card preview paragraph, extra secondary-link rows, 14px label overrides, 16px desktop input override, missing Google/divider blocks, system body fallback, generic label-row wrappers and the added public appearance disclosure. Before editing, matching 1440x900/390x844 source/target measurements and screenshots were captured in both themes (audit-before.json).

Source selection: login.css rules from page/story/ribbon through premium form primitives, register overrides, form/header/field/action/divider/security blocks, responsive/theme rules and relevant entry/ribbon keyframes are reused in their original order. Confirmation, callback, restoration-spinner and other unused state rules are excluded. AuthField uses source LoginForm direct labels/password rows and premium cc-label/cc-field geometry while keeping stable IDs, descriptions and independent visibility controls. AuthPage follows LoginPage/PremiumAuthLayout story, toolbar, card and security composition. Source LoginForm GoogleMark paths and action/divider geometry are reused; Sign Up retains the AuthPages secondary-button and flex-divider variant. PublicThemeToggle now mirrors the original single-button component, with MedDecode's provider import. LoginStory, LoginKineticRibbon, shared ui.tsx, Icon.tsx and original font declarations were inspected; no source auth service is imported.

Typography provenance is resolved: @fontsource-variable/inter 5.3.0 contains a 48,256-byte upright Latin variable WOFF2 whose SHA-256 (3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62) exactly matches the reference. The corresponding package/LICENSE is included unchanged as Inter-OFL.txt; asset origin and official upstream/distribution links are in assets/fonts/Inter-PROVENANCE.md. The source font weights 100-900 are declared under the CSS-only alias MedDecode Auth Inter to keep landing/workspace fallback fonts unchanged. Manrope 200-800 and its notice remain unchanged. The binary is unchanged, no font dependency was installed, and no runtime remote font request is made.

Normal desktop source geometry: split 809.14px/630.86px at 1440px, Sign In card 464px wide, premium cards 480px, default input/button minimum 50.4px, registration minimum 46.4px, labels 12px/650, login row gaps 16.8px and register gaps 12px. Actual matched capture tables (including heights, positions, headings, labels, buttons, ribbon and toggle bounds) are in ignored COMPARISON.md and JSON. Source CSS determines responsive 1120px/600px/359px behavior.

Necessary/accessibility deviations: existing contrast-corrected indigo gradient stops remain because source normal/hover white-text contrast is below 4.5:1 at a stop; field focus keeps an explicit outline; visibility controls retain 44px targets; mobile fields stay 16px to avoid focus zoom; mobile toolbar/footer use flow to prevent overlap with enlarged text. These are scoped to auth. Public-header height remains the approved 78px below 1100px and its content regions are screenshot-compared against pre-edit captures. Different story/description lengths legitimately affect line breaks/ribbon position; the source reset unavailable-token warning is not fabricated in the presentation-only target.

Public System disclosure removed as explicitly requested. A stored/default System mode still resolves normally; one click selects its opposite, subsequent clicks alternate, and reload/cross-tab persistence is preserved. Workspace controls/provider are unchanged.

The small footer exposes Account access is not connected yet and a Back to MedDecode link. Google activation only announces Google sign-in is not connected yet. Nothing was sent. Email submission still validates locally and announces its existing unavailable result. No fake sessions/success, requests, tokens, credential logging/storage, environment changes, backend/intelligence changes or cloud operations are introduced. Old preview-policy wording is now concise visually, with its provisional nature retained for assistive technology. Source ribbon component is unchanged, and time-aligned source/target motion is rechecked after layout changes.

A final 320px/200% text probe found the source nowrap Google action could force a clipped min-content grid track despite document scrollWidth remaining within the viewport. The mobile panel now uses minmax(0,1fr), its form card can shrink, and action text wraps. Normal geometry is retained; enlarged-text tests now assert every form label/input/button stays inside the viewport, including Google text overflow.

Browser motion evidence separates real-time compositor drift from deterministic SVG morph geometry at 0s/3s because live getPointAtLength samples can remain stale in headless Chromium. Both mechanisms, all four morph paths, offscreen pause/resume and reduced-motion stability remain asserted. The source component is unchanged.

## Phase B.4a.3 shared card-heading typography

A computed audit confirmed Sign In/Forgot/Reset used the generic source clamp(2.25rem,3.1vw,3.25rem), line-height 1.03 and .55rem top margin, while registration's more-specific rule used clamp(2rem,2.5vw,2.55rem), line-height 1 and .4rem margin. At 1440px this meant 44.64px versus 36px. Forgot Password was not computed larger than Sign In; its longer wording made the shared large style more conspicuous. Registration also had different intro spacing, and its heading override defeated generic mobile rules.

The compact CampusConnect registration baseline now lives once in .cc-login-form-wrap h1: existing licensed Manrope Variable, weight 730, clamp(2rem,2.5vw,2.55rem), line-height 1, -.055em spacing, .4rem top margin. Registration-only title/intro and nowrap/normal exceptions are removed. Source mobile heading adaptations remain shared: clamp(2.1rem,10vw,2.65rem) through 600px, then 2rem below 360px. Descriptions share source compact .55rem top margin, .9rem size and line-height 1.5, retaining the source narrow-screen size adaptation. Natural balanced wrapping has no forced maximum width or fixed heading/card height.

At 1440px all titles measure 36px/730/36px/-1.98px; at 768px 32px, at 390px 39px, and at 320px 32px. New browser coverage compares complete heading/description styles across all four routes in both themes after fonts load, checks wrapping/separation and 200% text reflow. Existing Sign In geometry expectations reflect its smaller content-driven card; widths, fields, buttons and split assertions remain. Before/after measurements and screenshots are ignored under playwright-report/b4a3. Story/ribbon, branding, form logic, controls, public landing and workspace implementation remain unchanged.

Preview verification exposed an existing workspace test race: its link-focus assertion ran before the route's requestAnimationFrame focus completed. The test now awaits main focus after browser-history navigation, then asserts link focus and the same solid outline with Playwright's retrying CSS assertion. No workspace implementation or focus styling changed.

A subsequent development run exposed a second existing timing race: the reduced-motion test sampled SVG time after animate nodes disappeared but before Chromium painted the static SVG. Its existing reduced-motion screenshot now precedes the unchanged static-sample comparison to flush that paint. The ribbon implementation and full static-motion assertion remain unchanged.


## Seven-section frontend demonstration

The existing MedDecode AppShell, seven-route navigation, shared Button/Card/Badge/PageHeader/SectionHeader/EmptyState, Icon paths and theme infrastructure are reused. Source landing/auth components and CSS are unchanged. Demo styling stays under md-demo classes; demo/welcome.css retains the complete CampusConnect home.css welcome block (before cc-home-primary-grid). The welcome heading is rendered as an h2 because the page retains the existing Home h1. Palette, gradients, borders, radii, typography and line treatment come from the reference.

DemoModal adapts reference components/ui.tsx Modal: 34rem surface, source padding/radius/shadow, blurred overlay, close control, Tab wrapping, Escape and restored focus. A native top-layer dialog adds background inertness without a new dependency. CRUD forms and reference cards extend the existing field/card conventions. New diagrams are inline code-native illustrations of fictional reference cards; no medical records or external/generated assets are used.

A shared in-memory provider supplies cabinet/reminder changes and dashboard counts. All seven pages are explicitly labelled Demo Mode, use synthetic fixtures and distinguish absent clinical verification. No API, Supabase, Prisma, file read/upload, persistent medical state or notification service is invoked. Public theme behavior, the approved authentication layouts and the original shell navigation/breakpoints remain intact. Only obsolete placeholder test expectations change to assert complete demo UI while preserving route, focus, theme and no-request checks.
