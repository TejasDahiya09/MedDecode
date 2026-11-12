# Intelligence result persistence design (offline only)

This document describes the Phase 5.6b mapper and transaction simulator. It is
not a migration, a production repository, or evidence that the live database
matches the historical application-schema SQL reference. No SQL or live service
is invoked by this implementation.

## Source and destination boundaries

The mapper accepts only a response that passes the committed Contract v1
validator. It revalidates the response at the persistence boundary and retains a
detached, deeply frozen copy of the complete response in `result_json`, including
unknown optional future fields.

The following destinations come directly from the untracked historical SQL
reference under `backend/docs/database-reference/`:

- `prescription_intelligence_results`: prescription/job correlation, schema
  version, terminal status, complete `result_json`, and structured `error_json`.
- `prescriptions`: terminal status, prescription/doctor/facility/patient fields,
  intelligence versions when supplied, overall confidence, and `processed_at`.
- `prescription_medicines`: ordered extraction, confidence, match status, and
  derived numeric fields. Sequence numbers remain one-based.
- `prescription_recommendations`: type, title, message, optional related medicine
  sequence, and confidence.
- `prescription_warnings`: code, original severity, message, and optional related
  medicine sequence.

The transaction interface itself is a proposed application boundary, not a new
database column or a deployed stored procedure. A production implementation must
perform all logical writes and the terminal job transition inside one real
PostgreSQL transaction after rechecking ownership, correlation, state, and replay
identity.

## Unsupported normalized fields

Contract fields `medicine_external_id`, matched brand name, matched dosage form,
and matched ingredients have no safe direct destination in the current normalized
medicine projection. They remain present in raw JSON and are reported through
`unsupportedNormalizedFields`. In particular, `medicine_external_id` is never
treated as the internal `public.medicines.id` UUID.

Alternative-medicine persistence is deliberately disabled. The authoritative PDF
uses `ingredient_equivalence`, while the committed validator uses
`ingredient_equivalent`. Empty alternatives remain valid; every non-empty
alternatives array is rejected at the mapper boundary pending owner approval of a
single canonical key. No spelling is assumed to be correct.

## Replay and transaction policy

The historical SQL declares
`prescription_intelligence_results.prescription_id` as `NOT NULL UNIQUE`, so it
permits at most one committed intelligence result per prescription. The test-only
in-memory transaction fake enforces that same prescription-level cardinality and
retains the originating `job_id` in the stored raw result.

For the same job and prescription, the fake accepts a replay only when its JSON is
canonically equivalent to the already stored result and the job is in the matching
terminal state. The accepted replay is a no-op: projections, prescription metadata,
and terminal timestamps are not rewritten. A different result from the same job is
rejected as a conflicting replay. Any different job targeting a prescription that
already has a result is rejected, regardless of whether either result is completed,
completed with warnings, or failed.

This phase does not implement reprocessing or multi-attempt result replacement.
Supporting those workflows requires an explicit schema and contract decision. The
local policy does not establish production idempotency, multi-process concurrency
control, PostgreSQL transaction behavior, or distributed durability.

Failure injection is available at raw-result storage, projection storage,
prescription update, and job transition. The fake commits a cloned state only after
all stages succeed, so a simulated failure leaves the prior state unchanged.
Snapshots are detached and deeply frozen.

## Security boundaries and remaining verification

Finalization requires the expected user, job owner, and prescription owner to
match, and requires response job/prescription identifiers to match the current
job. The mapper does not carry signed document URLs, storage credentials, bucket
names, object keys, or write paths for users, health profiles, family members,
medicine cabinet entries, or the Member 1 medicine catalogue.

Before any production persistence work, the live catalog, constraints, RLS,
transaction mechanism, uniqueness/replay behavior, and authorized role must be
verified independently. The historical SQL reference remains untracked and must
not be executed or treated as proof of deployed state. The in-memory simulator is
not a substitute for real PostgreSQL constraints, transactions, locking, or
concurrency testing.
