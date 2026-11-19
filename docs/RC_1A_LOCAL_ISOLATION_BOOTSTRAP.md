# RC-1A Local Isolation Bootstrap

Date: 2026-11-19

Branch: `main`
Starting commit: `4039f8a1eabbd7260328ca37c4374e60f31616dc`

## Outcome

RC-1A is **PARTIAL**. The local catalogue, restricted catalogue reader, FastAPI readiness boundary, PostgreSQL test reliability diagnosis, and a disabled real-worker composition are verified. The remaining implementation boundary is the browser upload/job-admission adapter: the Phase 1F browser server still initializes its review from `PHASE1F_CONTRACT`, so the full browser workflow must not yet be executed or described as genuine.

No hosted database, storage, worker, or external catalogue endpoint was accessed. No prescription workflow was executed.

## Root causes and corrections

### Hosted catalogue dependency

The checked-in local intelligence environment is configured for a hosted, non-loopback catalogue. FastAPI also verifies a catalogue connection during lifespan initialization. Starting it with inherited environment values would therefore breach RC-1A isolation.

`prepare-prescription-review-phase1f.ps1` now installs an explicitly synthetic catalogue fixture in the task-owned Phase 1F PostgreSQL database and provisions `meddecode_catalogue_rc1a_reader`:

- login role is non-superuser, `NOINHERIT`, `NOCREATEDB`, `NOCREATEROLE`, `NOREPLICATION`, and `NOBYPASSRLS`;
- `default_transaction_read_only=on`;
- `CONNECT` to the disposable database;
- `USAGE` on `official_catalogue`;
- `SELECT` only on `official_catalogue.catalogue_entities`;
- no table INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, or TRIGGER privilege.

The verifier connects as that role, starts a read-only transaction, and confirms the four known synthetic formulation entities. An administrator-side ACL assertion independently verifies SELECT-only access.

### PostgreSQL test startup failures

The earlier three failures were caused by the Codex Windows sandbox, not the PostgreSQL helper or migration tests. Manual reproduction showed:

```text
pg_ctl: could not create restricted token: error code 87
pg_ctl: could not start server: error code 3
```

The same three suites passed unchanged when executed in the normal process environment. No timeout, port, migration, or cleanup weakening was applied.

### Browser harness contract injection

The Phase 1F server still reads a precomputed Contract v1 file and initializes a review before the browser opens. This remains the exact blocker documented by RC-1.

`rc1a-local-runtime.ts` prepares the production worker graph with:

- loopback PostgreSQL only;
- loopback HTTP FastAPI only;
- the local synthetic storage client;
- the real `HttpPythonIntelligenceClient` path;
- the real document reader and `RealPrescriptionProcessor`;
- the real initial-review/confirmed-review store interfaces;
- one controlled worker instance and one attempt;
- no runtime start during construction.

It rejects hosted hosts, HTTPS/non-loopback intelligence endpoints, path escape, hosted catalogue mode, catalogue passwords/passfiles/CA settings, an unexpected database/role, and an unexpected worker identity.

The upload/job-admission adapter is not yet implemented. Consequently, a browser upload cannot yet start this graph, and RC-1 remains blocked.

## Catalogue source and provenance

The protected `datasets` directory was inspected read-only. Its manifest records prepared official-source material from RxNorm and Indian regulatory sources, but RC-1A did **not** import those records because their complete licensing/release acceptance was not necessary for infrastructure readiness.

The disposable database uses the repository's existing fixture:

`backend/database/integration-migrations/202611130004_official_catalogue_read_rpc/test/10_synthetic_fixture.sql`

Its source key is `synthetic_test`, its authority is `Synthetic test fixture only`, source payloads carry `"synthetic": true`, and its names are explicitly synthetic. It must never be represented as official medicine data or used for clinical claims.

## Local service dependency map

