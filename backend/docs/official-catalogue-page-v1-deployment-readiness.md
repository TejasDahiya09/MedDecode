# Official catalogue pagination v1 - deployment readiness

Date: 2026-11-16

## Scope and boundary

This review covers only `202611160007_official_catalogue_page_v1`. No hosted SQL was executed. No hosted records, grants, jobs, worker configuration, or V3 feature flags were changed.

The candidate pagination RPC is additive. It exposes a bounded, authenticated, source-aware read path over the established official catalogue model; it neither mutates catalogue data nor changes existing search or detail RPCs.

## Candidate integrity

Fresh SHA-256 checks:

| File | SHA-256 |
| --- | --- |
| `001_preflight.sql` | `dd5a5d16f86e0a8f1406854140faaf374c4717aaa1c1af74c61eec12528ed9ef` |
| `002_up.sql` | `59533fa1211150d0589058bbc1d2260f26bf3074196ffbc894388b88cf5dbedd` |
| `003_verify.sql` | `52b0bc8d7efdc6ff94502be6d465a3ade5b8b6435d9c54b1f1c35b60054f55c0` |
| `004_rollback_review.sql` | `6e4512cdef88ce243e424610741e1df409c035134924c0750b3769e54fa2f909` |

The deployment-file hash exactly matches the reported candidate hash.

## Genuine isolated PostgreSQL 17 verification

The exact `002_up.sql` was applied to a disposable, loopback-only PostgreSQL 17 database seeded with the compatible official-catalogue source-aware schema, restricted catalogue-RPC role, request-identity wrapper, and synthetic official records. The historical upstream bootstrap was not reused because its deployment-identity membership guard intentionally depends on hosted role semantics; the test fixture retained the candidate's actual required least-privilege grants and ownership shape.

The following exact candidate scripts passed:

1. `002_up.sql` atomic deployment with bounded lock and statement timeouts.
2. `003_verify.sql` independent ownership, fixed-search-path, `SECURITY DEFINER`, ACL, and sensitive-column checks.
3. `test/20_behavior.sql`: source-aware IDs, deterministic two-page ordering, total count, form filtering, safe search filters, malformed-input rejection, and no payload/price/source-URL leakage.
4. `test/30_unauthorized.sql`: anonymous RPC and direct catalogue-table denial.
5. `004_rollback_review.sql`, followed by clean reapplication of `002_up.sql`, `003_verify.sql`, and both functional/security test scripts.

The disposable database and temporary `meddecode_catalogue_rpc_owner` role were removed. The private loopback test cluster on port 55440 was then stopped.

## Hosted read-only preflight

Against the authorized hosted admin service for Supabase project `wyripeqruhvbksjfsvlr`, the exact committed `001_preflight.sql` completed successfully:

```text
BEGIN
DO
COMMIT
```

This confirms the preflight's required existing restricted role, catalogue grants, identity wrapper, absence of direct `anon`/`authenticated` catalogue access, absence of conflicting target RPC, and expected current deployment identity. It did not create or change any database object.

## Final deployment gate (2026-11-16)

- Client connection identity: database `postgres`; `session_user=postgres`; `current_user=postgres`; PostgreSQL 17.11.
- Project routing: the verified `meddecode_hosted_admin` service connected as `postgres.wyripeqruhvbksjfsvlr` through `aws-0-ap-southeast-1.pooler.supabase.com:5432`, which is the configured pooler for project `wyripeqruhvbksjfsvlr`.
- Client TLS: `psql \\conninfo` reported TLS 1.3 using `TLS_AES_256_GCM_SHA384`. The pooler's backend-session row in `pg_stat_ssl` reported false, so it is not used as evidence against the independently client-verified TLS connection.
- The target RPC remains absent and `meddecode_catalogue_rpc_owner` remains present.
- The exact `001_preflight.sql` was rerun successfully (`BEGIN`, `DO`, `COMMIT`), checking the required official-catalogue schema shape, column privileges, role attributes, RLS state, and direct-client ACL denial.
- The restore-tested recovery archive remains available at the documented protected local location and freshly hashes to `7c85af60394d19365282d7c3bf480d59e00e069b96f33f09c204bcc688c43c98` (918,341 bytes). It is a PostgreSQL 17.11 `public,auth` schema/data recovery point. Its explicitly accepted limitations remain: global roles/memberships, original ownership/ACL replay, Supabase platform configuration, S3 objects, and external Auth/storage/edge configuration are not recovered.
- This archive predates the subsequently deployed Migration 003. It is therefore **not** a full current-state recovery point for a whole-database restore. For this narrowly additive migration, the separately reviewed `004_rollback_review.sql` is the appropriate rollback mechanism and passed genuine local rollback/reapplication testing. A new post-Migration-003 backup would be required before treating restore as a current full-database recovery option.

## Fresh post-Migration-003 recovery point

On 2026-11-15 at `20:09:08Z`, a new custom-format PostgreSQL archive was created outside the repository:

```text
C:\Users\dahiy\MedDecode-Backups\official-catalogue-preflight-20261115T200849Z\meddecode-public-auth-current.dump
size: 934,307 bytes
SHA-256: 878a999c794df405f5ccb5671732754568be2550c13aa434ffce3c61957b56e1
schemas: public, auth
```

The archive inventory contains 63 table-data entries, 99 functions, 39 explicit policies (the broader inventory text match is 44), and 130 ACL entries. It was restored successfully into a new isolated PostgreSQL 17 UTF-8/template0 database with `--no-owner --no-privileges`. Source and restored aggregate counts matched: 5 prescriptions, 6 jobs, 2 intelligence results, and zero V3 review rows. Representative Migration 001, 002, and 003 APIs were present after restore; 36 restored public tables retained RLS and 39 public policies were present.

