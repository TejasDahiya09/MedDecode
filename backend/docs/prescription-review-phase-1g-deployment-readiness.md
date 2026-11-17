# Prescription Review Phase 1G Deployment Readiness

Date: 2026-11-15

## Verdict

The two schema packages are ready to enter a separately approved, staged hosted deployment. The first review-schema preflight passed against the configured MedDecode Supabase project in a read-only transaction. The result-history preflight cannot truthfully pass until the review migration has created its dependency, so hosted compatibility remains **PARTIAL** until that sequential checkpoint is reached.

This review executed no hosted DDL, DML, grants, migrations, credentials changes, worker calls, or worker activation.

## Final migration inventory and fresh SHA-256

Hashes were recalculated after the Phase 1G safety corrections.

| Package/file | SHA-256 |
|---|---|
| `202611150001_prescription_review_v1/001_preflight.sql` | `3a68979bef267bbedbcd3fd6cf041b6d2b7ed6d8ff133b0f38a50c4b05f3a2f6` |
| `202611150001_prescription_review_v1/002_up.sql` | `eb797081101047f55d95d0051b58e0fee1c3144b9335e10202aa5895d11c8217` |
| `202611150001_prescription_review_v1/003_verify.sql` | `c2e53fc91f7bd04ff6ccb5d41c8cf96fc66315e7966523641e61290f62133992` |
| `202611150001_prescription_review_v1/004_rollback_review.sql` | `5375599b65b5190bc2659c0886f4cdad74091eebbc3ed2985e402ead517d8fe7` |
| `202611150002_prescription_result_history_v1/001_preflight.sql` | `9d5cb863a08129c81bd57565fd7d542cd599f133aee227f153f687f28610cd11` |
| `202611150002_prescription_result_history_v1/002_up.sql` | `84f476117f2c7074b1d7a2a23aea7b4bd7edb111d551a782b62a82e1f06fd1c2` |
| `202611150002_prescription_result_history_v1/003_verify.sql` | `919688bf66c214cb1855a7e5d4874ae2fed006583c53e843e0183051187fa03a` |
| `202611150002_prescription_result_history_v1/004_rollback_review.sql` | `7ffe462ca1b22589a683dbd8d4268db4103a537a4f5a63afb51ed4035825230a` |

## Phase 1G safety corrections

No feature behavior was added. Four deployment-safety gaps were corrected locally:

1. Both preflights now require database `postgres` and deployment role `postgres`; new `SECURITY DEFINER` functions therefore acquire the reviewed owner.
2. Independent verification now checks function ownership, `SECURITY DEFINER`, fixed `search_path`, reader/finalizer ACLs, job idempotency, and anonymous denial.
3. The review migration now has five-second lock and sixty-second statement timeouts.
4. The review rollback refuses to run after any review or review-bound result data exists.

The Phase 1F server also now requires `NODE_ENV=test`, and `frontend/.env.example` explicitly defaults `VITE_PRESCRIPTION_REVIEW_ENABLED=false`.

## Migration review

### Order and transaction behavior

`202611150001` must run before `202611150002`. Each `002_up.sql` is one transaction with `ON_ERROR_STOP`; an error rolls back the whole stage. Both now have bounded lock/statement timeouts.

The review migration is additive:

- adds a redundant-but-useful `(id,user_id)` uniqueness proof to `prescriptions`;
- creates evidence, revision, medicine, and audit-event tables;
- adds nullable review lineage columns to existing result rows;
- creates owner-scoped authenticated RPCs and restricted worker RPCs;
- creates a stale-result fencing trigger.

Existing result rows remain valid because both new lineage columns are nullable together. The result-history migration backfills `is_current=true`, replaces prescription-only uniqueness with job uniqueness plus one-current-per-prescription uniqueness, and leaves existing result JSON unchanged.

### Foreign keys and indexes

