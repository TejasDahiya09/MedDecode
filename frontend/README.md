# MedDecode frontend foundation

This phase provides an independently runnable React verification screen, theme preferences, generic JSON transport, and focused tests. Product workflows, authentication, medicine data, application API integration, and final visual identity are not implemented. Colors and the retained favicon are provisional. No CampusConnect assets are included.

## Prerequisites and installation

Node.js 24.11.1 and npm 11.6.2 were used for verification. The supported tooling range is Node `^22.13.0 || >=24.0.0`; other versions in that range were not tested. Run commands from `frontend/`.

```powershell
npm install --strict-peer-deps
npm run dev
```

Installation and local startup were verified. Exact direct versions and transitive resolutions are retained in `package-lock.json`. The development address is `http://127.0.0.1:5174`; strict ports prevent silent fallback. No backend is needed to render the screen, and startup makes no application API requests.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Local Vite development server on port 5174 |
| `npm run typecheck` | Strict, non-emitting TypeScript check |
| `npm run lint` | ESLint with zero warnings allowed |
| `npm run test:unit -- --run` | Deterministic unit/component/configuration checks |
| `npm test` | Alias for one unit-test run |
| `npm run build` | Type check and production build to ignored `dist/` |
| `npm run preview` | Production preview on port 4174 |
| `npm run test:e2e` | Chromium tests with controlled development-server startup |
| `npm run test:e2e:preview` | The same browser checks against the existing production build |

Typecheck, lint, unit tests, build, and both browser suites were executed successfully during this phase. The alias uses the same verified unit command. Playwright will fail rather than reuse a server already occupying a test port; stop a manually started frontend before running it. Test-managed servers are stopped after the run.

## Public environment and local proxy

`.env.example` intentionally leaves `VITE_API_BASE_URL` empty. Add public configuration to an ignored local `.env.local` only when transport is needed; this foundation does not create one. Vite browser variables must never contain Supabase service-role credentials, AWS credentials, tokens, or patient information.

For optional local development, `VITE_API_BASE_URL=http://127.0.0.1:5174/backend` works with the development-only proxy. A helper path `/health` becomes browser URL `http://127.0.0.1:5174/backend/health`, forwarded to `http://127.0.0.1:3000/health`. `/backend` maps to `/`; `/backend-other` is not proxied. Prefix matching and rewrites are configuration-tested. No live backend request was made, and backend/cloud connectivity is not verified.

The proxy is disabled for production preview and is not a deployment API. Production builds need an explicit public HTTP(S) API base and separately agreed server CORS/authentication behavior.

## Theme and styling

The pre-React initializer and existing provider share the `meddecode-theme` preference (`light`, `dark`, or `system`). Missing/invalid preferences resolve to system. Storage failure permits session-only selection. OS changes and cross-tab storage events update the effective theme; subscriptions are cleaned up under Strict Mode.

The effective `data-theme` drives semantic CSS variables, native `color-scheme`, and Tailwind's dark selector. System fonts, visible focus, 48px select height, reduced-motion rules, and neutral provisional tokens support foundation verification. Final branding is a separate approval. The Tailwind v4 baseline targets Safari 16.4+, Chrome 111+, and Firefox 128+; only Chromium was exercised here.

## Generic transport

`requestJson<T>` preserves fetch options, headers, multipart bodies and cancellation. It returns `T | undefined` for JSON or empty successful responses. `T` does not validate runtime data: feature services must validate confirmed contracts later. No endpoint-specific schemas, authentication headers, cookie policy, automatic retries, query parameters or default timeout are imposed.

Bases must be absolute HTTP(S) URLs without userinfo, query or fragment. Paths must start with one slash and cannot contain query/fragment text, whitespace, controls, dot traversal, nested percent encodings or encoded separators. Base paths are retained. These transport constraints are not a server authorization boundary.

`ApiError.kind` distinguishes configuration, path, HTTP, response and network failures. HTTP status is retained when available; network/read failures retain their cause. Abort failures remain recognizable. JSON and `application/*+json` are accepted. Empty bodies, HEAD, 204 and 205 return `undefined`. No application endpoints are contacted by the screen.

## Verification and evidence

```powershell
npx --no-install playwright install chromium
npm run typecheck
npm run lint
npm run test:unit -- --run
npm run build
npm run test:e2e
npm run test:e2e:preview
```

Chromium installation was verified; it downloads browser tooling, not application data. Unit tests substitute fetch and browser preferences. Browser tests use fresh contexts and synthetic content. They cover 390x844, 768x1024 and 1440x900 in both themes, persistence, keyboard operation, OS changes, real cross-tab sync, and initialization before React. They check primary/muted text contrast, horizontal overflow, control height, runtime/console errors, and absence of application fetch/XHR during boot. This is not a WCAG conformance audit or cross-browser certification.

Synthetic screenshots are saved to ignored `test-results/evidence/`, named `{dev|preview}-{mobile|tablet|desktop}-{light|dark}-{width}x{height}.png`. Browser traces/screenshots are retained on failure in ignored test output. A later development test run clears the default test-results directory; preserve evidence separately if needed. Screenshots are engineering evidence, not visual approval.

No real OCR, backend, database, cloud service or patient records are used by these checks. Final product behavior remains outside this foundation.
