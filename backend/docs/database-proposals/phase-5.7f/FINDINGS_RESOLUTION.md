# Phase 5.7g Findings Resolution Register

> **NOT FOR EXECUTION - REVIEW REQUIRED - PRODUCTION DATABASE CHANGE NOT AUTHORIZED**

This register maps every Phase 5.7g finding to the Phase 5.7h drafts. A status
describes the design text only; it does not claim PostgreSQL compilation,
Supabase feasibility, migration safety, or runtime implementation.

| Finding | Status | Revised evidence | Resolution and remaining gate |
|---|---|---|---|
| C1 raw/projection divergence | PARTIALLY RESOLVED | `004_finalize_job_proposal.sql`; `CANONICAL_VALIDATION_PROJECTION_CONTRACT.md` | Success projections derive from one canonical result; failure skips them. Deterministic derivation and integrity-verification helpers remain undefined and BLOCKED. |
| C2 NULL JSON validation | PARTIALLY RESOLVED | `004_finalize_job_proposal.sql:42-56`; `008_test_plan.md:17-25` | SQL NULL, JSON null, required type, correlation, and bounded payload checks are required. The full canonical validator is still BLOCKED. |
| H1 direct job insert bypass | PARTIALLY RESOLVED | `001_schema_proposal.sql:133-151`; `007_security_review.md:51-63` | Draft revokes authenticated job DML and identifies the historical insert policy. Cutover waits for the endpoint/privilege matrix and live policy inventory. |
| H2 missing role/schema provisioning | BLOCKED PENDING DECISION | `007_security_review.md:25-37`; `009_open_decisions.md:5-14` | Required private schema, owner, grants, defaults, and deployment permissions are enumerated but hosted feasibility is unproven. |
| H3 worker authentication | BLOCKED PENDING DECISION | `003_claim_heartbeat_proposal.sql:4-13`; `007_security_review.md:5-23` | Backend-mediated access is recommended. Node's restricted database identity and credential lifecycle require isolated proof. |
| H4 result-aware reconciliation | PARTIALLY RESOLVED | `005_retry_reconciliation_proposal.sql`; `006_rollback_recovery_notes.md` | Result-bearing jobs are excluded, transition counts must match, and anomalies roll back. Repair/quarantine helpers remain BLOCKED. |
| H5 requeue prescription status | RESOLVED IN DRAFT | `005_retry_reconciliation_proposal.sql:92-113`; `008_test_plan.md:63-70` | Requeue updates job and prescription to queued in the same function transaction. |
| H6 split backend persistence | PARTIALLY RESOLVED | `006_rollback_recovery_notes.md:78-86`; `009_open_decisions.md:24-27` | Exact split location and single-RPC cutover are documented. Application code is intentionally unchanged. |
| H7 document handoff | PARTIALLY RESOLVED | `007_security_review.md:65-82`; `008_test_plan.md:84-91` | Short-lived, claim-bound backend-authorized S3 access is designed. AWS and internal transport details remain separately gated. |
| H8 exact Contract v1 validation | PARTIALLY RESOLVED | `004_finalize_job_proposal.sql`; `CANONICAL_VALIDATION_PROJECTION_CONTRACT.md` | Success/failure envelopes, null rules, statuses, field names, mapper columns, and unresolved bounds are specified. SQL helper implementation remains BLOCKED. |
| M1 lock order | PARTIALLY RESOLVED | `006_rollback_recovery_notes.md:20-36`; `008_test_plan.md:72-82` | Worker order is documented and direct deletion is blocked. Controlled delete versus universal advisory locking remains a decision and requires stress tests. |
| M2 composite FKs | BLOCKED PENDING DECISION | `001_schema_proposal.sql:124-130`; `006_rollback_recovery_notes.md:7-17,63-75` | Coexistence is temporary; retain/drop decisions require live constraint inventory and captured rollback definitions. |
| M3 lifecycle invariants | PARTIALLY RESOLVED | `001_schema_proposal.sql:61-81,151-157`; `009_open_decisions.md:29-38` | Attempt and heartbeat invariants are strengthened. Job-type vocabulary and updated-at ownership remain decisions. |
| M4 replay validation | PARTIALLY RESOLVED | `004_finalize_job_proposal.sql`; `006_rollback_recovery_notes.md`; `CANONICAL_VALIDATION_PROJECTION_CONTRACT.md` | Replay requires raw equality plus deterministic projection/status/version verification. The verifier and any separate repair interface remain undefined and BLOCKED. |
| M5 error vocabulary | RESOLVED IN DRAFT | `005_retry_reconciliation_proposal.sql:4-7,144-146`; `009_open_decisions.md:40-51` | Contract errors and internal operational codes are explicitly separated without changing Contract v1. |
| L1 search path | RESOLVED IN DRAFT | `002_submit_job_proposal.sql:15`; `003_claim_heartbeat_proposal.sql:23,77`; `004_finalize_job_proposal.sql:27`; `005_retry_reconciliation_proposal.sql:16,76`; `007_security_review.md:39-49` | Revised functions prefer empty search path and explicit qualification. Compilation remains an isolated-test requirement. |
| L2 alternatives field | BLOCKED PENDING DECISION | `004_finalize_job_proposal.sql:61-68`; `007_security_review.md:90-94`; `009_open_decisions.md:59-63` | The PDF/TypeScript spelling discrepancy is recorded and alternatives remain disabled. No silent field rename is proposed. |

## Summary

- **RESOLVED IN DRAFT:** H5, M5, L1.
- **PARTIALLY RESOLVED:** C1, C2, H1, H4, H6, H7, H8, M1, M3, M4.
- **BLOCKED PENDING DECISION:** H2, H3, M2, L2.

Phase 5.7j also corrects the failed/success branch, adds historical-row STOP
audits, and adds reconciliation row-count assertions. These are draft design
corrections only. The package remains blocked for SQL execution and isolated
database testing until all named helpers and security decisions are resolved.

