# Exact-job second-attempt recovery: local implementation and approval boundary

2026-11-16. Repository: MedDecode-integration, branch integration/full-project.

Target job: `51c6cffd-ac79-4eaa-bc6d-851f20c2abab`.
Target prescription: `2bb56f2d-df83-4132-95a4-b9552fa48dd8`.

LOCAL_VERIFICATION: PASS
HOSTED_PREFLIGHT: NOT_RUN
HOSTED_DEPLOYMENT: NOT_RUN
HOSTED_MUTATIONS: NONE
WORKER_STARTED: NO
PRESCRIPTION_RETRIED: NO
GENERATION_2_CHANGED: NO

## Existing limitation

The existing scoped recovery function accepts a batch limit, requires a valid
scope, preserves attempt_count and increments claim_generation. A subsequent
normal claim increments both attempt_count and claim_generation again. The
reviewed controlled worker allows attempt 1 only, rejects automatic recovery,
and rolls back any second claim. It cannot safely perform this recovery merely
by restarting. No attempt counters should ever be reset.

## Implemented database design

New independently versioned migration:
`backend/database/integration-migrations/202611160013_exact_job_recovery_v1/`.

Deployment itself only installs an empty audit table and functions. It does not
issue a permit, renew a scope, change a job, change admission history, or alter
Generation 2 policy state.

1. `meddecode_authorize_exact_job_retry_v1(uuid,uuid,integer,bigint)` is
   administrative-only (postgres session/role). It locks the singleton policy
   and exact job, requires attempt 1, the expected claim generation, expired
   lease/scope, correct owner, current-generation admission and exactly one
   allowlisted account. It requires Generation 2 enabled and exactly one
   Generation 2 admission, no competing worker session, no other active scoped
   work and no existing review/evidence/result for the prescription.
2. Authorization inserts one permanent audit permit for that job and refreshes
   only its existing identity-matched scope. Expiry is the smaller of policy
   scope_seconds and 600 seconds. The permit stores old attempt, claim
   generation, lease/scope expiry, owner, admission generation, issuer identity
   and timestamps. Job state/counts remain unchanged. A permit cannot be minted
   again for the same job, including after expiry or consumption.
3. `meddecode_recover_claim_exact_job_v1(uuid,uuid,uuid,text,integer)` receives
   permit ID, exact job/prescription IDs, worker identity and bounded lease.
   The dedicated scoped worker role locks policy, permit and job, rechecks
   ownership/admission/allowlist/expiry/isolation, then atomically performs
   recovery plus claim. Attempt **1 -> 2**, claim generation **1 -> 3** for this
   target. The +2 represents the recovery fence and new-claim fence. There is
   no externally visible queued gap or second queue. The permit is consumed in
   that same transaction. A full requested 30–300 second initial lease must fit
   within the remaining permit lifetime.
4. Two concurrent authorizers can mint one permit. Two concurrent recoverers
   can consume it once. Restarting with the same consumed permit cannot reclaim
   the job. Expired permits fail closed and cannot be renewed automatically.
5. Permitted jobs are excluded from the legacy automatic issuer, scoped batch
   recovery and scoped queue claim. Other jobs retain their original behavior.
6. The legacy review initializer lacks an explicit claim-generation parameter.
   It now denies jobs with retry permits **after acquiring the job row lock**.
   This placement also fences a legacy call that began before authorization
   committed. `meddecode_initialize_exact_retry_review_v1` requires the permit,
   worker, live lease, attempt 2 and exact new generation, then calls a private
   copy of the reviewed initializer. The copied core has no worker/PUBLIC/
   authenticated EXECUTE grant. Other jobs keep the legacy initializer.
7. Existing Migration 010 initial-completion fencing remains in use. The retry
   stops at a draft review. No intelligence result is created before manual
   confirmation. Confirmed-review processing is not allowed in exact-retry mode.

