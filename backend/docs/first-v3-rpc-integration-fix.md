# First V3 RPC integration failure: local correction evidence

Date: 2026-11-16. Repository: MedDecode-integration, integration/full-project.
Scope: local code and disposable PostgreSQL verification only. No hosted SQL,
hosted state changes, worker startup, job recovery/retry, policy/flag changes,
seed insertion, commits or pushes were performed.

## Corrections

1. `postgres-worker-rpc.transport.ts` explicitly JSON.stringify-encodes the
   reviewed JSONB parameters: p_evidence, p_review, p_medicines, p_event and
   p_result_json. Other parameters retain pg's native encoding. JSON null is
   encoded as `null`; undefined, non-finite numbers, bigint, cycles, sparse
   arrays, functions and non-JSON object instances are rejected before the RPC.
2. Initialization's scalar JSONB is unwrapped by its declared function-column
   name, checked for exactly one row/column, and validated against Review
   Contract v1 **before transaction commit**. Missing, null, array, primitive
   and malformed review responses roll back. Initial completion remains a
   table-returning RPC; it must not be scalar-unwrapped. The store validates
   its job/prescription/status/review-state acknowledgement.
3. The handler/runtime preserve safe processing stage, RPC name, SQLSTATE,
   category, job ID and claim generation. HTTP failure diagnostics preserve
   status and classify transport versus response failures. The composition
   forwards its existing logger into the handler. No provider error bodies,
   raw exception messages, medicine content, credentials or paths are logged.
   Only enumerated PostgreSQL exception messages are retained for error mapping.
4. The owner-scoped review repository logs only safe provider code/status and
   RPC metadata. No change was needed to the already-correct missing-draft
   semantics: successful owned lookup + null draft -> 404 REVIEW_NOT_FOUND;
   provider error or malformed review -> 503 REVIEW_PERSISTENCE_UNAVAILABLE;
   inaccessible prescription -> existing 404 behavior; absent auth -> 401.

## Exact changed files

Application files:

- backend/src/repositories/postgres-worker-rpc.transport.ts
- backend/src/repositories/prescription-review-worker.rpc-store.ts
- backend/src/repositories/postgres-prescription-review.repository.ts
- backend/src/services/real-prescription-worker.handler.ts
- backend/src/services/processing-worker.runtime.ts
- backend/src/services/processing-worker.composition.ts
- backend/src/services/http-python-intelligence.client.ts

Tests:

- backend/tests/postgres-worker-rpc.transport.test.ts
- backend/tests/prescription-review-worker.rpc-store.test.ts
- backend/tests/prescription-review-api.test.ts
- backend/tests/real-prescription-worker.handler.test.ts
- backend/tests/processing-worker.runtime.test.ts
- backend/tests/http-python-intelligence.client.test.ts
- backend/tests/v3-rpc-encoding.pg17.test.ts (new)

This report is also new. All unrelated shared-tree edits were preserved.
No migration SQL or frontend/intelligence implementation was changed.

## Executed verification

Final combined run: **58 passed, 0 failed, 0 skipped**.

Run from backend/ in PowerShell:

```powershell
$env:MEDDECODE_RPC_PG17 = 'true'
npx tsx --test tests/v3-rpc-encoding.pg17.test.ts tests/postgres-worker-rpc.transport.test.ts tests/prescription-review-worker.rpc-store.test.ts tests/real-prescription-worker.handler.test.ts tests/processing-worker.runtime.test.ts tests/processing-worker.composition.test.ts tests/http-python-intelligence.client.test.ts tests/prescription-review-api.test.ts tests/postgres-prescription-review.repository.test.ts tests/confirmed-review-intelligence.client.test.ts
npm run build
```

The PostgreSQL test is opt-in and hardcodes loopback port 5433. It verifies major
version 17, creates a uniquely named disposable database, and uses the existing
synthetic initial-completion fixture plus the unchanged Migration 010 SQL. The
psql database variable is resolved locally for preflight. Required roles are
created only if absent and removed if created by the test. Existing roles are
not altered. Separate connections assume actual PostgreSQL session roles;
the transport itself SET LOCAL ROLEs to meddecode_scoped_worker. This tests
database authorization, not dedicated-login password authentication.

Real SQL markers passed:

- PRESCRIPTION_REVIEW_INITIAL_COMPLETION_PREFLIGHT_OK
- PRESCRIPTION_REVIEW_INITIAL_COMPLETION_VERIFY_OK

The initializer and completion are the actual SQL functions. The minimal
fixture's medicine/event helper placeholders are replaced with synthetic JSONB
recording functions to prove bytes/types arriving through pg. This is a focused
transport/completion fixture, not a repeat of the complete deployed-schema or
all owner-RLS security acceptance suites.

Actual PostgreSQL checks passed:

- JSONB medicine array `[]` and nested evidence object/array round-trip.
- RPC scalar review -> persisted draft, with evidence tied to the initial job.
- Wrong job, wrong prescription, attempt, claim generation and worker rejected.
- Expired scope, expired lease, historical admission generation and disabled
  policy rejected. Administrator snapshots remain unchanged after rejection.
