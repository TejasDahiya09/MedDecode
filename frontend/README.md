# MedDecode frontend foundation and shell

Run all commands from `frontend/`. Verified with Node 24.11.1 and npm 11.6.2; the package engine range is `^22.13.0 || >=24.0.0`.

## Installation and development

The current workspace is a complete frontend-only demonstration. Open `/home` after starting Vite. All seven sections work without a backend, database or account. Cabinet/reminder changes are in memory and reset on reload; selected files are neither read nor uploaded. The landing and authentication pages retain their approved presentation. Earlier placeholder descriptions below are historical; see the current demo section at the end.

```powershell
npm install --strict-peer-deps
npm run dev
```

The frontend starts at `http://127.0.0.1:5174` without backend configuration. Ports are strict. It makes no application API calls on boot. The dependency lockfile is retained; the shell adds only React Router to the B.1 stack.

## Navigation and scope

| Section | Frontend route |
| --- | --- |
| Home | `/home` |
| Upload Prescription | `/upload-prescription` |
| Medicine Insights | `/medicine-insights` |
| Compare Medicines | `/compare-medicines` |
| My Cabinet | `/my-cabinet` |
| Reminders | `/reminders` |
| Learn & Resources | `/learn-resources` |

`/` renders the public landing described below. Unknown routes have an accessible not-found state and a Home link. These are navigation placeholders, not product features or application API routes. There are no login restrictions, patient records, medical examples, predictions, fabricated alerts, or account data.

At 1200px and wider, a persistent sidebar exposes all seven sections. From 768-1199px, Explore opens the adapted drawer. Below 768px, Home/Upload/Cabinet/More forms the bottom navigation. More exposes all seven sections and retains current-section indication. The drawer supports Escape, focus containment/restoration, inert background, body scroll locking and navigation close. Route changes update the title and focus main content. Bottom clearance includes browser safe-area insets.

## Presentation provenance

See [SOURCE-REUSE.md](SOURCE-REUSE.md) for source paths, hashes, retained components and intentional adaptations. CampusConnect's actual primitives, inline SVG icons, theme controls, application palette and selected shell rules are reused. Source authentication, services, roles, sockets and domain workflows are excluded. Manrope and its supplied SIL OFL notice are bundled. Inter is not redistributed; body text uses system fallbacks until attribution is resolved. No modal, tabs or toast components are imported unnecessarily.

The reference is protected by the clone-local `.git/info/exclude` entry `/campusconnect-reference/`; this is not shared repository configuration. New clones need their own local exclusion if they contain the reference.

## Theme and transport

The existing MedDecode provider and `meddecode-theme` storage key remain authoritative. Light/Dark/System, pre-React initialization, storage fallback, OS changes and cross-tab updates are retained. The root `data-theme` drives CSS variables, native color scheme and Tailwind's dark variant. The application canvas is Light `#f8f9fc` / Dark `#0d1018`.

`.env.example` retains an empty public `VITE_API_BASE_URL`. No real environment file is created. Optional development configuration is `http://127.0.0.1:5174/backend`: `/backend/health` proxies to `http://127.0.0.1:3000/health`. `/backend` maps to `/`; `/backend-other` is excluded. The proxy is development-only. No backend call was made to verify live connectivity.

The B.1 generic JSON helper is unchanged. It transports JSON and multipart options, preserves cancellation, separates error categories and returns `T | undefined` for JSON/empty successes. It does not validate feature schemas, invent endpoints, establish authentication or impose a timeout. Production needs explicit API configuration and server contracts. Never expose server/cloud secrets through browser variables.

## Verification

```powershell
npm run typecheck
npm run lint
npm run test:unit -- --run
npm run build
npm run test:e2e
npm run test:e2e:preview
```

All commands were verified for this phase. `npm test` remains a one-run unit-test alias. `npm run preview` serves the built app on port 4174. Browser suites manage development/preview servers and refuse to reuse occupied ports. If Chromium is unavailable, the verified installation command is `npx --no-install playwright install chromium`.

Tests retain API/proxy/theme regressions and cover route placeholders, active navigation, history, drawer keyboard/focus/background behavior, not-found recovery, scroll clearance, loaded Manrope, reduced motion, contrast and overflow. Browser checks run in Chromium at 390x844, 768x1024 and 1440x900 in Light/Dark, plus 320px and 720px reflow. The 720px check simulates 200% available width for a 1440px window; it is not native browser-zoom certification. Cross-browser and full assistive-technology conformance are not claimed.

Screenshots are ignored under `test-results/evidence/`: `{dev|preview}-shell-{mobile|tablet|desktop}-{light|dark}-{width}x{height}.png`, plus `*-shell-mobile-more-open-390x844.png` and `*-shell-desktop-navigation-focus.png`. Animations are completed for stable captures. Development runs clear the default test-results directory; capture both suites before archiving evidence. Screenshots remain subject to owner visual approval and are not committed.

No complete Home page, authentication, prescription, medicine, cabinet, reminder or resource workflow has been implemented. The next phase requires separate approval.

## Phase B.3 public landing