The new table is postgres-owned, RLS-enabled and has no non-owner table grants.
Only the two worker RPCs receive scoped-worker EXECUTE. The admin authorizer and
private core are owner-only. Unexpected owner-specific default grants on the
new objects are revoked locally to those objects, without changing global
roles/default privileges. No direct worker table mutation privilege is added.

The migration copies four reviewed function bodies with narrowly added
permit exclusions; preflight SHA-256-checks their stored source before replacing
anything. Independent verification checks exact installed body hashes,
ownership, SECURITY DEFINER, fixed search paths and ACL/effective privileges.
Unexpected source drift blocks deployment rather than copying unknown code.

## Worker integration

New configuration is absent by default. It requires all four values:

- WORKER_EXACT_RETRY_PERMIT_ID
- WORKER_EXACT_RETRY_JOB_ID
- WORKER_EXACT_RETRY_PRESCRIPTION_ID
- WORKER_EXACT_RETRY_EXPECTED_GENERATION

It also requires existing scoped RPC, automatic authorization, V3 and controlled
single-execution settings. `WORKER_SINGLE_ATTEMPT=true` is retained; normal mode
still accepts only attempt 1. Exact mode accepts only the permit-bound target at
attempt 2 and expected old generation +2. All other claim responses roll back.

Exact mode routes the claim directly to the exact recovery RPC and initialization
to the fenced retry initializer. It cannot invoke the next-job issuer, batch
recovery, legacy result completion, confirmed-review processing or another job.
It makes one claim call, exits on the first claim error, does not schedule scope
renewal/recovery, and finalizes processing failures without automatic retry.
The existing runtime stops after its one handler execution. A crash after the
claim commits consumes the permit; there is deliberately no automatic recovery
for attempt 3. Such a failure needs a new separately reviewed decision.

The existing launcher already forwards worker settings only to the worker;
tests verify exact-retry settings are withheld from frontend and Python service.
No launcher implementation, credentials, environment files, OCR implementation,
memory limit or shared contracts were changed or activated.

## Local verification actually executed

- PostgreSQL 17 exact-recovery suite: **39 passed, 0 failed, 0 skipped**.
- Focused backend suite: **70 passed, 0 failed, 0 skipped**.
- Launcher suite: **6 passed, 0 failed**.
- Backend production build: **PASS**.
- `git -c core.safecrlf=false diff --check`: **PASS**.

PostgreSQL markers:

```text
EXACT_JOB_RETRY_PREFLIGHT_OK
EXACT_JOB_RETRY_VERIFY_OK
DISPOSABLE_EXACT_DATABASES_REMAINING:0
TEST_WORKER_LOGIN_REMAINING:0
```

The database suite pins loopback port 5433, verifies PostgreSQL major 17, creates
a uniquely named disposable database and a temporary LOGIN worker with random
test-only credentials, and uses real connections/roles. Existing local roles
are preserved; the suite refuses to rotate an existing worker login. It uses
the synthetic Migration 010 fixture, actual Migration 010 functions, reviewed
scoped claim/recovery/heartbeat functions, and Generation 008 issuer source.
It adds the real dependency columns and singleton allowlist before Migration 013.
This is a focused synthetic schema fixture, not a production-data restore or
complete repeat of every V3 schema/RLS migration test. Medicine/event helper
stubs remain fixture-only; no real OCR result is fabricated or persisted hosted.

Tests cover wrong IDs, owner/admission mismatch, missing/historical admissions,
disabled policy, exhausted attempts, live lease/scope, expired permit/scope,
disabled scope, stale attempt/generation, wrong worker, insufficient lease time,
existing result, actual unauthorized roles and direct audit-table denial.
Every negative test compares administrator snapshots of all relevant job,
prescription, scope, admission, permit, review, evidence and result tables.