- Actual anon/authenticated session roles denied restricted RPC execution.
- Two distinct worker sessions blocked at an administrator-held row-lock barrier;
  pg_stat_activity confirmed both lock waits before release. Exactly one
  completion succeeded and the other was rejected. No arbitrary sleep barrier.
- Completion is terminal; replay rejected; no intelligence results were created.
- SQL NULL, JSON null, malformed object/array/primitive scalar responses rejected
  without altering completed state. Unit tests also cover empty/multiple rows.
- Disposable database and newly created roles were dropped in finally; all
  pools were closed. The pre-existing PostgreSQL server was left running.

Other evidence:

- Real confirmed-review Python subprocess ran existing Layers 4–5 and returned
  the expected canonical medicine/strength and transcription warning. This is
  genuine Python execution; it is not a new OCR run or hosted catalogue check.
- HTTP client tests use an injected fetch double; they verify authentication,
  bytes, bounded responses, cancellation, schema validation and safe errors.
- Existing V3/non-V3, no-result-before-confirmation, no automatic controlled
  retry, prior-attempt refusal, lease-loss and revision-failure tests passed.
- Production TypeScript build: PASS. Production source typecheck: PASS.
- `git -c core.safecrlf=false diff --check`: PASS.
- Full backend suite was not run; the requested focused suite was run.

## Remaining failures and limits

`npm run typecheck` still fails in the tools/tests project with six existing
errors, outside the new code:

1. confirmed-review-intelligence.client.test.ts:14 TS1470 (import.meta/CommonJS).
2. confirmed-review-intelligence.client.test.ts:15 TS1470 (same).
3. prescription-review-initial-completion.pg17.test.ts:24 TS2769 (readonly pg args).
4. reminders-migration-and-persistence.test.ts:14 TS2307 (missing import).
5. reminders.test.ts:8 TS2307 (missing import).
6. reminders.test.ts:104 TS2379 (mock Express response type).

The earlier live review HTTP 503's specific provider error is not recoverable
from the supplied historical logs. A missing draft alone does not reproduce it.
The new authenticated API regression proves 404 versus true persistence 503,
and safe diagnostics now expose provider codes on future failures. It would
be incorrect to claim that the historical 503 was conclusively diagnosed.

The failed hosted job has not been retried, recovered, changed or verified as
successful. No new genuine hosted OCR-to-review demonstration is claimed.
No MaxListeners warning was reproduced by these focused runs; its historical
origin remains undetermined. Worker restart or prescription retry requires
separate explicit approval.

## Final SHA-256 manifest

Paths below are relative to backend/.

| File | SHA-256 |
| --- | --- |
| src/repositories/postgres-worker-rpc.transport.ts | 227226659D0090E11D4CEB83A78DC2433E3A83F0A0212E06979AF19E82F7235D |
| src/repositories/prescription-review-worker.rpc-store.ts | A456AEA2B94C38DE354E7AA075D1993EAD4BAD7CA94297878E1686320C6DD701 |
| src/repositories/postgres-prescription-review.repository.ts | F570B30CBDC261A7F1C39BE58EA116A3FFD9AA4F8B33946D8864F44FC133CC5A |
| src/services/real-prescription-worker.handler.ts | 228A478112E5BF6824C937F4CFD2048617CA4A59309A8967EC22122874BA263D |
| src/services/processing-worker.runtime.ts | CAAF248AAA1F2B880ED18A2E75C370C9EE128398436B1F62C298DB7C0BD1272E |
| src/services/processing-worker.composition.ts | 05DDEFF46E36585D26594CB2D58154D8847E0192230BF24042D814559159C039 |
| src/services/http-python-intelligence.client.ts | 6F7406DCBF46B1F45735A95A65F2AC60EEA13FBD1DDDDE961349E7C58DB66AA4 |
| tests/postgres-worker-rpc.transport.test.ts | 9299A39C8F0C01E12C0551E04B73FDF7963AEE64617E158345365638C2C33A70 |
| tests/prescription-review-worker.rpc-store.test.ts | 243F24F41734D9F8211E2BBC4D6A83006FF1A9BC83CDAE1A9818ABAC455DA4A5 |
| tests/prescription-review-api.test.ts | 1411DB0734661FFB4C3010F9506EEDB2713CA8C9B1A27E956338FCC1CBBD032F |
| tests/real-prescription-worker.handler.test.ts | 8047537992B68504F4E44AF01889AF057F7BE8878B4AC21F83F46DC298525760 |
| tests/processing-worker.runtime.test.ts | 9E926ADA38E8DD19C6DF02979518258737108C3B63D6A4E545AE96E0FB336016 |
| tests/http-python-intelligence.client.test.ts | BE5B0DE0A1B82CDE4474CAB61F785DFC4D2AECE447953596A4659E4248D1B124 |
| tests/v3-rpc-encoding.pg17.test.ts | 992433036B6A3487EC8F4BC20339781064BD2FB8A9D6F3C071A0AA11FD2AB74E |