```text
Browser (future RC-1, 127.0.0.1:5176)
  -> Express acceptance server (127.0.0.1:3011)
     -> local synthetic auth (random per-run secrets)
     -> local synthetic document storage under task-owned root
     -> PostgreSQL 17 (127.0.0.1:55440)
        -> review/job schemas and scoped worker roles
        -> official_catalogue synthetic fixture
        -> meddecode_catalogue_rc1a_reader (SELECT-only)
     -> controlled worker rc1a-local-worker-001
        -> local storage stream
        -> FastAPI (127.0.0.1:18000)
           -> supervised EasyOCR subprocess
           -> restricted local catalogue reader
```

Redis is not required by the reviewed Phase 1F acceptance graph; the durable PostgreSQL job/RPC path remains authoritative.

## FastAPI readiness evidence

FastAPI was started briefly with an ephemeral internal bearer token and explicit local-only catalogue variables. Hosted catalogue password, passfile, and CA variables were removed from the child environment. EasyOCR used the pre-existing local model directory.

Observed:

```text
RC1A_FASTAPI_READY:ready:health=alive
```

The process was stopped immediately and its temporary logs were removed. No OCR request was submitted.

## PostgreSQL evidence

Bootstrap markers:

```text
PHASE1F_DATABASE_READY:phase1f_admin|meddecode_phase1f_20261115|127.0.0.1|55440
RC1A_SYNTHETIC_CATALOGUE_READY:records=4:restricted_reader=verified
```

The cluster was stopped after verification.

The three previously failing suites were run together outside the restricted-token sandbox:

- 17 tests passed;
- 0 failed;
- PostgreSQL 17.11 confirmed;
- Reminder migration, RLS attacks, anonymous denial, uniqueness, persistence, rollback/reapply, and all 14 independent negative verifier cases passed;
- every task-owned cluster was stopped and removed by the existing helper.

## Other verification

- `rc1a-local-runtime.test.ts`: 2 passed, 0 failed.
- Backend TypeScript typecheck: passed.
- Backend production build: passed.
- FastAPI `/ready`: passed against the local restricted catalogue.
- FastAPI `/health`: passed.
- No listeners remained on ports 3011, 5176, 55440, 18000, or 8000 after cleanup.
- No hosted credentials were printed or added to Git.

## Files changed

- `backend/scripts/prepare-prescription-review-phase1f.ps1`
- `backend/scripts/rc1a-local-runtime.ts`
- `backend/tests/rc1a-local-runtime.test.ts`
- `docs/RC_1A_LOCAL_ISOLATION_BOOTSTRAP.md`

The protected datasets and `MedDecode-dev` were not modified.

## Remaining blocker

Implement and independently test a test-only owner-scoped upload repository and one-job admission adapter that connects `/api/v1/prescriptions/upload` to the disabled RC-1A worker graph. It must use the existing PostgreSQL RPC claim/fencing path and Migration 010 initial-review completion, then replace—not coexist with—the injected `PHASE1F_CONTRACT` initialization when RC-1 mode is selected.

Only after that adapter passes local contract/security tests should RC-1 run the browser workflow.

## Status

```text
RC_1A_STATUS: PARTIAL
CATALOGUE_SOURCE: Existing repository synthetic_test fixture; no protected dataset imported
CATALOGUE_BOOTSTRAP: PASS
FASTAPI_LOCAL_READINESS: PASS
AUTH_ISOLATION: PASS (configuration and existing harness contract; full browser not run)
STORAGE_ISOLATION: PASS (existing local store plus loopback/path guard)
WORKER_CONFIGURATION: PASS (disabled one-attempt real worker graph constructed without RPC calls)
BROWSER_TO_WORKER_COMPOSITION: PARTIAL (worker graph prepared; upload/admission adapter remains)
POSTGRESQL_TESTS: PASS (17/17 outside sandbox; sandbox restriction diagnosed)
EXTERNAL_CONNECTIONS: NONE
FILES_CHANGED: 4
REMAINING_BLOCKERS: owner-scoped upload-to-exact-job admission adapter and removal of injected OCR initialization in RC-1 mode
HOSTED_MUTATIONS: NONE
```
