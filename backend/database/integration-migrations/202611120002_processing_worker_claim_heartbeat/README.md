# Processing worker claim and heartbeat migration candidate

**LOCAL INTEGRATION CANDIDATE ONLY — NOT APPROVED FOR HOSTED DEPLOYMENT.**

This package extends the committed processing-job submission migration with
lease-based worker claiming and heartbeat fencing. It does not implement OCR,
result finalization, retries, reconciliation, or hosted worker credentials.

## Security boundary

The SQL role `meddecode_worker` is the only role granted RPC execution. The
caller-provided worker instance label is only a lease/fencing identifier and is
never authorization. `PUBLIC`, `anon`, and `authenticated` cannot execute the
worker functions, and the worker role receives no direct table-write grant.

Hosted worker identity provisioning is deliberately **BLOCKED**. Before hosted
deployment, an operator must prove how the runtime assumes the dedicated role,
how credentials are rotated and revoked, and whether the role and grants are
supported by hosted Supabase. Do not substitute `service_role` or a browser JWT.

## RPC contracts

`claim_next_prescription_analysis_job_v1(worker_instance_id, lease_seconds)`
atomically selects one available queued prescription-analysis job with
`FOR UPDATE SKIP LOCKED`, changes it and its prescription to `processing`,
increments attempt and claim generation, and returns the fenced claim plus
private storage metadata. An empty result means no job is available.

`heartbeat_prescription_analysis_job_v1(job_id, worker_instance_id,
claim_generation, extend_seconds)` extends only the matching, unexpired claim.
An expired, wrong-owner, or stale-generation claim fails closed.

Lease durations are restricted to 30–300 seconds. Worker labels must be 8–128
characters and contain only letters, digits, `.`, `_`, `:`, or `-`.

## Local-only execution

The harness is destructive because the existing bootstrap recreates `public`
and `auth`. Run it only against the approved disposable local database, after
explicit approval:

```powershell
& '.\test\run-local.ps1' `
  -DatabaseUrl 'postgresql://postgres@127.0.0.1:5433/meddecode_job_test' `
  -PsqlPath 'C:\Program Files\PostgreSQL\17\bin\psql.exe' `
  -ApproveDisposableReset
```

It applies the committed submission migration, verifies the pre-created local
NOLOGIN worker role, replays this migration, runs behavior checks, and launches two overlapping
claim sessions. Before any destructive SQL it independently verifies the
connected PostgreSQL identity and inventories schemas, extensions, relations,
functions, active connections, and all application-table rows. It accepts only
the exact loopback endpoint and known disposable fixture identities.

The harness no longer creates `meddecode_worker`. The role must already exist
with NOLOGIN, NOINHERIT, NOSUPERUSER, NOCREATEDB, NOCREATEROLE,
NOREPLICATION, and NOBYPASSRLS attributes. Creating that cluster-wide role
requires separate operator review and approval.

This package must not be deployed until hosted role feasibility, worker
credential lifecycle, finalization, retry, and expired-lease recovery receive
separate review and approval.
