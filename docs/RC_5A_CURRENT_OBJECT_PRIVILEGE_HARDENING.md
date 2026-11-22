# RC-5A Current Database Object Privilege Hardening

Date: 2026-11-20
Status: `PARTIAL` — candidate preparation and local PostgreSQL 17 verification
pass; one hosted trigger attachment and several legacy direct-CRUD dependencies
remain catalog/source uncertainties
Hosted deployment: not executed and not authorized

## Scope and evidence boundary

This review preserves the uncommitted RC-5 audit and its default-privilege
test. It uses RC-5's read-only hosted catalog evidence, the checked-in
application-schema reference, current integration migrations, and current
backend repositories. It does not read application rows or make a hosted
request.

All 27 tables are in `public`, owned by `postgres`, have RLS enabled but not
forced, and are application/team objects rather than Supabase-managed `auth`,
`storage`, or platform objects. The hosted ACL evidence showed direct broad
grants to `anon` and `authenticated`, no relevant PUBLIC table grant, no worker
table access, and full privileged `service_role` access. `authenticator` may
`SET ROLE` to API roles but does not convert those ACLs into safe privileges.

## Table inventory and API compatibility

The following catalog facts apply independently to every listed table: schema
`public`, owner `postgres`, RLS enabled and not forced, application/team-owned
rather than a Supabase-managed `auth` or `storage` object. `anon` and
`authenticated` have direct ACL entries; effective privileges match those
entries. PUBLIC has no table ACL, and the two worker roles have no direct or
effective table privilege. `service_role` has the full administrative matrix.
`authenticator` may explicitly `SET ROLE` to an API role; this is role switching,
not an additional hidden grant.

Except for `ai_jobs`, the current direct API-role ACL includes all CRUD plus
`TRUNCATE`, `REFERENCES`, `TRIGGER`, and `MAINTAIN`. On `ai_jobs`, `anon` has
SELECT/INSERT/DELETE plus the four administrative privileges and
`authenticated` has SELECT/DELETE plus those privileges. The candidate removes
only the four administrative privileges and preserves every current CRUD grant
and policy.

| Table | Required/preserved API behavior | Ownership scope | Reachability evidence |
| --- | --- | --- | --- |
| `active_ingredients` | Retain current CRUD; remove four admin privileges | Application catalogue | Catalogue service/RPC path; direct browser mutation not proven |
| `ai_jobs` | Preserve exact asymmetric matrix above; queue mutation remains protected by RPC/fencing | Application queue | Proven status/submission/worker path |
| `analytics_events` | Retain owner-policy SELECT/INSERT and current CRUD ACL | Application telemetry | Schema-defined; no current backend route found |
| `audit_logs` | Retain owner-policy SELECT and current CRUD ACL | Application audit | Schema-defined; no current backend route found |
| `family_members` | Retain owner CRUD | Application user data | Proven family-member repository/API |
| `health_profiles` | Retain owner CRUD | Application user data | Proven profile repository/API |
| `manufacturers` | Retain current CRUD; remove four admin privileges | Application catalogue | Catalogue service/RPC path; direct browser mutation not proven |
| `medicine_aliases` | Retain current CRUD; remove four admin privileges | Application catalogue | Catalogue service/RPC path; direct browser mutation not proven |
| `medicine_cabinet` | Retain owner CRUD and validation triggers | Application user data | Proven Cabinet repository/API |
| `medicine_contract_identifiers` | Retain authenticated SELECT and current CRUD ACL | Application identity mapping | Supported identity contract; no browser mutation proven |
| `medicine_contraindications` | Retain current CRUD; remove four admin privileges | Application catalogue | Catalogue/intelligence path; direct browser mutation not proven |
| `medicine_ingredients` | Retain current CRUD; remove four admin privileges | Application catalogue | Catalogue/intelligence path; direct browser mutation not proven |
| `medicine_interactions` | Retain current CRUD; remove four admin privileges | Application catalogue | Catalogue/intelligence path; direct browser mutation not proven |
| `medicine_precautions` | Retain current CRUD; remove four admin privileges | Application catalogue | Catalogue/intelligence path; direct browser mutation not proven |
| `medicine_prices` | Retain current CRUD; remove four admin privileges | Application catalogue | Catalogue pricing path; direct browser mutation not proven |
| `medicine_side_effects` | Retain current CRUD; remove four admin privileges | Application catalogue | Catalogue/intelligence path; direct browser mutation not proven |
| `medicine_similarities` | Retain current CRUD; remove four admin privileges | Application catalogue | Comparison path; direct browser mutation not proven |
| `medicine_sources` | Retain current CRUD; remove four admin privileges | Application catalogue provenance | Catalogue service/RPC path; direct browser mutation not proven |
| `medicines` | Retain current CRUD; remove four admin privileges | Application catalogue | Proven catalogue browsing/search RPC path |
| `notifications` | Retain owner-policy SELECT/UPDATE and current CRUD ACL | Application user data | Schema-defined; no current backend repository found |
| `prescription_intelligence_results` | Retain owner SELECT; writes remain fenced RPC/worker operations | Application prescription data | Proven results/history API |
| `prescription_medicine_alternatives` | Retain owner SELECT; generated writes remain protected | Application prescription data | Proven legacy/result projection contract |
| `prescription_medicines` | Retain owner CRUD and protected V3 writes | Application prescription data | Supported review/result workflow |
| `prescription_recommendations` | Retain owner SELECT; generated writes remain protected | Application prescription data | Proven result projection contract |
| `prescription_warnings` | Retain owner SELECT; generated writes remain protected | Application prescription data | Proven result projection contract |
| `prescriptions` | Retain owner CRUD | Application prescription data | Proven upload/history/status/preview repositories |
| `users` | Retain owner SELECT/INSERT/UPDATE and current CRUD ACL | Application profile linked to `auth.users` | Proven profile API and auth trigger |