- Child rows prove prescription ownership with composite foreign keys to `(prescription_id,user_id)`.
- Evidence/revision and revision/medicine links use composite identifiers.
- Confirmed history is immutable through API/RPC state transitions; tables expose no authenticated mutation grants.
- One current revision, one current result, one draft, revision numbering, job idempotency, active positions, and event idempotency are database-enforced.
- Result-history rollback refuses when more than one result exists for a prescription. Review rollback now refuses whenever review data exists.

### RLS and privileges

All four review tables enable RLS. Authenticated users have SELECT only, with owner predicates derived from `auth.uid()`. Mutations occur through fixed-search-path security-definer functions that derive the owner from `auth.uid()` or existing job/prescription lineage. `anon` receives no review table or function access.

The scoped worker receives only EXECUTE on initialization, binding, assertion, and finalization functions. Hosted metadata confirms `meddecode_scoped_worker` is NOLOGIN, NOINHERIT, not superuser/createdb/createrole/bypassrls, and has no direct review-table privileges.

## Hosted read-only compatibility evidence

Target identity was derived from the configured `meddecode_hosted_admin` service:

- project-bound username contains `wyripeqruhvbksjfsvlr`;
- database `postgres`;
- PostgreSQL `17.11`;
- service host `aws-0-ap-southeast-1.pooler.supabase.com:5432`;
- client `sslmode=verify-full` with an existing root CA file;
- SQL transaction reported `transaction_read_only=on`.

`pg_stat_ssl` reports the Supavisor-to-PostgreSQL server leg, not the client-to-Supavisor leg, and returned false. It therefore cannot independently attest the client TLS leg; the libpq service configuration is the available client-side evidence.

Aggregate/catalog findings:

- all five required base tables exist;
- review tables/functions are absent and target names do not collide;
- `anon`, `authenticated`, and `meddecode_scoped_worker` exist;
- `prescriptions.user_id` is non-null UUID;
- all required job lease/fencing columns exist;
- result table has the required legacy columns and `created_at`;
- exactly one existing result exists, with non-null unique job lineage and `completed_with_warnings` status;
- exactly one prescription-only unique constraint exists, as required by result-history preflight;
- zero duplicate job-lineage groups;
- one queued and zero processing prescription-analysis jobs;
- the queue row was not read or changed.

The exact final `202611150001/001_preflight.sql` produced `PRESCRIPTION_REVIEW_PREFLIGHT_OK` and rolled back. The `202611150002` preflight is intentionally deferred until `202611150001` has been independently verified because its review-table dependency does not yet exist.

The queued job does not block either schema migration: neither migration claims, updates, or triggers work from existing `ai_jobs`, and workers remain disabled. Its identity and contents were not inspected.

## Production configuration requirements

Required backend state for schema deployment and initial application rollout:

- `NODE_ENV=production` and exact production `CORS_ORIGIN`;
- correct HTTPS `SUPABASE_URL`, publishable browser key, and server-only secret key;
- `MEDDECODE_PRESCRIPTION_REVIEW_V3_ENABLED=false` during schema deployment, then true only for the compatible backend stage;
- `PROCESSING_WORKER_ENABLED=false`, `PRESCRIPTION_AUTO_SUBMIT_ENABLED=false`, and worker authorization disabled until separately approved;
- private `AWS_REGION`/`AWS_S3_BUCKET`, maximum upload size no greater than 10 MiB, bounded upload/preview timeout;
- internal Python URL and protected `MEDDECODE_INTERNAL_TOKEN` only on backend/worker;
- frontend `VITE_API_BASE_URL` and Supabase public values set correctly;
- `VITE_PRESCRIPTION_REVIEW_ENABLED=false` until backend verification completes.

OCR defaults remain bounded at 10 MiB, ten PDF pages, 25 million rendered pixels per page, 100 million aggregate pixels, 120-second processing, one-MiB response, and 2 GiB supervised child RSS. Adaptive OCR and TrOCR remain false by default.

