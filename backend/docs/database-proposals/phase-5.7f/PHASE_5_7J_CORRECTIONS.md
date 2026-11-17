# Phase 5.7j Targeted Corrections

> **NOT FOR EXECUTION - REVIEW REQUIRED - PRODUCTION DATABASE CHANGE NOT AUTHORIZED**

## Corrected draft defects

1. Finalization now separates Contract v1 failure persistence from success
   projection derivation. Failed results create no success projections.
2. Replay requires canonical equality plus deterministic persisted-state and
   projection verification. No implicit repair is authorized.
3. Schema design adds explicit aggregate anomaly audits and STOP gates before
   constraint validation and `job_id SET NOT NULL`.
4. Lease reconciliation compares job and prescription transition counts and
   rolls back on zero/multi-row lineage anomalies.
5. A separate reconciliation proposal records stale compliance-register
   claims without modifying the historical register.

## Remaining blockers

- Canonical validation, projection derivation/insertion, replay verification,
  and result-bearing repair helpers are specifications only.
- Hosted Supabase role, function owner, private schema, grants, default
  privileges, pooler behavior, and schema-cache behavior remain unproven.
- Historical anomalies require separately approved remediation/quarantine.
- Alternatives remain disabled pending the contract spelling decision.
- Exact payload/count/text limits require grounded product/runtime evidence.
- Lock ordering, fencing, replay, rollback, and reconciliation require
  disposable multi-session database tests.

These changes improve the review draft. They do not make it executable,
compilable, staging-ready, or production-ready.