`/` now renders the source-adapted MedDecode public landing, without the workspace sidebar or bottom bar. Sections cover the hero, six planned capabilities, an intended three-step process, responsible use and a closing CTA/footer. Illustrations are static and contain no medical results. Get Started uses `/get-started`, now a replacement redirect to `/sign-up`. Sign In opens `/sign-in`. These render the frontend-only B.4a forms described below; account operations remain unconnected. `/home` and all established workspace routes remain accessible without guards.

The public header reuses CampusConnect presentation; B.4a.1 restores its compact binary toggle with an explicit System preference disclosure. Below 1100px it uses a nonmodal Explore disclosure with keyboard focus, Escape restoration, normal Tab order, outside/focus departure close and navigation close. Hash links focus labelled sections below the sticky header. Public/workspace route changes preserve theme state and focus the main content.

B.3 evidence lives in ignored `test-results/evidence/`: `{dev|preview}-landing-{mobile|tablet|desktop}-{light|dark}-{full|viewport}.png`, plus `*-landing-mobile-menu-open.png`, `*-landing-desktop-light-cta-focus.png`, `*-landing-desktop-light-process.png` and `*-landing-{desktop|mobile}-light-footer.png`. Full-page captures are complemented by viewport details. All six mandatory checks cover both the prior shell and landing. Only Chromium is verified; 720px available-width testing models 200% reflow without certifying native browser zoom. Owner screenshot review remains required for visual approval.

## Phase B.3.1 mobile refinement

Below 768px, the existing six capability buttons form a single-column list instead of an unlabelled horizontal scroller. Their `aria-pressed` state, keyboard order and live detail panel are unchanged. Desktop and tablet layouts remain as before. Targeted card descriptions, preview body copy, process descriptions, footer copy and preview notes use 14px at the default root size; supporting preview labels/captions use 12px. Colors, illustrations, section order, public navigation, route definitions and workspace components are unchanged.

The previous 390px selector measured 994px scroll width inside a 354px area; descriptions were 10.88px and the preview footer 8.8px. Existing muted-text contrast against the five source surfaces measured 5.07-5.86:1 in Light and 6.85-8.81:1 in Dark, so no palette change was needed. New 320px/390px checks cover every button with touch and Space/Tab, selected-state exclusivity, detail content, target dimensions, text sizes, no horizontal clipping and 200% text-only enlargement in the reviewed areas. This does not certify native browser zoom, whole-site OS text scaling or all assistive technologies.

Ignored refinement evidence is under `playwright-report/b3-1-after/`: `{dev|preview}-mobile-{320|390}-{light|dark}-{full|capabilities|larger-text-full}.png` and `{dev|preview}-desktop-{light|dark}-{viewport|full|capabilities}.png`. Measurements are saved beside mobile captures. The capability crops hide only sticky navigation/skip-link overlays during capture so all section content is visible. Before captures and measurements are local under `playwright-report/b3-1-before/`. Desktop Light/Dark viewport and capability captures were byte-identical before/after at 1440x900. Full-page mobile captures remain subject to owner review.

## Phase B.4a authentication UI

Routes: `/sign-in`, `/sign-up`, `/forgot-password`, `/reset-password`; `/get-started` redirects with replacement to `/sign-up`. Auth screens reuse CampusConnect split-screen/card/field/ribbon presentation and MedDecode's existing Light/Dark/System provider. B.4a.1 restores the original SVG SMIL/CSS kinetic ribbon and its lifecycle handling; no new asset dependency is introduced. Mobile toolbar/footer flow avoids overlap with enlarged text. Primary button gradients use existing indigos with at least 4.5:1 white-text contrast in normal and hover states. Source social-login controls are omitted without a provider contract. Landing design and all seven workspace destinations remain unchanged and unguarded.

Forms validate locally on blur and submit, keep input during corrections, focus the first invalid field, link inline errors to inputs, and offer independently labelled password visibility controls. Only name/email/password/confirmation fields are present where applicable. Sign-up/reset use a provisional 8-128-character client-only password baseline and matching confirmation, not a claimed Supabase policy. Sign-in requires a password without inventing an existing-account length policy. Form submission immediately announces that the action is not connected; no credentials leave the page and no account, session, email or password update occurs. There are no service callbacks, timers, fake network failures or success states. Inputs remain ephemeral React state, are discarded on navigation, and are not saved to application storage or logs. Recovery query/fragment values are not consumed. Browser-managed autocomplete remains standard `name`, `email`, `current-password` and `new-password`.

All required commands remain those listed above. New component/browser tests cover all four forms, correction/matching, Enter submission, visibility, unavailable feedback, storage/request absence, history and theme compatibility. Rendering is checked in both themes at 1440x900, 768x1024 and 390x844. Auth is also checked at 320px with 200% root text sizing and a 390x360 constrained viewport. These simulations do not certify native phone keyboards or full accessibility compliance. Only Chromium is verified.

Ignored rendered screenshots: `playwright-report/b4a/{dev|preview}-{sign-in|sign-up|forgot-password|reset-password}-{desktop|tablet|mobile}-{light|dark}.png`; validation captures `*-{screen}-validation-mobile.png`; visible/focused-control captures `*-sign-up-password-visible-desktop.png` and `*-sign-up-focused-control-desktop.png`. Visible-password evidence uses a synthetic preview-only string. Landing before captures are under `playwright-report/b4a-before/`. Visual owner approval is required before proceeding to B.4b integration.


