# MedDecode frontend foundation and shell

Run all commands from `frontend/`. Verified with Node 24.11.1 and npm 11.6.2; the package engine range is `^22.13.0 || >=24.0.0`.

## Installation and development

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

`/` now renders the source-adapted MedDecode public landing, without the workspace sidebar or bottom bar. Sections cover the hero, six planned capabilities, an intended three-step process, responsible use and a closing CTA/footer. Illustrations are static and contain no medical results. Get Started leads to `/get-started`; Sign In leads to `/sign-in`. Both visibly explain that account access is coming next and collect no credentials. They are temporary route elements for Phase B.4, not authentication implementations. `/home` and all established workspace routes remain accessible without guards.

The public header reuses CampusConnect presentation, with the existing three-mode theme control. Below 1100px it uses a nonmodal Explore disclosure with keyboard focus, Escape restoration, normal Tab order, outside/focus departure close and navigation close. Hash links focus labelled sections below the sticky header. Public/workspace route changes preserve theme state and focus the main content.

B.3 evidence lives in ignored `test-results/evidence/`: `{dev|preview}-landing-{mobile|tablet|desktop}-{light|dark}-{full|viewport}.png`, plus `*-landing-mobile-menu-open.png`, `*-landing-desktop-light-cta-focus.png`, `*-landing-desktop-light-process.png` and `*-landing-{desktop|mobile}-light-footer.png`. Full-page captures are complemented by viewport details. All six mandatory checks cover both the prior shell and landing. Only Chromium is verified; 720px available-width testing models 200% reflow without certifying native browser zoom. Owner screenshot review remains required for visual approval.
