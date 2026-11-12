# Processing job submission integration migration

This directory is intentionally separate from historical database references
and the Phase 5.7 proposal drafts. It is an executable migration candidate for
a disposable local PostgreSQL/Supabase-compatible test database only.

It has **not** been executed against hosted Supabase. Production deployment is
blocked until the project proves that its migration identity can create and own
the `SECURITY DEFINER` function as `postgres`, and independently reviews the
live catalog, grants, policies, and existing rows.

## Ordered files

1. `001_preflight.sql` - read-only assertions; stops on incompatible schema or data.
2. `002_up.sql` - transactional submission/status functions, partial unique index,
   and least-privilege grants.
3. `003_verify.sql` - read-only post-migration catalog assertions.
4. `004_recovery.sql` - operator-gated, fail-closed recovery candidate.
5. `005_recovery_verify.sql` - independent read-only recovery verification.

The migration does not add worker claiming, retries, heartbeat, OCR, or result
finalization. It does not remediate historical data.

## Objects and permissions changed by `002_up.sql`

The migration creates or replaces exactly these RPC signatures, owned by
`postgres`:

- `public.submit_prescription_analysis_job_v1(uuid, jsonb)` as
  `SECURITY DEFINER`, with an empty `search_path`;
- `public.get_prescription_analysis_status_v1(uuid)` as
  `SECURITY INVOKER`, with an empty `search_path`.

It creates the partial unique index
`public.ai_jobs_one_active_prescription_analysis_uq`, grants only
`authenticated` EXECUTE on both RPCs after revoking PUBLIC and `anon`, and
revokes direct `authenticated` INSERT on `public.ai_jobs`. It does not change
table policies, table ownership, rows, or the existing `authenticated` SELECT
grant during migration itself. The submission RPC can later create a job and
change an owned prescription status to `queued` when called.

## Deployment capture and controlled recovery

Before deployment, save the target's current catalog state for the active-job
index, both RPC definitions/owners/security settings/ACLs, `ai_jobs` table and
column grants, and policies. For example, capture the output of:

```sql
SELECT pg_get_indexdef(to_regclass(
  'public.ai_jobs_one_active_prescription_analysis_uq'
));
SELECT p.oid::regprocedure, pg_get_functiondef(p.oid), r.rolname,
       p.prosecdef, p.proconfig, p.proacl
FROM pg_catalog.pg_proc AS p
JOIN pg_catalog.pg_roles AS r ON r.oid = p.proowner
WHERE p.oid IN (
  to_regprocedure('public.submit_prescription_analysis_job_v1(uuid,jsonb)'),
  to_regprocedure('public.get_prescription_analysis_status_v1(uuid)')
);
SELECT * FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name IN
  ('ai_jobs', 'prescriptions', 'prescription_intelligence_results');
SELECT * FROM information_schema.column_privileges
WHERE table_schema = 'public' AND table_name = 'ai_jobs';
SELECT * FROM pg_catalog.pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('ai_jobs', 'prescriptions',
                    'prescription_intelligence_results');
```

Before deployment, also capture and independently retain:

- the total `ai_jobs` count (the reviewed hosted baseline is exactly zero);
- the result count and an identity fingerprint over result `id`,
  `prescription_id`, and nullable `job_id`;
- the prescription count and a fingerprint over prescription `id` and
  `status`;
- the exact `ai_jobs_insert_own` policy, RLS state, table owner, and ACL;
- proof that the three target migration objects do not already exist.

An assertion failure in `002_up.sql` aborts its transaction, so no manual
cleanup is needed; correct the cause and rerun preflight.

`004_recovery.sql` is not an automatic rollback and must never be scheduled or
wired into application startup. It is deliberately operator-controlled and
requires all of the following before review or execution:

1. An approved change ticket and a separately approved recovery window.
2. All submission callers and prospective workers paused and verified idle.
3. A fresh hosted catalog capture compared with the saved pre-deployment
   evidence.
4. The exact psql variable `meddecode_recovery_approved=true` supplied by the
   operator, plus all five captured baseline values.
5. A confirmed zero `ai_jobs` baseline and a current database that still
   matches it.
6. Unchanged result identities and unchanged prescription statuses since the
   captured baseline.
7. Exact expected ownership, definitions, grants, RLS, and INSERT-policy state
   for every object the recovery would alter.

The recovery locks the three relevant tables with a five-second timeout,
checks the exact function source hashes and catalog properties, uses `RESTRICT`
for all object removal, restores only the documented `authenticated` INSERT
table grant, verifies within the transaction, and then commits. It never
deletes jobs/results or resets prescription statuses.

Stop without recovery if any job exists, any result identity or prescription
status changed, a target object differs, callers cannot be paused, the baseline
capture is missing, the ownership/RLS/policy state differs, a dependency blocks
`RESTRICT`, or any lock cannot be acquired. A database containing work created
after deployment requires a separate manual reconciliation plan; this package
does not invent one.

After an approved recovery, run `005_recovery_verify.sql` in a separate
read-only invocation with the same baseline values. Verify the RPCs and index
are absent, `authenticated` has INSERT and SELECT, PUBLIC lacks INSERT, RLS and
the owner-scoped INSERT policy remain intact, and all captured data fingerprints
still match. Keep the pre/post catalog evidence with the change record.

The recovery scripts are psql-oriented because their approval and baseline
values are explicit psql variables. They have not been executed against hosted
Supabase. Hosted credentials, session behavior, operator permissions, and the
final command must be reviewed separately; no command in this document grants
approval to run them.

## Local test harness

Requirements: PostgreSQL 17 at the approved local executable path and an empty
disposable local database named `meddecode_job_test` on port `5433`. The
harness rejects non-loopback hosts, every other port/database name, embedded
passwords, and every other `psql` executable.

If `PGPASSWORD` is not already present in the process environment, the harness
uses a non-echoing PowerShell prompt once, shares the value only with its local
`psql` child processes, and removes it when the harness exits. Never place the
password in `DatabaseUrl`, source code, or shell history.

```powershell
$env:MEDDECODE_TEST_DATABASE_URL = 'postgresql://postgres@127.0.0.1:5433/meddecode_job_test'
powershell -NoProfile -ExecutionPolicy Bypass -File .\test\run-local.ps1 `
  -DatabaseUrl $env:MEDDECODE_TEST_DATABASE_URL `
  -PsqlPath 'C:\Program Files\PostgreSQL\17\bin\psql.exe'
```

The harness creates only synthetic UUID records in the disposable database.
Never point it at staging, production, or a hosted Supabase project.

The local harness also resets the disposable schema, reapplies the migration,
executes `test/40_recovery.sql`, and independently verifies that recovery
removes only the three migration-owned objects, restores only the documented
INSERT grant, and preserves synthetic rows and prescription statuses.

## Application cutover gate

The Express production `ProcessingJobStore` must remain disabled until:

- these SQL files pass the local harness, including concurrency tests;
- hosted Supabase owner/grant feasibility is proven;
- the migration is separately approved and deployed;
- a user-scoped RPC adapter is implemented and tested.

No rollback file guesses previous grants or policies. Before deployment, capture
the target catalog and prepare a separately reviewed restoration script from
that evidence.
