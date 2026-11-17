# Phase 1M — Migration 003 hosted deployment record

Date: 2026-11-16
Target: Supabase project `wyripeqruhvbksjfsvlr`, database `postgres`
Scope: Migration 003 only. No application feature flag, worker, job, result, or unrelated migration was changed.

## Approved artifact

`backend/database/integration-migrations/202611150003_prescription_review_worker_v1/002_up.sql`

SHA-256: `aab73c2a40227b93bc6d312eb85c885304543d68083110c508120b74ee4f596e`

## Fresh pre-execution gates

- `psql \\conninfo` confirmed the expected pooled Supabase project user, host, database, and TLS 1.3 connection. The client service uses `sslmode=verify-full`; the negotiated cipher was `TLS_AES_256_GCM_SHA384`.
- The manual recovery archive was present and matched its approved SHA-256: `7c85af60394d19365282d7c3bf480d59e00e069b96f33f09c204bcc688c43c98`.
- Migrations 001 and 002 base tables/RPCs remained available; Migration 003 functions were absent.
- Exact read-only preflight returned `PRESCRIPTION_REVIEW_WORKER_PREFLIGHT_OK`.
- Before deployment: jobs were 1 cancelled, 2 completed, 3 queued; results were 2 `completed_with_warnings`.
- The scoped worker retained finalizer execution and had no direct `UPDATE` on `ai_jobs` or `prescriptions`; `anon` lacked finalizer execution.

## Execution

The approved `002_up.sql` ran exactly once with `ON_ERROR_STOP`, its own atomic transaction, `lock_timeout='5s'`, and `statement_timeout='60s'`.

Result: committed. The only reported DDL operations were five function creations and the reviewed REVOKE/GRANT statements.

## Independent post-deployment verification

`003_verify.sql` returned `PRESCRIPTION_REVIEW_WORKER_VERIFY_OK` in a read-only transaction.

All five Migration 003 functions are owned by `postgres`, use `SECURITY DEFINER`, and configure `search_path=pg_catalog, public`:

- `meddecode_submit_confirmed_review_job_v1` — executable only by `authenticated`.
- `meddecode_scoped_authorize_next_confirmed_review_job_v1` — executable only by `meddecode_scoped_worker`.
- `meddecode_scoped_authorize_next_v3_job_v1` — executable only by `meddecode_scoped_worker`.
- `meddecode_load_confirmed_review_job_v1` — executable only by `meddecode_scoped_worker`.
- `meddecode_fail_review_job_v1` — executable only by `meddecode_scoped_worker`.

`anon` has no execution on all five. The scoped worker has no direct `UPDATE` privilege on `ai_jobs` or `prescriptions`, and no direct `INSERT` privilege on `prescription_intelligence_results`.

After deployment, job counts remained 1 cancelled, 2 completed, 3 queued; results remained 2 `completed_with_warnings`. There are two current results for two distinct prescriptions, so existing current-result lineage is unchanged.

## Controlled V3 activation plan — not executed

Separate approvals are required for each of these steps:

1. Deploy a backend release compatible with V3 while retaining `MEDDECODE_PRESCRIPTION_REVIEW_V3_ENABLED=false`, `PROCESSING_WORKER_ENABLED=false`, and automatic submission disabled. Verify ordinary authenticated read paths.
2. Approve a restricted, isolated synthetic account and one fictional document. Confirm all existing queued jobs are outside its eligibility.
3. Enable `MEDDECODE_PRESCRIPTION_REVIEW_V3_ENABLED=true` only in the controlled backend configuration, keeping `PROCESSING_WORKER_ENABLED=false`. Verify review initialization and confirmation APIs without dispatching a job.
4. Freshly verify dedicated scoped-worker TLS identity, `WORKER_RPC_MODE=scoped`, V3 RPC privileges, zero competing worker sessions, no conflicting locks, and the emergency stop procedure.
5. Obtain a separate approval to enable exactly one controlled scoped worker and one approved V3 job. Require one-worker concurrency, single-attempt mode, no automatic retry, and no recovery of unrelated jobs.
6. After the controlled run, verify the exact result/revision/job lineage, prior-result preservation on failure, cross-owner denial, no unrelated queue mutation, worker shutdown, and flag reset.

## Remaining risks

- The manual backup is restore-tested for application schema/data, but does not recover global roles, ownership/ACL replay, S3 objects, or Supabase platform configuration.
- No hosted V3 application or worker smoke test has occurred.
- Existing queued jobs remain deliberately untouched.