The candidate intentionally does not claim that every retained legacy CRUD
grant is necessary. Removing the four non-row administrative privileges is
independently safe and urgent. CRUD minimization requires a separate exact
policy/API matrix and is not bundled into this migration.

## Function inventory

All four functions are `public`, owned by `postgres`, accept no arguments,
return `trigger`, and currently inherit direct PUBLIC execution.

| Function | Security | Search path | Dependency and reachability | Proposed change |
| --- | --- | --- | --- | --- |
| `handle_new_user()` | SECURITY DEFINER | fixed `public` | `auth.users` AFTER INSERT trigger creates/updates `public.users`. Trigger functions cannot be called as ordinary SQL functions, but PUBLIC execution plus table TRIGGER rights unnecessarily enlarges attack surface. | Revoke EXECUTE from PUBLIC, anon, authenticated and both worker roles. Preserve owner execution and trigger. |
| `set_updated_at()` | SECURITY INVOKER | default | BEFORE UPDATE triggers on users, health profiles, family members, prescriptions, prescription medicines and Cabinet in the reviewed schema. | Same revoke; trigger invocation remains functional. |
| `validate_cabinet_family_member()` | SECURITY INVOKER | default | Cabinet BEFORE INSERT/UPDATE trigger enforces same-owner family-member linkage. | Same revoke; validation trigger remains functional. |
| `update_updated_at_column()` | SECURITY INVOKER | default | Legacy trigger helper; its defining migration/dependency is not present in the current checked-in application-schema reference. Hosted evidence proves it is trigger-only, but exact trigger attachment remains an inventory uncertainty. | Same revoke; no body/owner change. Deployment preflight requires exact signature and properties. |

PUBLIC execution alone does not make these trigger functions directly callable:
PostgreSQL rejects ordinary invocation of a trigger-returning function. The
revocation is still justified as defense in depth, particularly because
`handle_new_user()` is SECURITY DEFINER and untrusted table-level TRIGGER rights
are being removed in the same atomic migration.

## Candidate migration

Directory:
`backend/database/integration-migrations/202611190014_current_object_privilege_hardening_v1/`

- `001_preflight.sql`: read-only identity, PostgreSQL-version, role, object,
  ownership, RLS, current excessive-ACL, and function-property assertions.
- `002_up.sql`: atomic, bounded, explicitly qualified object-specific revokes.
- `003_verify.sql`: read-only verification of removed privileges, preserved
  CRUD matrix, RLS/ownership, and denied direct function execution.
- `004_rollback_review.sql`: read-only forward-fix policy; it never regrants the
  vulnerability.

The migration excludes default ACLs, `supabase_admin`, table data, constraints,
policies, function bodies, `service_role`, and worker RPC grants. Reapplication
is safely rejected because the exact excessive-state precondition no longer
holds.

Final candidate hashes after the fail-closed drift-guard corrections:

