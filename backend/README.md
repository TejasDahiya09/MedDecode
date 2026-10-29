# Backend execution notes

Use `backend/` as the working directory. This preserves the existing package-relative paths and environment-loading convention.

`package.json` defines `dev`, `build`, `start`, and `typecheck` scripts. The development script watches `src/server.ts`; the build writes to `dist/`; the start script expects the built `dist/server.js`. These definitions were inspected, not executed during structural integration.

Configuration names are documented in `.env.example`; use local configuration and do not commit credentials. This snapshot includes a health endpoint and a Supabase client, not the complete product API. Dependency installation, runtime behavior, and external connectivity still require owner validation.
