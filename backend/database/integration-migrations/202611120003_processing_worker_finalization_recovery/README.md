# Processing worker finalization and lease-recovery migration candidate

**LOCAL INTEGRATION CANDIDATE ONLY — NOT APPROVED FOR HOSTED DEPLOYMENT.**

This package extends the local-only worker claim/heartbeat candidate. It is not
a deployment instruction, does not create a worker login role, and must not be
run against Supabase or any non-disposable database.

## Scope

The candidate defines three worker-only `SECURITY DEFINER` functions:

- `complete_prescription_analysis_job_v1(uuid, uuid, text, bigint, jsonb)`
- `fail_prescription_analysis_job_v1(uuid, uuid, text, bigint, text, boolean, text, timestamptz)`
- `recover_expired_prescription_analysis_jobs_v1(integer)`

All require the effective database role to be `meddecode_worker`. They revoke
`PUBLIC`, `anon`, and `authenticated` execution, grant only that role, and do
not grant direct table privileges to it.

## Completion boundary

Completion locks the job, prescription, and existing result in that order. It
requires a `processing` job with matching lease owner, claim generation, and
unexpired lease before it inserts the canonical raw result, projections, and
prescription fields. It only changes the job to `completed` after those writes.
The transaction rolls back every write when a validation, projection, or status
transition fails.

The SQL gate is intentionally narrower than the TypeScript Contract v1
validator. It validates correlation, top-level result shape, supported success
statuses, empty alternatives, projection-critical fields, and database
constraints. The application validator remains authoritative for full clinical
semantics. A production worker must validate with TypeScript before calling this
function; SQL is a second, fail-closed persistence boundary.

An identical replay is accepted only when raw JSON, result status, prescription
status, job terminal state, and stored fence metadata match. A different result
or incomplete prior persistence fails closed.

## Failure and retry policy

The failure function accepts only a small allowlist of categorized codes. It
does not accept a message, OCR text, patient data, object location, token, or
provider diagnostic. For a retryable failure before `max_attempts`, it requires
a future retry time no more than 24 hours ahead, clears the lease, returns the
job and prescription to `queued`, and preserves the safe code in `ai_jobs`.

For non-retryable or exhausted work, it marks the job and prescription `failed`.
It deliberately does **not** create a `prescription_intelligence_results` row:
an infrastructure failure code is not a complete Contract v1 failure envelope.
Creating one would fabricate result semantics. A later approved design may add
a canonical failure-result path using an actual validated `IntelligenceFailureV1`.

Failure and recovery calls are not replayable after they clear the lease; a
later call is stale and rejected. This avoids treating an unverified caller as
the original worker after ownership metadata has been cleared.

## Lease recovery

Recovery selects only expired `processing` jobs with `FOR UPDATE SKIP LOCKED`.
It locks each corresponding prescription, fails closed if a result already
exists, increments `claim_generation`, clears the lease, and either requeues or
fails after retry exhaustion. A stale worker cannot heartbeat or finalize after
the generation/status change. Repeated recovery is idempotent because only
expired `processing` rows qualify.

## Prerequisites and blockers

Before any runtime or hosted review, prove all of the following:

1. The committed submission candidate and local worker claim/heartbeat candidate
   are present, valid, and compatible with current hosted catalog metadata.
2. `ai_jobs` has every lease/attempt column expected by `001_preflight.sql`.
3. The result and projection tables have the historical columns and constraints
   assumed by `002_up.sql`.
4. `meddecode_worker` is a safe `NOLOGIN`, `NOINHERIT` authorization role and a
   separately approved hosted login/role-assumption mechanism exists.
5. The worker's TypeScript completion handler validates Contract v1 before use.
6. Alternatives remain empty until the unresolved contract-key mismatch has an
   approved resolution.

## Future local runtime test only

`test/run-local.ps1` is intentionally operator-gated and targets only
`postgresql://postgres@127.0.0.1:5433/meddecode_job_test`. It first delegates
target validation and read-only identity/inventory checks to the preceding
worker harness. It then applies only disposable fixtures and local candidate
SQL. It must not be run without separate approval:

```powershell
& '.\test\run-local.ps1' `
  -DatabaseUrl 'postgresql://postgres@127.0.0.1:5433/meddecode_job_test' `
  -PsqlPath 'C:\Program Files\PostgreSQL\17\bin\psql.exe' `
  -ApproveDisposableReset
```

The command was not executed while creating this package. It will reset the
disposable local `public` and `auth` schemas through the inherited harness.
It executes successful completion, retryable and terminal failure, invalid
failure commands, bounded recovery, repeated recovery, and a genuinely
overlapping two-session completion-versus-recovery fence test. The second
session waits for a recovery-held advisory rendezvous lock, then blocks on the
same `ai_jobs` row before observing the stale recovered state. It is not
suitable for a database with any non-fixture data.
