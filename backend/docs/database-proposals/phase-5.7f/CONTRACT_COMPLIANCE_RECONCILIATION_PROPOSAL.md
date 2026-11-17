# Proposed Contract Compliance Register Reconciliation

> **NOT FOR EXECUTION - REVIEW REQUIRED - PRODUCTION DATABASE CHANGE NOT AUTHORIZED**

The existing `backend/docs/member1-member2-contract-compliance.md` is not
modified by Phase 5.7j. It contains stale statements and must not be treated as
current authority. The Contract v1 PDF remains authoritative.

## Stale statements and evidence

1. The register says no job schema/repository evidence exists. Current code now
   defines job contracts and orchestration in
   `backend/src/types/intelligence-jobs.ts:34`,
   `backend/src/repositories/intelligence-job.repository.ts:21`, and
   `backend/src/services/prescription-processing.service.ts:79-166`.
2. It says no intelligence response adapter/correlation service exists. Current
   code validates correlation and envelopes in
   `backend/src/services/intelligence-contract-v1.validator.ts:208-226` and
   maps results in `backend/src/services/intelligence-result.mapper.ts:103-211`.
3. It says no intelligence-result mapping exists. Current code defines exact
   SQL-backed projection fields in
   `backend/src/types/intelligence-persistence.ts:7-131` and mapper tests in
   `backend/tests/intelligence-result.mapper.test.ts:82-220`.
4. It describes persistence, response validation, status enums, nested success
   sections, failure codes, medicine sequence/match/confidence/null behavior,
   correlation, and optional-field compatibility as wholly PENDING. These are
   now implemented and offline-tested at the TypeScript boundary, but durable
   PostgreSQL atomic persistence and live Supabase enforcement remain PENDING.
5. It marks several exact contract details as `NEEDS_SOURCE_VERIFICATION` even
   though the authoritative PDF specifies success/failure envelopes, error
   codes, match statuses, warning severities, confidence/null semantics, and
   `ingredient_equivalence`. The TypeScript alternative spelling discrepancy
   remains a real blocker rather than missing PDF evidence.

## Recommended later update

After separate approval, revise the register line-by-line to distinguish:

- authoritative PDF requirements;
- TypeScript validation/mapping implemented and offline-tested;
- in-memory atomicity simulations;
- SQL proposal-only interfaces;
- live catalog/RLS/role behavior still unverified;
- alternatives deliberately disabled;
- split current persistence versus proposed single-RPC finalization.

Do not label durable persistence, hosted privileges, migration safety, or live
concurrency as implemented until actual code and isolated evidence exist.