The initial restore attempt used an old local database with `WIN1252` encoding and failed only on valid UTF-8 medicine text. That disposable database was retained during diagnosis, then both disposable restore databases were removed after the UTF-8 restore passed; the private test cluster was stopped. The backup archive remains retained in its ACL-restricted directory with no automatic deletion configured.

The recovery scope remains intentionally limited: global roles/memberships, original object ownership and executable ACL replay, Supabase platform configuration, S3 objects, external Auth configuration, storage, and edge functions are not recovered by this archive.

After backup verification, the exact hosted catalogue `001_preflight.sql` passed again (`BEGIN`, `DO`, `COMMIT`) and the candidate migration hash was reconfirmed unchanged.

## Compatibility and security findings

- Existing source attribution is retained in the JSON response (`source_system` and source-aware formulation IDs).
- Existing search remains unchanged; this is a new bounded page RPC with stable `COLLATE "C"` name/identifier ordering, `limit <= 100`, and `offset <= 10000`.
- It exposes no price, raw source URL, original payload, or identity hash.
- The function is owned by `meddecode_catalogue_rpc_owner`, uses `SECURITY DEFINER` with `search_path = ''`, requires the established authenticated request-identity wrapper, and grants `EXECUTE` only to `authenticated`.
- `anon`, `PUBLIC`, and direct client table access remain denied. The RPC owner retains no direct access to `source_records.original_payload` or `catalogue_entities.identity_hash`.

## Application regressions

- Focused backend medicine-catalogue and Reminders tests: **23 passed, 0 failed**.
- Focused frontend medicine-insights and Reminders tests: **45 passed, 0 failed**.
- Full frontend unit suite: **347 passed, 0 failed**; frontend production build/typecheck passed. The earlier Medicine Library pagination expectation failure did not reproduce in the current tree.
- Backend production TypeScript build passed.
- Full backend suite has one unrelated failure in `tests/reminders-pg17-disposable-integration.test.ts`. The test expects the reminders migration's `USING (...) WITH CHECK (...)` clauses to be on one line, while the reviewed SQL formats them on separate lines. This is a test/formatting conflict, not a catalogue pagination regression. No Reminders file was altered in this scope.

## Required separate approval

Approval is required before executing exactly:

```text
backend/database/integration-migrations/202611160007_official_catalogue_page_v1/002_up.sql
SHA-256: 59533fa1211150d0589058bbc1d2260f26bf3074196ffbc894388b88cf5dbedd
```

That approval should cover one atomic execution and immediate execution of `003_verify.sql`. It should not authorize unrelated migrations, catalogue writes, role changes, worker changes, or feature-flag activation. Rollback is a separately reviewed operation through `004_rollback_review.sql`; it has been locally verified but must not be automatic on hosted Supabase.

## Status

```text
CATALOGUE_PAGE_MIGRATION_HASH: VERIFIED
CATALOGUE_PAGE_LOCAL_FUNCTIONAL_TESTS: PASS
CATALOGUE_PAGE_LOCAL_SECURITY_TESTS: PASS
CATALOGUE_PAGE_LOCAL_ROLLBACK_REAPPLY: PASS
CATALOGUE_PAGE_HOSTED_PREFLIGHT: PASS
HOSTED_SQL_EXECUTED: NO
READY_FOR_CATALOGUE_PAGE_MIGRATION_APPROVAL: YES
```

## Hosted deployment record (2026-11-16)

The project owner explicitly approved only `002_up.sql` after the fresh recovery point had been created and restore-verified. Immediately before execution:

- Candidate SHA-256 matched `59533fa1211150d0589058bbc1d2260f26bf3074196ffbc894388b88cf5dbedd`.
- Fresh-backup SHA-256 matched `878a999c794df405f5ccb5671732754568be2550c13aa434ffce3c61957b56e1`.
- The `postgres` session connected over TLS 1.3 (`TLS_AES_256_GCM_SHA384`) through the expected project pooler.
- The target RPC was absent.
- The exact hosted preflight completed successfully.
- Before counts were 5 prescriptions, 6 jobs, and 2 intelligence results.

`002_up.sql` executed once and committed its own atomic transaction. Its output contained the reviewed temporary role grant/revoke, function creation, and restricted ACL operations only. No retry, rollback, feature-flag change, worker action, or unrelated SQL was performed.

The exact independent `003_verify.sql` then completed successfully (`BEGIN`, `DO`, `COMMIT`). The script has no success notice marker; successful completion means all of its ownership, `SECURITY DEFINER`, fixed-empty-search-path, wrapper, RLS-baseline, direct-access-denial, and sensitive-column-denial assertions held.

Post-deployment read-only checks confirmed:

- `public.meddecode_official_catalogue_page_v1(text,text,integer,integer)` exists.
- Owner: `meddecode_catalogue_rpc_owner`.
- `SECURITY DEFINER`: true; `search_path=""`.
- `authenticated` has `EXECUTE`; `anon` and `PUBLIC` do not.
- Counts remain 5 prescriptions, 6 jobs, and 2 intelligence results.

```text
CATALOGUE_PAGE_MIGRATION_DEPLOYED: YES
CATALOGUE_PAGE_VERIFY_SQL: PASS
EXISTING_PRESCRIPTIONS_JOBS_RESULTS_UNCHANGED: YES
WORKERS_CHANGED: NO
V3_FLAGS_CHANGED: NO
ROLLBACK_EXECUTED: NO
```
