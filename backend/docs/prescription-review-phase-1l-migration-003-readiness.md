# Phase 1L — Migration 003 deployment readiness

Date: 2026-11-16
Scope: local implementation and verification plus hosted read-only preflight only. No hosted SQL, data, ACL, feature-flag, or worker change was performed.

## Objective

Migration 003 adds the least-privileged V3 worker bridge between confirmed review revisions and the existing scoped worker queue. It covers owner-derived confirmed-revision submission, scoped authorization, review loading, and a revision-fenced failure path.

## Final artifacts and SHA-256

| File | SHA-256 |
| --- | --- |
| `001_preflight.sql` | `d9110205923513085b8c70f0f4922506fc0a4dff7bfedbd92703df3350d3a28a` |
| `002_up.sql` | `aab73c2a40227b93bc6d312eb85c885304543d68083110c508120b74ee4f596e` |
| `003_verify.sql` | `c344dff1465358e106a6c0a1d8b1fb4889e75ebd60edf2b12bb1326289ee2d02` |
| `004_rollback_review.sql` | `bdf1c75ea6ec17abf83a9069181df131df3fc3df3cff385fe904ea5a527140d3` |

## Implementation

Relevant Phase 1L files:

- `backend/src/repositories/prescription-review-worker.store.ts`
- `backend/src/repositories/prescription-review-worker.rpc-store.ts`
- `backend/src/repositories/postgres-worker-rpc.transport.ts`
- `backend/src/services/real-prescription-worker.handler.ts`
- `backend/src/worker.ts`
- `backend/tests/real-prescription-worker.handler.test.ts`
- `backend/tests/postgres-worker-rpc.transport.test.ts`
- `backend/tests/prescription-review-worker-v3.local.sql`
- `backend/database/integration-migrations/202611150003_prescription_review_worker_v1/`

The worker identifies `confirmed_review` claims from the database-bound revision identifier and fingerprint. Those jobs bypass document OCR and use only the confirmed-review intelligence path. Initial OCR jobs continue to initialize review before the legacy fenced completion path.

`meddecode_fail_review_job_v1` is the terminal failure path for a confirmed revision. It requires the scoped worker role, exact job/prescription/revision/fingerprint, matching worker instance and claim generation, a live scope owned by the login session, a current confirmed bound revision, and a previous current completed result. It marks only the job failed, clears its lease, restores the prescription status from the preserved result, and returns the revision to explicit `pending` state. It does not insert a retry. The owner may explicitly replay the existing confirmation request later; that creates a fresh job only through the existing owner-derived RPC.

The worker never falls back to the legacy prescription-level failure RPC for a V3 confirmed-review job. The restricted transport now has a fixed allowlist and exact parameter ordering for `meddecode_fail_review_job_v1`.

## Local PostgreSQL 17 verification

The existing disposable loopback Phase 1F PostgreSQL 17 database was used. The tested sequence was:

1. `001_preflight.sql` with its local expected database override: `PRESCRIPTION_REVIEW_WORKER_PREFLIGHT_OK`.
2. Atomic `002_up.sql` deployment.
3. `003_verify.sql`: `PRESCRIPTION_REVIEW_WORKER_VERIFY_OK`.
4. Rollback-wrapped V3 functional test: `PRESCRIPTION_REVIEW_WORKER_FUNCTIONAL_OK`.
5. Guarded `004_rollback_review.sql`, confirmed the failure RPC was absent, then repeated preflight, deployment, and independent verification successfully.

The functional test verifies duplicate submission reuse, cross-owner rejection, scoped failure of revision 2, preservation of revision 1 as the current readable result, no automatic retry, and explicit owner replay producing a distinct queued job. The test transaction rolls back. Final fixture check returned `0|0` for the fixed fixture prescription and active confirmed-review jobs. The named disposable cluster was stopped with `PHASE1F_DATABASE_STOPPED`.

## Regression evidence

- Backend serial suite: **562 passed, 0 failed** (`npm test -- --test-concurrency=1`).
- Backend production build: passed (`npm run build`).
- Focused Python confirmed-review, Contract v1, dosage-parser, and instruction-parser suite: **37 passed**.
- Frontend production build/typecheck: passed.
- Frontend unit suite: **346 passed, 1 failed**. The unrelated failure is `medicine-insights.test.tsx` pagination expectation: it expects `form` and `offset`, while the current concurrent frontend implementation calls its search client with `{ limit: 6, signal, source }`. This Phase 1L backend change did not edit frontend files and no frontend workaround was applied.
- `git diff --check`: no whitespace errors; Git printed pre-existing CRLF normalization warnings only.

## Hosted read-only preflight

The established `meddecode_hosted_admin` service reported `current_database=postgres`, `current_user=postgres`, and PostgreSQL 17.11. Migration 003's exact `001_preflight.sql` ran inside `BEGIN READ ONLY` and returned `PRESCRIPTION_REVIEW_WORKER_PREFLIGHT_OK`, followed by `ROLLBACK`.

This verifies required Migrations 001/002 objects, automatic-authorization base objects, and scoped role presence; it also verifies that Migration 003 functions do not already exist. It performed no mutation. The Supabase project reference is an external connection-setting attribute, not a PostgreSQL catalog value; target project `wyripeqruhvbksjfsvlr` must be reconfirmed from the configured service before any execution approval.

## Security and deployment boundaries

- `SECURITY DEFINER` functions have fixed `pg_catalog,public` search paths.
- Submit execution is restricted to `authenticated`; worker operations are restricted to `meddecode_scoped_worker`.
- `PUBLIC`, `anon`, `authenticated`, and the legacy worker do not receive worker-RPC execution.
- No direct table write grant was introduced.
- Migration 003 is additive with respect to deployed Migrations 001 and 002; it does not claim, alter, or process an existing queued job during deployment.
- Rollback is review-only and must not be used while V3 jobs/scopes exist. It does not restore application data because the migration itself creates functions only.

## Required separate approval

Before hosted deployment, require explicit approval for exactly `002_up.sql` at the hash above, after fresh project/service identity, backup/recovery, role/ACL, queue-state, and preflight verification. Execution must be one transaction with error-stop, immediately followed by `003_verify.sql`. A separate approval is then required for any V3 feature flag or restricted worker activation.

## Status

```text
PHASE_1L_IMPLEMENTATION: COMPLETE
MIGRATION_003_LOCAL_VERIFIED: YES
MIGRATION_003_HOSTED_PREFLIGHT: PASS
MIGRATION_003_HOSTED_DEPLOYED: NO
HOSTED_MUTATIONS: NONE
READY_FOR_MIGRATION_003_APPROVAL: YES
READY_FOR_V3_ACTIVATION: NO
```
