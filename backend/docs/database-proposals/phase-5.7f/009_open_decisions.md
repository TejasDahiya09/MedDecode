# Open Decisions and Blocking Questions

> **NOT FOR EXECUTION - REVIEW REQUIRED - PRODUCTION DATABASE CHANGE NOT AUTHORIZED**

## Security and hosted Supabase blockers

1. Prove the backend-mediated worker model and choose Node's narrowly scoped
   database execution identity.
2. Verify private schema creation, non-login owner creation, `ALTER OWNER`,
   schema usage, function execution, table/sequence grants, default privileges,
   pooler behavior, and schema-cache refresh in an isolated project.
3. Approve credential issuance, rotation, revocation, audit, and internal
   transport authentication between Python and Node.
4. Approve the endpoint-to-privilege matrix before removing direct ai_jobs and
   projection writes.

## Persistence blockers

5. Implement/review a canonical Contract v1 validator. Known stable fields must
   be validated while unknown backward-compatible optional fields remain raw.
6. Implement/review deterministic projection helpers derived only from the
   canonical result.
   Implement/review a read-only replay integrity verifier that rederives and
   compares exact projection counts/order/values and stored versions. It must
   not repair data. Any repair interface requires separate authorization.
7. Ground byte, array-count, and text-length bounds in product/runtime evidence.
8. Define the terminal repair algorithm for result-bearing nonterminal jobs and
   manual quarantine for null/mismatched historical lineage.
9. Approve one single-RPC Node adapter replacing the current split persistence
   and its failure-injection tests.

## Lifecycle blockers

10. Choose controlled prescription deletion or universal advisory locking.
11. Approve max attempts, lease range, heartbeat interval, backoff, batch size,
    and operational retention.
12. Decide whether job_type is constrained now or remains extensible.
13. Decide whether ai_jobs.updated_at is maintained by a reviewed trigger or
    exclusively by privileged functions.
14. Decide which existing scalar FKs remain after composite FK validation.
15. Define uncertain-outcome retry and identical canonical replay semantics.

## Error vocabularies

Contract v1 error codes remain exactly:

- `UNSUPPORTED_FILE`
- `DOCUMENT_ACCESS_FAILED`
- `INVALID_REQUEST`
- `PROCESSING_FAILED`

Internal operational codes such as `LEASE_EXPIRED`,
`MAX_ATTEMPTS_EXCEEDED`, transport failure, and persistence failure remain in
job operations only. Approve a versioned mapping without changing Contract v1.

## Document handoff

16. Approve S3 reference expiry, audience/purpose binding, ownership checks,
    retry behavior, and log redaction.
17. Confirm how Node verifies current job claim before issuing the reference.

## Contract discrepancy

18. The authoritative PDF uses `ingredient_equivalence`; current TypeScript
    uses `ingredient_equivalent`. Alternatives stay disabled until an explicit
    contract erratum or new version is approved.

## Execution gate

These drafts remain **BLOCKED FOR EXECUTION** until every relevant decision has
an owner, evidence, independent review, and isolated test result.