Real row-lock barriers synchronize both authorization and recovery races.
pg_stat_activity confirms both sessions are blocked before release; no arbitrary
sleep is used. Exactly one succeeds. Another barrier verifies the legacy
initializer waiting across authorization commit is rejected. Old heartbeat and
completion tokens fail. Legacy issuer/recovery/claim cannot adopt the permitted
job. Unpermitted legacy first-attempt initialization/completion and normal
recovery/claim still work. An unrelated historical result and Generation 1
admission remain unchanged. Review-only completion creates no target result.

Guarded local rollback/reapply passes before any permit exists. Rollback after
authorization is rejected to preserve the audit record; migration reapplication
is rejected. Independent verification detects injected grant/search_path drift.

The focused backend suite also executes the existing real confirmed-review
Python Layers 4–5 subprocess. HTTP/unit tests use explicit test doubles; the SQL
acceptance result is synthetic. This phase did not run new OCR inference or any
hosted prescription processing.

The test database and created roles were removed. The pre-existing local
PostgreSQL server was left running. No test worker service was started.

Reproduction, from backend/:

```powershell
node scripts/prepare-exact-retry-migration.cjs
$env:MEDDECODE_EXACT_RETRY_PG17 = 'true'
npx tsx --test tests/exact-job-recovery.pg17.test.ts
```

The generator only reads reviewed local SQL and emits artifacts. The three
*.template.sql files are generator inputs, never deployment commands. The exact
four numbered outputs must be independently reviewed and hash-checked.

`npm run typecheck` still reports the same six existing tools/test errors:
confirmed-review-intelligence.client.test.ts:14 and :15 (TS1470/import.meta),
prescription-review-initial-completion.pg17.test.ts:24 (TS2769/readonly pg args),
reminders-migration-and-persistence.test.ts:14 and reminders.test.ts:8
(TS2307/imports), reminders.test.ts:104 (TS2379/Express mock). No new errors remain.

## Changed files in this phase

- backend/src/repositories/postgres-worker-rpc.transport.ts
- backend/src/services/processing-worker.runtime.ts
- backend/src/services/processing-worker.composition.ts
- backend/src/worker.ts
- backend/tests/postgres-worker-rpc.transport.test.ts
- backend/tests/worker-startup.test.ts
- backend/tests/processing-worker.runtime.test.ts
- backend/tests/exact-job-recovery.pg17.test.ts
- scripts/dev-launcher.test.cjs
- backend/scripts/prepare-exact-retry-migration.cjs
- Migration 013: four numbered SQL files and three generator templates
- backend/docs/exact-job-recovery-readiness.md

Earlier shared-tree changes, including the prior JSONB fixes, were preserved.
Historical hash manifests describe their earlier snapshot; changed files now
need this phase's review. No prior migration was modified.

## Separate hosted approvals required — NOT EXECUTED

**A. Deploy schema only.** Explicitly approve Migration 013 `002_up.sql` at
SHA-256 `0E220202A308B79C488A68A82DD329257960920506B3CB6CE1891629B4B43357`
against project `wyripeqruhvbksjfsvlr`, database postgres. Before deployment,
reconfirm TLS verify-full and postgres identity, fresh restore-tested recovery
point and limitations, exact hashes, source/role compatibility, queue/result
aggregates and no competing worker. Run exact 001_preflight, deploy 002_up
atomically, then 003_verify. Confirm the permit table is empty and all existing
job/result/admission/policy state unchanged. This does not authorize issuance,
scope refresh or worker startup. No hosted compatibility claim is made yet.

**B. Authorize this exact second attempt and fresh scope.** After A verifies,
separately approve this single administrative function call inside a bounded
transaction (2s lock / 10s statement timeout):

```sql
SELECT * FROM public.meddecode_authorize_exact_job_retry_v1(
 '51c6cffd-ac79-4eaa-bc6d-851f20c2abab'::uuid,
 '2bb56f2d-df83-4132-95a4-b9552fa48dd8'::uuid,
 1, 1::bigint
);
```

