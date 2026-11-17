# Isolated PostgreSQL and Supabase-Compatible Test Matrix

> **NOT FOR EXECUTION - REVIEW REQUIRED - PRODUCTION DATABASE CHANGE NOT AUTHORIZED**

Only a disposable database, synthetic UUIDs/JSON, and synthetic users are
allowed. No AWS object, patient file, production token, or Member 1 runtime.

## Migration and rollback

- Catalog preflight matches expected version, names, owners, ACLs, and policies.
- Duplicate active jobs, owner mismatch, null lineage, and invalid lease rows
  stop the relevant phase.
- Concurrent index partial failure is detected and recovered by exact name.
- Old/new FK coexistence and chosen scalar-FK cutover are tested separately.
- Rollback restores captured definitions and never broad guessed grants.

## NULL and contract validation

- Reject SQL NULL and JSON null canonical result.
- Reject missing/incorrect schema version, IDs, status, required objects/arrays,
  correlation, error semantics, confidence range, sequence, and match status.
- Accept Contract v1 nullable fields and empty arrays without invented values.
- Unknown optional fields remain raw-only and never alter projections.
- Reject non-empty alternatives while the naming discrepancy is unresolved.
- Verify byte, count, and text limits once grounded limits are approved.

Focused Phase 5.7j cases:

1. Accept a valid failed result containing correlation fields and structured
   error only; create no success projections.
2. Reject a failed result carrying contradictory success sections.
3. Accept a complete valid `completed` result.
4. Accept `completed_with_warnings` and preserve warning order/severity.
5. Reject SQL NULL and JSON null independently.
6. Reject a success result missing any required array.

## Submission and permissions

- Owner submits owned processable prescription; other owner cannot.
- Concurrent submissions produce one active job.
- Existing result prevents submission.
- Direct authenticated job INSERT/UPDATE/DELETE fails after cutover.
- Authenticated can execute submission but no worker RPC.
- PUBLIC and anon execute no privileged function.
- Backend worker identity has RPC execution and no direct table DML.
- Function owner is never used by ordinary requests.

## Claim, lease, and fencing

- Two workers cannot claim one row; `SKIP LOCKED` claims different rows.
- Claim increments attempt and generation exactly once.
- Heartbeat requires worker, generation, state, and unexpired lease.
- Expiry/reclaim fences the old worker.
- Result-bearing job is never claimed, requeued, or failed.
- Internal LEASE_EXPIRED is never returned as Contract v1 error.code.

## Atomic finalization and rollback

Inject failure after raw result, each projection family, prescription update,
and job terminal update. Every failure must roll back all effects.

- Canonical result is the only caller result input.
- Stored raw JSON and derived projections are compared field by field.
- Completed/warnings/failed mappings are correct.
- Failed result has exact structured error and no success projections.
- Stale first-time finalization fails.
- Identical replay succeeds after uncertain commit response.
- Identical committed replay succeeds only when raw/result metadata, terminal
  states, and every deterministic projection are intact.
- Identical raw replay with one missing, extra, reordered, version-mismatched,
  or value-mismatched projection fails as an integrity conflict; it never
  performs implicit repair.
- Different canonical replay, job, prescription, or owner fails.
- A stale/expired worker cannot perform first-time finalization.
- No write reaches alternatives, users, health profiles, or Member 1 medicines.

## Retry and reconciliation

- Retryable failure requeues job and prescription in one transaction.
- Exhaustion fails job and prescription in one transaction.
- Two reconcilers process bounded disjoint rows.
- Existing result invokes verified terminal repair, never reprocessing.
- Null/mismatched historical result lineage is quarantined, not auto-repaired.
- Crash and connection-loss tests cover claim, Member 1 response, finalization,
  commit-with-lost-response, identical replay, and conflicting replay.
- A historical `processing` job missing any lease field blocks migration.
- A historical result with `job_id IS NULL` blocks `SET NOT NULL`.
- Reconciliation encountering a missing owned prescription row raises and rolls
  back the selected job transition.
- Zero-row and multi-job/same-prescription anomalies produce a job versus
  prescription update-count mismatch and roll back the complete function.
- Concurrent finalize, retry, and reconciliation sessions preserve fencing,
  result exclusion, lock ordering, and atomic terminal state.

## Locking and concurrency

Run repeated independent sessions for submit/claim/finalize/retry/reconcile.
Separately test delete through the approved controlled delete design. Include:

- submit versus finalize;
- submit versus delete;
- finalize versus reconcile;
- retry versus reconcile;
- two finalizers in reverse order;
- lock and statement timeout rollback;
- deadlock detection over an approved iteration count.

No deadlock guarantee is claimed from mocks or inspection alone.

## Document-reference security

- Only current claimed job/generation can obtain a reference.
- Wrong owner/job/generation is denied indistinguishably.
- Reference is HTTPS, short-lived, single-object, and never logged.
- Expiry and retry do not leak bucket/key or credentials.
- Python receives no Supabase/AWS privileged credential.

## Approval evidence

Migration hash, PostgreSQL version, before/after catalogs, complete role/grant
matrix, test counts, concurrency iterations, rollback result, zero-network
proof, known limitations, and skipped cases are mandatory. Passing mocks alone
is insufficient; separate two-user Supabase-compatible RLS testing is required.