The repository templates are ready, but actual production environment values and release artifact composition were not accessible through this database-only readiness task. `PRODUCTION_CONFIG_READY` is therefore **NO** until an operator provides a redacted deployment-environment check.

## Test authentication isolation

- Production `createApp` does not import or register local synthetic authentication.
- Phase 1F authentication is reachable only through a standalone script not referenced by production package scripts.
- It requires `NODE_ENV=test`, fixed loopback host/port, exact disposable database name, two distinct 32-byte secrets, disabled review/worker environment flags, and fictional fixed identities.
- Normal Supabase Auth and bearer verification remain unchanged.

## Exact proposed deployment sequence

1. Recalculate all eight hashes; verify backup availability and project/database identity. Keep backend review, frontend review, auto-submit, and workers disabled.
2. Run `202611150001/001_preflight.sql`; require `PRESCRIPTION_REVIEW_PREFLIGHT_OK`.
3. Under a separately approved schema-only change, run only `202611150001/002_up.sql` once with error-stop behavior and no retry.
4. Run `202611150001/003_verify.sql`; require `PRESCRIPTION_REVIEW_VERIFY_OK`. Independently recheck owners, ACLs, RLS, queue counts, and existing result count.
5. Run `202611150002/001_preflight.sql`; require `PRESCRIPTION_RESULT_HISTORY_PREFLIGHT_OK`.
6. Under a second explicit approval, run only `202611150002/002_up.sql` once. Then run `003_verify.sql`; require `PRESCRIPTION_RESULT_HISTORY_VERIFY_OK` and confirm the legacy result remains current and unchanged in count/status.
7. Deploy the compatible backend with review still disabled; run health, authentication, owner-denial, and read-only compatibility checks.
8. Deploy the frontend with `VITE_PRESCRIPTION_REVIEW_ENABLED=false`; verify no review navigation is exposed.
9. Under separate feature activation approval, enable backend then frontend review flags. Keep automatic submission and workers disabled.
10. Under separate authorization, initialize/process only a fictional prescription with the restricted scoped worker, verify two revisions/current-history behavior, then stop the worker.

## Rollback boundaries and decision criteria

- Before either migration commits: rely on transaction rollback; do not retry until catalog state is inspected.
- After `202611150001` but before review data exists: its reviewed rollback may be considered under separate authorization.
- After any review data exists: the review rollback refuses. Use forward recovery or restore; do not drop review tables.
- After `202611150002` but before multiple results exist: result-history rollback may be considered first, then review rollback, each separately authorized.
- After multiple historical results exist: result-history rollback refuses. Use forward recovery or restore.
- Disable frontend/backend feature flags before any rollback decision. Worker activation is never implied by schema approval.

Stop/rollback decision criteria include a hash mismatch, preflight marker failure, unexpected owner/ACL/RLS, lock timeout, changed legacy-result count/status, changed queue count/status, anonymous execution privilege, direct worker table access, or any partial/unexpected object state.

## Explicit approvals still required

1. Schema-only approval for the exact final `202611150001/002_up.sql` hash.
2. After verification, separate schema-only approval for the exact final `202611150002/002_up.sql` hash.
3. Separate compatible backend deployment approval.
4. Separate backend/frontend feature-flag activation approval.
5. Separate restricted worker activation and fictional hosted smoke-test approval.
6. Separate rollback authorization, if ever needed.

## Final status

MIGRATION_FILES_REVIEWED: YES

HOSTED_SCHEMA_COMPATIBILITY: PARTIAL

SECURITY_MODEL_REVIEWED: YES

PRODUCTION_CONFIG_READY: NO

TEST_AUTH_ISOLATION: VERIFIED

HOSTED_SQL_EXECUTED: NO

HOSTED_WORKERS_ENABLED: NO

READY_FOR_DEPLOYMENT_APPROVAL: YES
