# Frontend

## Stack and development

`frontend/` uses React 19, TypeScript, Vite, React Router, TanStack Query, Supabase JS, Vitest, and Playwright. Run commands from that directory:

```powershell
npm run dev
npm run typecheck
npm run lint
npm run test:unit -- --run
npm run build
npm run test:e2e
```

The Vite development server binds to `127.0.0.1:5174` and uses a strict port. Its local `/backend` proxy, when configured, is development-only.

## Routes and experience

The frontend contains public landing/authentication screens, a protected application shell, prescription history/results surfaces, a development-only fictional intelligence page, and a local demo workspace. Core workspace sections include home, upload, medicine insights, comparison, cabinet, reminders, and learning resources. Check `src/app/App.tsx` and feature modules for the current route table.

The demo workspace includes fictional fixtures and local state. UI labels, sample analyses, and sample medicines are not clinical evidence. File selection in the presentation demo does not itself prove that a file was read, uploaded, or processed.

## Authentication and API transport

The frontend auth client is initialized from public Supabase configuration and provides session state to protected routes. The API client attaches the current access token and owns the `Authorization` header. The backend independently verifies the token. Never expose a secret/service-role key through a `VITE_` variable.

Authenticated API pages and development fixtures should fail visibly when unavailable. The fictional development flow calls only the dedicated fixture endpoint; its Python worker injects synthetic OCR and must not be represented as real OCR.

## Accessibility and visual behavior

The frontend README records the detailed navigation, theme, forms, responsive behavior, and previous browser-validation scope. Browser screenshots and Playwright reports are generated artifacts, not reviewed product approval or clinical validation. Cross-browser and full assistive-technology conformance are not implied by Chromium tests.

## Outstanding integration boundary

Frontend presence does not mean every user workflow has a stable backend contract. Check API routes and frontend API modules together before adding or enabling workflows. Real prescription processing, persistence, clinical recommendations, and production authentication configuration require their own verification and approval.
