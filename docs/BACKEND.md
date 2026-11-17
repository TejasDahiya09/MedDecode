# Backend

## Stack and commands

`backend/` is a private Node.js/TypeScript package using Express 5 and Supabase JS. Package scripts:

```powershell
npm run dev
npm run typecheck
npm test
npm run build
```

The package requires Node.js 22 or newer. `dev` watches `src/server.ts`; `build` emits TypeScript output to `dist/`; `start` runs the built server. The API defaults to port 3000 and the health check is `GET /health`.

## Main API surfaces

Routes are registered in `src/app.ts`. Implemented route families include:

- Authentication identity: `GET /api/v1/auth/me`
- User and health profiles: `/api/v1/users/me`, `/api/v1/health-profile/me`
- Family members: `/api/v1/family-members`
- Prescription upload, history and results: `/api/v1/prescriptions` and related routes
- Medicine cabinet: `/api/v1/medicine-cabinet`
- Processing submission/status: `POST /api/v1/prescriptions/:prescriptionId/process` and `GET /api/v1/prescriptions/:prescriptionId/processing-status`
- Development-only fictional fixture: `POST /api/v1/development/fictional-intelligence-result`

Authentication, request shapes, and route-specific errors are defined by the route implementations and tests. The development fixture route is only registered when `NODE_ENV=development`, its server-side enable flag is exactly `true`, and all three local paths are configured. The caller cannot supply a file path or worker command.

## Configuration

The implementation reads server-side variables including `NODE_ENV`, `PORT`, `CORS_ORIGIN`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `AWS_REGION`, `AWS_S3_BUCKET`, upload size/timeout limits, and `PROCESSING_JOB_STORE_ENABLED`. The fixture route also requires `DEVELOPMENT_FIXTURE_INTELLIGENCE_ENABLED`, `DEVELOPMENT_FIXTURE_PYTHON_EXECUTABLE`, `DEVELOPMENT_FIXTURE_INTELLIGENCE_DIRECTORY`, and `DEVELOPMENT_FIXTURE_PDF_PATH`.

Use the current source (`src/config/env.ts`) for the exact validation and required-variable conditions. Copy `backend/.env.example` to the ignored `backend/.env` for local runs and fill only the values needed for the local feature. Keep `SUPABASE_SECRET_KEY` server-side; never put it in a frontend variable. Avoid printing environment values when diagnosing configuration.

## External systems and gates

- Supabase Auth and PostgreSQL are required for authenticated persisted features.
- AWS S3 configuration is required for prescription-storage operations.
- `PROCESSING_JOB_STORE_ENABLED` defaults to `false`; an invalid value fails configuration parsing.
- The worker composition does not start automatically and remains disabled/opt-in. When started, the current worker processes at most one claim per start; this lifecycle limitation is intentional to preserve in this task and must be considered before using it as a persistent polling worker.
- The development fixture integration executes a local Python worker only under its explicit development gate.
- No local unit test or successful fixture request authorizes hosted configuration changes.

## Security notes

Routes use bearer authentication and dependency-injected repositories/clients to support tests. Verify authorization and RLS independently before any live deployment. Never send the Supabase secret key to the browser. The frontend publishable key is public by design; it is not an authorization substitute.

Use `backend/README.md` for the detailed API and explicitly gated smoke-test procedures. Live smoke scripts and write-capable integrations require separate approval and are excluded from routine validation.