## Phase B.4a.1 fidelity checkpoint

Auth uses the original animated CampusConnect ribbon (SVG path morphs plus CSS drift/highlight/aura), pausing when hidden/offscreen and becoming static for reduced motion. Auth pills and public icon toggles retain the source visual variants. The adjacent preference disclosure exposes Light/Dark/System using the existing provider, persistence key and cross-tab synchronization; the seven-route workspace keeps its existing control. Theme changes preserve form input. All account actions remain presentation-only.

Ignored evidence lives under playwright-report/b4a1: reference/MedDecode desktop/mobile Light/Dark screenshots, focused theme controls, source and MedDecode recordings, time-separated ribbon frames, motion-observations.json and reference/target comparison metrics. Normal auth screenshots retain the b4a filename pattern and are copied into b4a1 for this checkpoint. Browser checks include 320px enlarged text, 390x844, 768x1024, 1440x900, and constrained 390x360 form use. Native phone keyboards and other browser engines are not certified. See SOURCE-REUSE.md for exact source mechanisms and documented differences. Owner visual approval is required before further integration.


## Phase B.4a.2 current authentication presentation

This checkpoint supersedes the earlier static-ribbon, font-fallback and public System-disclosure descriptions. Public pages now show only CampusConnect's binary Light/Dark control; an initial internal System preference follows the OS until the first click selects the opposite effective theme. Workspace three-mode controls, initial paint, meddecode-theme storage and synchronization remain unchanged.

Auth uses the verified source Inter binary (Fontsource-variable/inter 5.3.0, exact SHA-256 match) with its supplied Inter-OFL.txt and Inter-PROVENANCE.md. An auth-only font-face alias leaves approved landing/workspace typography untouched. Source Manrope headings, split layout, 29rem/30rem cards, labels, field geometry, registration gaps, Google mark/button/divider and compact navigation are restored. A small footer line states that account access is not connected; activation announces unavailable actions without creating accounts, sessions or requests. Google presentation is restored without OAuth logic.

Client validation rules and ephemeral values are preserved. Concise MedDecode story/form copy replaces campus content; reset heading is Set a new password. The original kinetic ribbon is unchanged from B.4a.1, including SVG morphs, CSS drift, lifecycle cleanup and reduced motion. Mobile retains 16px inputs and a flowing toolbar/footer for enlarged-text and keyboard resilience; primary gradients retain the documented contrast correction.

Ignored evidence: playwright-report/b4a2/COMPARISON.md, audit-before.json, audit-after.json, dev/preview-geometry.json, screen/header PNGs, time-separated ribbon frames, source-target motion comparison and local recordings. Required checks remain typecheck, lint, unit, build, development E2E and preview E2E. Only Chromium and simulated phone viewports/keyboard constraints are verified by these checks. Stop for owner visual approval before any authentication integration.


## Seven-section demo workspace

- Home: example prescription overview, live cabinet/reminder counts, quick actions and labelled sample activity.
- Upload Prescription: JPG/PNG/PDF selection/drop (10 MB maximum), filename/size display, removal, errors and View Sample Analysis. File contents are not read, persisted or transmitted. Predefined analysis is independent of any selected file.
- Medicine Insights: searchable fictional references and explicit unavailable clinical fields.
- Compare Medicines: searchable selectors, aligned properties, swap/reset and empty states; no clinical equivalence or substitution claim.
- My Cabinet: in-memory add/edit/remove, search, inventory filters, confirmations and feedback.
- Reminders: local CRUD and enabled/paused switches; no browser/push/SMS/background scheduling.
- Learn & Resources: searchable/filterable product walkthroughs and article dialogs; no fabricated medical citations.

Shared types and fixtures: src/features/demo/demo-data.ts. DemoProvider owns cabinet/reminder state for a workspace visit. Reload or leaving the workspace resets those changes. Files remain in their page memory until removal or navigation. The identity Demo User is explicitly synthetic; there is no simulated account, token or session. Ingredient/formulation labels are fictional interface fixtures. Clinical validation, real OCR, real medicine information, server persistence, notification delivery and authentication remain unconnected.

CampusConnect primitives, icons, Manrope/Inter, scoped palette, shell, original welcome styling and modal conventions are retained. Native dialogs add background isolation, source-derived Tab wrapping, Escape and focus restoration. Public pages keep their binary theme toggle; workspace controls retain their existing theme preferences.

Run npm run dev from frontend/ and open http://127.0.0.1:5174/home. No environment configuration is necessary. Verification uses the six commands documented above. Tests/evidence: tests/e2e/demo.spec.ts and ignored playwright-report/demo-sprint/. Browser tests cover all routes, both themes, desktop/mobile screenshots, CRUD, search, comparison, file selection/removal, sample boundaries, narrow/tablet reflow and absence of fetch/XHR calls. Chromium and simulated viewports are verified; physical-device keyboards and clinical functionality are not certified.
