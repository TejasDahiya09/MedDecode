# Rollback and Recovery Notes

> **NOT FOR EXECUTION - REVIEW REQUIRED - PRODUCTION DATABASE CHANGE NOT AUTHORIZED**

## Controlled sequence

1. Freeze lifecycle and prescription-delete deployments.
2. Re-run catalog and anomaly audits. Required aggregate gates include
   processing jobs with incomplete lease state, non-processing jobs retaining
   lease state, incompatible lifecycle counters/generations, result rows with
   `job_id IS NULL`, and missing or mismatched result-to-job prescription
   lineage. Any non-zero count is STOP.
3. Capture definitions, owners, policies, ACLs, default privileges, and sizes.
4. Create concurrent indexes one at a time outside transactions.
5. Verify index validity before attachment.
6. Add columns and constraints transactionally; validate `NOT VALID` objects
   separately.
7. Decide explicitly whether each old scalar FK is retained or removed after
   its composite replacement validates.
8. Install functions only after role/schema feasibility is proven.
9. Revoke bypassing direct writes only after backend dependency tests pass.
10. Deploy a single-RPC backend adapter only after isolated database tests.

Repeat the audits after any separately approved remediation/quarantine and
immediately before transactional additions, constraint validation, and
`result.job_id SET NOT NULL`. No migration phase may silently delete, reset,
backfill, reassign, or clinically reinterpret historical rows.

## Lock strategy

Worker lifecycle functions use job row, then prescription row, then result row.
Submission locks only the prescription and relies on the partial unique index;
it never later locks a job row. This avoids a direct submit/finalize cycle.

Prescription deletion remains **BLOCKED** while active jobs can exist. The
current owner DELETE policy could lock a prescription and cascade into jobs in
the reverse order. Before claiming deadlock safety, choose one of:

- a controlled delete RPC that refuses active jobs and follows the lifecycle
  lock order; or
- a reviewed prescription-scoped advisory-lock strategy used by every submit,
  claim, finalize, retry, reconcile, and delete path.

No concurrency guarantee exists until repeated multi-session tests prove it.

## Failure recovery

### Concurrent index failure

Inspect exact `pg_index.indisvalid` and `indisready` state. Never retry or drop
by a similar name. A separately approved concurrent drop may remove only a
confirmed invalid proposal-created index.

### Constraint or grant failure

Treat partial state as unknown until the catalog is re-read. Do not modify data
automatically. Restore captured ACL/policy definitions, never guessed grants.

### Unknown connection outcome

Reinspect the exact object and transaction outcome before retry. For
finalization, retry only the identical canonical result; the database decides
whether it is an identical committed replay with complete deterministic
projections or an integrity conflict. Raw JSON equality alone is insufficient.
Projection repair is a separate operator-authorized action, never an implicit
replay side effect.

### Result-bearing nonterminal job

Never requeue or fail it. A reviewed repair routine must verify result job ID,
prescription ID, owner, schema version, and terminal status before repairing
job/prescription state. A result with null or mismatched job lineage is
quarantined for manual review.

## Rollback dependency order

1. Stop new claims and fence active workers.
2. Revoke exact function execution grants.
3. Drop functions/helpers by exact captured signatures.
4. Restore captured table grants and policies.
5. Restore any intentionally removed scalar FK from its captured definition.
6. Drop composite FKs and relax result `job_id` only if compatibility requires.
7. Drop attached unique constraints with explicit index impact review.
8. Drop standalone indexes concurrently in separate operations.
9. Retain used lifecycle columns unless data-loss approval explicitly permits
   their removal.

Immutable results and projections are never routine rollback cleanup.

## Application cutover

Current split persistence occurs in
`backend/src/services/prescription-processing.service.ts`: the persistence
adapter runs before a separate complete/fail job call. A future adapter must
replace that production path with one finalization RPC accepting only the
canonical Contract v1 result. Compatibility tests must inject failures before,
during, and after the RPC and prove no split terminal state remains.

