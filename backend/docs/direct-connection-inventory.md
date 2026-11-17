# MedDecode connection inventory — local review

The application repositories use the authenticated user's Supabase HTTPS/PostgREST client and JWT. They must keep that path to preserve owner-scoped RLS; they are not direct PostgreSQL or Supavisor clients. This includes prescription upload metadata, history, results, job submission/status and cabinet. Medicine search/detail/compare use the authenticated catalogue RPC path. Supabase Auth remains HTTPS. Do not replace these with a privileged direct connection.

| Component | Source | Current path and identity | Direct status |
| --- | --- | --- | --- |
| Authentication | `src/services/auth.service.ts`, `src/config/supabase-user.ts` | Supabase Auth/HTTPS, publishable key and verified user token | HTTPS intentionally retained |
| User repositories and APIs | `src/repositories/*`, `src/routes/*` | Supabase HTTPS/PostgREST, authenticated user context and RLS | HTTPS intentionally retained |
| Automatic worker | `src/worker.ts`, `src/repositories/postgres-worker-rpc.transport.ts`, `scripts/automatic-worker-credentials.ps1` | Dedicated `meddecode_auto_worker_login`; direct database endpoint; explicit scoped role and RPCs | Read-only verify-full TLS role check passed; no job RPC called |
| Readiness | `src/routes/health.routes.ts` | `BACKEND_READINESS_DATABASE_URL`, dedicated read-only TLS identity; one in-flight check, closes connection | Running endpoint reported database ready; this does not verify ownership, worker or full processing |
| Catalogue intelligence | `intelligence/app/database/catalogue_connection.py` (Copilot-owned) | `meddecode_catalogue_python_reader`, restricted read-only direct PostgreSQL | User reported direct TLS success; runtime readiness passed; no application writes |
| Admin and historical diagnostics | `backend/scripts/*hosted*`, reviewed SQL | Existing verified-TLS admin session service or legacy pooler-specific diagnostic | Administrative/read-only or separately approved only; not an application fallback. The older single-job readiness script still targets a pooler by design and is not the automatic direct-worker loader. |
| Local synthetic tests | `backend/scripts/local-persisted-results-server.ts`, `backend/tests/*.manual.ts` | Explicit loopback isolated test databases | Local-only; no hosted cutover |
| Legacy privileged Supabase client | `src/config/supabase.ts` | Server-only `supabaseAdmin` constructor | No ordinary user-route bypass; retain for existing explicitly privileged uses, not a direct PostgreSQL credential |

No Redis/BullMQ dependency was found in application-owned backend or root runtime code. The restricted worker pool has max 2 connections, 10-second connection and statement timeouts, and closes on shutdown. It only calls allowlisted scoped RPCs in the controlled mode. No admin or catalogue-reader identity is used as a worker or general write identity.

The user-facing automatic test policy is already enabled for one synthetic account and one job, but no worker or auto-submit flags are started by this change. The current root launcher requires explicit controlled-worker opt-in, the exact direct endpoint and role, single-attempt mode and separate worker AWS credentials. `automatic-worker-credentials.ps1 -Action Verify` uses the existing DPAPI credential and verify-full TLS directly without an admin service dependency; `-Action Load` keeps the worker disabled and does not overwrite Python catalogue host configuration. Existing older session-pooler administration and single-job diagnostics are not silently converted or used as a fallback.

Fresh local verification: direct IPv6 TCP 5432 passed; the specified CA file exists; the restricted worker direct login and role checks returned `AUTO_WORKER_IDENTITY_OK`. The actual worker, hosted job submission, scoped claim and result persistence were not run in this change. Before any controlled hosted processing, perform fresh identity, allowlist, session and lock checks and obtain the separately scoped activation/upload approval.

For the UI regressions, `prescription-workflow.spec.ts` expects a disabled Cabinet button named `Add unavailable`, and `upload.spec.ts` expects a `Demo Mode` label. The current UI no longer presents those exact elements. These browser expectations require frontend-owner review; no backend error was identified from those failures and the tests were not weakened.
