# Phase 5.7f - Durable Intelligence Persistence Proposals

> **NOT FOR EXECUTION - REVIEW REQUIRED - PRODUCTION DATABASE CHANGE NOT AUTHORIZED**

These Phase 5.7h revisions are inert design drafts. SQL files remain entirely
inside outer block comments, are not migrations, and are not wired to startup,
CI, package scripts, Prisma, or any database runner.

## Revised design

- One canonical Contract v1 result enters privileged finalization.
- Relational projections are deterministically derived in a trusted versioned
  boundary; independent projection arguments are removed.
- SQL NULL/JSON null and required contract structures are validated safely.
- Result-aware reconciliation never blindly reprocesses durable results.
- Job and prescription retry state changes occur transactionally together.
- Direct authenticated job mutations are removed only after dependency review.
- The recommended worker model is Python -> private Node boundary -> restricted
  database RPC; its hosted identity remains blocked pending proof.
- Secure document access uses a short-lived backend-authorized S3 reference;
  implementation remains separately gated.

## Schema authority

Historical SQL in `backend/docs/database-reference/` is read-only evidence, not
proof of live state. The verified recommendation table is
`public.prescription_recommendations`. Live catalog evidence must be recaptured.

## Contract boundaries

- Job and prescription IDs remain Member 2-owned.
- `medicine_external_id` remains Member 1-owned and is not fabricated into
  internal `medicine_id`.
- Missing clinical data remains null and empty collections remain arrays.
- Extracted patient data never updates authenticated user/health profiles.
- Alternatives remain disabled pending the
  `ingredient_equivalence`/`ingredient_equivalent` discrepancy decision.

## Files

1. `001_schema_proposal.sql`
2. `002_submit_job_proposal.sql`
3. `003_claim_heartbeat_proposal.sql`
4. `004_finalize_job_proposal.sql`
5. `005_retry_reconciliation_proposal.sql`
6. `006_rollback_recovery_notes.md`
7. `007_security_review.md`
8. `008_test_plan.md`
9. `009_open_decisions.md`
10. `FINDINGS_RESOLUTION.md`
11. `CANONICAL_VALIDATION_PROJECTION_CONTRACT.md`
12. `PHASE_5_7J_CORRECTIONS.md`
13. `CONTRACT_COMPLIANCE_RECONCILIATION_PROPOSAL.md`

## Approval gates

1. Repeat read-only live catalog and anomaly audits.
2. Resolve every BLOCKED worker/owner/privilege decision.
3. Independently review canonical validator and projection-helper designs.
4. Review exact migration and rollback fragments separately.
5. Run disposable PostgreSQL transaction/concurrency/rollback tests.
6. Run two-user Supabase-compatible RLS and role tests.
7. Review the future single-RPC backend adapter and short-lived document flow.
8. Obtain explicit staging approval; production requires separate approval.

## Readiness

The revised package is suitable for independent design review only. It is not
ready for SQL compilation, staging, or production execution.