| File | SHA-256 |
| --- | --- |
| `001_preflight.sql` | `C659FB9CF9D0DC693F8BFAC2DEB9E7D5C92885218B3403C26E5ED73FEFFB278F` |
| `002_up.sql` | `C76FE4862A4C602AF8C92DD24DA5C2B3DE41C1F34F566BF50573D5C1F9C72E03` |
| `003_verify.sql` | `E78D54D74718613AEF22A83025B029BAD7EF578E5F687604197CBD04A1D04303` |
| `004_rollback_review.sql` | `37E219EE373B0FB2F66CFABABFCE448C084646194549C85D9AE83AE50EDA2376` |

## Local PostgreSQL 17 verification

`backend/tests/rc5a-current-object-privileges.pg17.test.ts` creates a private
task-owned PostgreSQL 17 cluster with actual `anon`, `authenticated`,
`service_role`, and worker roles; all 27 named tables; broad hosted-like grants;
RLS owner policies; the four trigger functions; and representative triggers.

Verified:

1. Migration preflight, atomic up, and independent verification pass.
2. Owner-scoped authenticated INSERT/SELECT/UPDATE/DELETE continue to work.
3. Cross-owner insert is rejected and update affects zero rows.
4. Anonymous SELECT sees zero owner rows and INSERT is rejected by RLS.
5. Untrusted TRUNCATE is rejected.
6. REFERENCES, TRIGGER, and MAINTAIN are absent from API/worker roles.
7. Both updated-at helpers, Cabinet validation, and the SECURITY DEFINER trigger
   path still fire after function EXECUTE revocation.
8. Direct trigger-function execution is denied after revocation.
9. `service_role` retains and actually exercises privileged maintenance access.
10. RLS policy count and enablement remain unchanged.
11. A second migration execution is rejected by the state guard.
12. The disposable cluster is stopped and task-owned files are removed.

Result: 1 test passed, 0 failed, 0 skipped.

The preserved RC-5 future-default test and RC-5A current-object test also pass
together: 2 passed, 0 failed, 0 skipped.

Focused backend repository, API, catalogue, transport, and worker regressions:
137 passed, 0 failed, 0 skipped. Backend TypeScript typecheck and repository
`git diff --check` also passed.

The deployment guard now also rejects preexisting CRUD, worker, service-role,
function-owner, return-type, SECURITY DEFINER, and search-path drift before any
revoke can commit.

## Deployment preconditions and remaining uncertainty

Hosted deployment requires separate hash-specific authorization. Before any
execution:

1. Reconfirm project `wyripeqruhvbksjfsvlr`, database/session `postgres`, and
   CA-backed `sslmode=verify-full`.
2. Recalculate all four SQL hashes.
3. Create and restore-test a fresh backup.
4. Run the exact preflight and require
   `CURRENT_OBJECT_PRIVILEGE_HARDENING_PREFLIGHT_OK`.
5. Confirm the 27-table and four-function catalog state has not drifted.
6. Execute `002_up.sql` once and immediately require
   `CURRENT_OBJECT_PRIVILEGE_HARDENING_VERIFY_OK` from `003_verify.sql`.
7. Do not run rollback automatically; use a new forward migration for any
   proven missing CRUD/RPC permission.

Remaining uncertainties are the exact hosted trigger attachment of
`update_updated_at_column()`, whether every retained legacy CRUD grant remains
necessary, and the separate default-ACL/`supabase_admin` work from RC-5. None
justifies retaining the four non-CRUD table privileges or PUBLIC trigger-
function execution.

```text
RC_5A_STATUS: PARTIAL
TABLES_REVIEWED: 27_OF_27
FUNCTIONS_REVIEWED: 4_OF_4
CURRENT_OBJECT_RISK: CONFIRMED_HIGH
PROPOSED_REVOKES: NON_CRUD_TABLE_ADMIN_PRIVILEGES_AND_DIRECT_TRIGGER_FUNCTION_EXECUTE
LOCAL_POSTGRESQL_TESTS: PASS_1_FAILED_0_SKIPPED_0
APPLICATION_COMPATIBILITY: PASS_LOCALLY
MIGRATION_CANDIDATE: 202611190014_current_object_privilege_hardening_v1
HOSTED_DEPLOYMENT: NOT_AUTHORIZED_NOT_EXECUTED
HOSTED_MUTATIONS: NONE
```
