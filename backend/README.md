# MedDecode backend

## Controlled Supabase Auth smoke test

The authentication smoke-test harness verifies the local backend's public
health route and authenticated identity route against one explicitly approved
Supabase project. It does not query application tables, use the privileged
client, create users, refresh sessions, sign out, or test revocation.

Live execution is intentionally disabled unless every safety gate passes. The
offline automated tests use injected HTTP and authentication mocks and never
contact Supabase.

### Required environment variable names

Place real values only in an ignored `backend/.env.local` file:

```text
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
AUTH_SMOKE_APPROVED_SUPABASE_URL=
AUTH_SMOKE_BACKEND_ORIGIN=http://127.0.0.1:3000
AUTH_SMOKE_TEST_EMAIL=
```

`AUTH_SMOKE_APPROVED_SUPABASE_URL` must exactly match the origin in
`SUPABASE_URL`. The harness accepts only official HTTPS `*.supabase.co`
origins. The backend origin must resolve to `localhost`, `127.0.0.1`, or
`[::1]`. Do not add `SUPABASE_SECRET_KEY`; the smoke test neither needs nor
uses privileged access.

The repository ignores `.env` and `.env.*` except `.env.example`. Confirm the
local file before adding credentials:

```powershell
git check-ignore -v backend/.env.local
```

### Start the backend with `.env.local`

From `backend/` in PowerShell:

```powershell
$env:DOTENV_CONFIG_PATH = (Resolve-Path .env.local)
npm run dev
```

The same ignored file must be loaded in the separate shell used for the smoke
test. The backend and harness must use the same approved Supabase project.

### Execute later, only after separate approval

```powershell
$env:DOTENV_CONFIG_PATH = (Resolve-Path .env.local)
npm run smoke:auth -- --allow-live-auth
```

The harness prompts for the dedicated test-account password using a non-echoing
TTY input. It fails rather than falling back to visible input when a compatible
interactive terminal is unavailable. Never pass passwords, tokens, sessions,
keys, or project URLs as command-line arguments. Do not use verbose HTTP output,
PowerShell transcripts, screenshots, or screen sharing during execution.

The normal `signInWithPassword` operation creates an Auth session and may
update Supabase Auth session metadata and provider logs. The harness keeps the
resulting token only in process memory, disables automatic refresh and
persistence, and exits without logout or revocation. For that reason, live
execution requires separate approval and a dedicated non-patient test account.