Expected change: exactly one audit permit and exactly one scope refresh for the
same dedicated identity; zero job/admission/policy/result changes. The returned
permit and expiry must be recorded. Any changed precondition must stop the call.
This is the only reviewed scope-renewal path for this retry. Never replace it
with ad-hoc job updates or the batch recovery RPC.

**C. Execute once.** Separately approve credential loading, coordinated local
V3 flags and exactly one reviewed-launcher worker execution. Reconfirm no
competing processes/sessions, scope/permit expiry and target state immediately
before startup. Future commands, **not run in this phase**:

```powershell
Set-Location C:\Users\dahiy\MedDecode-integration
& .\backend\scripts\automatic-worker-credentials.ps1 -Action Verify
& .\backend\scripts\automatic-worker-credentials.ps1 -Action LoadDevelopment
$env:MEDDECODE_PRESCRIPTION_REVIEW_V3_ENABLED = 'true'
$env:VITE_PRESCRIPTION_REVIEW_ENABLED = 'true'
$env:WORKER_EXACT_RETRY_PERMIT_ID = '<UUID returned by approved authorization>'
$env:WORKER_EXACT_RETRY_JOB_ID = '51c6cffd-ac79-4eaa-bc6d-851f20c2abab'
$env:WORKER_EXACT_RETRY_PRESCRIPTION_ID = '2bb56f2d-df83-4132-95a4-b9552fa48dd8'
$env:WORKER_EXACT_RETRY_EXPECTED_GENERATION = '1'
npm --prefix backend run build
npm run dev
```

LoadDevelopment retains scoped RPCs, the dedicated login, single-execution and
concurrency one. No automatic issuer or recovery runs in exact mode. The process
claims only this permit-bound job and stops after its attempt; frontend/backend/
Python remain available for manual review. Stop for manual confirmation once the
draft is accessible. Layers 4–5 require a later separately authorized workflow.
Keep TrOCR/cloud OCR disabled and existing 2 GiB supervision intact.

No automatic retry after failure, connection ambiguity or lost claim response.
Ctrl+C stops the launcher/worker trees. Scope/permit expire within ten minutes;
do not renew them automatically. Emergency hosted scope revocation requires its
own explicit approval. Do not change Generation 2 to force recovery.

## Recovery and rollback limitations

Require a fresh restore-tested application-database recovery point before hosted
deployment. Such a backup is not full Supabase/Auth/global-role/ACL/S3/platform
disaster recovery. No new backup was created or inspected in this local phase.

004_rollback_review.sql is disabled unless a separate administrative review flag
is explicitly set, and refuses rollback whenever any audit permit exists. It
does not delete authorized/consumed permit history or reminder/application data.
Before issuance, it restores the exact reviewed prior four function bodies and
removes only the new unused objects. After issuance, retain the guards and audit
record; use a reviewed forward correction instead of destructive rollback.
Audit foreign keys restrict deletion of associated records. Expired/failed
permits intentionally cannot be rearmed; a third attempt is outside this design.

## Four final SQL SHA-256 values

| File | SHA-256 |
| --- | --- |
| 001_preflight.sql | 6525CCB08DD50D0BFEF067340377260470B94A65907D8C7AA1D05501027BB975 |
| 002_up.sql | 0E220202A308B79C488A68A82DD329257960920506B3CB6CE1891629B4B43357 |
| 003_verify.sql | ACDD030B6DFF22911EF4CFF199DA9D8EBF691386ED1452E62E6725860DF4FA52 |
| 004_rollback_review.sql | 7257A167E0F65EE68FA5D356BE617ACAA33279DE49C01CDC7874BCFBE1AAEBA1 |

LOCAL_EXACT_JOB_RECOVERY: VERIFIED
READY_FOR_INDEPENDENT_MIGRATION_REVIEW: YES
READY_FOR_HOSTED_RETRY_EXECUTION: NO
