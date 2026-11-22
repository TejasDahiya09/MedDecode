# RC-5 PostgreSQL Default-Privilege Security Audit

Date: 2026-11-19
Status: `PARTIAL` — read-only audit and local proposal verification complete;
hosted remediation requires a separately reviewed migration and Supabase role
compatibility decision.

## Scope and connection gates

The audit used the existing `meddecode_hosted_admin` libpq service against
project `wyripeqruhvbksjfsvlr`. The service profile specifies the project-
qualified PostgreSQL user, database `postgres`, port 5432, the reviewed CA, and
`sslmode=verify-full`; the CA file exists and no password is stored in the
service file.

The catalog session independently returned:

- database `postgres`;
- `session_user = current_user = postgres`;
- PostgreSQL 17.11;
- `transaction_read_only = on`.

The Supabase session pooler terminates client TLS, so `pg_stat_ssl` describes the
pooler-to-database hop and returned false. Client certificate/hostname
verification is instead established by the CA-backed libpq profile. Every
catalog query ran in `BEGIN READ ONLY` with bounded statement/lock timeouts and
ended in `ROLLBACK`. No worker or migration ran.

## Hosted default-ACL findings

Two roles have schema-specific default ACLs in `public` and can create there:

| Creator | Login | `public` CREATE | Finding |
| --- | --- | --- | --- |
| `postgres` | yes | yes | Creates MedDecode application objects and is directly actionable. |
| `supabase_admin` | yes | yes | Supabase-managed creator; `postgres` cannot `SET ROLE` or inherit it. Platform compatibility must be established before changing it. |

For objects created by `postgres` in `public`, the recorded defaults are:

| Object | `anon` | `authenticated` | `service_role` | Risk |
| --- | --- | --- | --- | --- |
| Tables | SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN | same | same | Critical fail-open default for future tables. |
| Sequences | SELECT, UPDATE, USAGE | same | same | Future identity/sequence access is automatic. |
| Functions | EXECUTE | EXECUTE | EXECUTE | Future functions are callable without per-function review. |
| Types | no explicit row | no explicit row | no explicit row | PostgreSQL's built-in default gives `PUBLIC USAGE`. |

The `supabase_admin` defaults in `public` are equivalently broad for tables,
sequences, and functions. This is consistent with a common Supabase API-first
bootstrap pattern, but it is not least privilege for MedDecode and is unsafe as
an application security boundary. RLS cannot compensate for non-row operations
such as `TRUNCATE`, and function execution must be reviewed independently,
especially for `SECURITY DEFINER` functions.

The `public` schema grants `USAGE` to PUBLIC and the API/worker roles but grants
`CREATE` only through `pg_database_owner` and explicit creator authority. The
MedDecode worker roles cannot create objects. Worker logins use `NOINHERIT` and
only have reviewed membership in their restricted worker roles.

## Current objects versus future risk

The audit did not assume this was only hypothetical. It inspected effective
privileges without reading application rows.

### Current table exposure

Twenty-seven existing `public` tables owned by `postgres` still give `anon`
broad effective privileges including `TRUNCATE`, `REFERENCES`, `TRIGGER`, and
`MAINTAIN`; `authenticated` has the same excessive non-CRUD privileges. All 27
have RLS enabled, but RLS does not make these table-level privileges safe.

Affected object metadata includes the application identity/profile, Cabinet,
catalogue, prescription, result, analytics, notification, and audit tables:
`active_ingredients`, `ai_jobs`, `analytics_events`, `audit_logs`,
`family_members`, `health_profiles`, `manufacturers`, `medicine_aliases`,
`medicine_cabinet`, `medicine_contract_identifiers`,
`medicine_contraindications`, `medicine_ingredients`,
`medicine_interactions`, `medicine_precautions`, `medicine_prices`,
`medicine_side_effects`, `medicine_similarities`, `medicine_sources`,
`medicines`, `notifications`, `prescription_intelligence_results`,
`prescription_medicine_alternatives`, `prescription_medicines`,
`prescription_recommendations`, `prescription_warnings`, `prescriptions`, and
`users`.

This finding is a separate, higher-priority current-object remediation. A
blanket revoke is not proposed here because each application API/RLS dependency
must first be classified. At minimum, `TRUNCATE`, `REFERENCES`, `TRIGGER`, and
`MAINTAIN` should be removed from `anon` and `authenticated` after an exact ACL
and API compatibility migration is locally verified.

The two Reminder tables are not in this list: Migration 012 corrected them.

### Current function exposure

Four functions have direct `PUBLIC EXECUTE`: `handle_new_user()`,
`set_updated_at()`, `update_updated_at_column()`, and
`validate_cabinet_family_member()`. `handle_new_user()` is `SECURITY DEFINER`
with `search_path=public`; the other three are invoker functions. Trigger-only
execution constraints reduce some practical paths, but PUBLIC execution is
unnecessary exposure and requires a separate current-object review.

No current `public` sequences were present. Current type `PUBLIC USAGE` is the
PostgreSQL default and does not itself expose row data, but it demonstrates why
new types must be deliberately granted when a consuming API requires them.

## Proposed future-object hardening

The following is a reviewed proposal, not deployment authorization. It changes
only future-object defaults for the `postgres` creator. It intentionally leaves
existing object ACLs unchanged and retains the current `service_role` table,
sequence, and function defaults. New application objects must receive explicit
`anon`, `authenticated`, or worker grants in their own reviewed migration.

```sql
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';

-- Identity and exact-current-default assertions must precede these statements.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES
  FROM anon, authenticated, meddecode_scoped_worker, meddecode_worker;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES
  FROM anon, authenticated, meddecode_scoped_worker, meddecode_worker;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS
  FROM anon, authenticated, meddecode_scoped_worker, meddecode_worker;

-- PostgreSQL's built-in PUBLIC function/type defaults are global. A
-- schema-specific REVOKE cannot subtract them.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE USAGE ON TYPES
  FROM anon, authenticated, meddecode_scoped_worker, meddecode_worker;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE USAGE ON TYPES FROM PUBLIC;

-- Preserve administrative API behavior for a future explicitly used type.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE ON TYPES TO service_role;

COMMIT;
```

The two global revokes are necessary PostgreSQL semantics, not accidental scope
expansion: per-schema defaults are additive and cannot remove built-in global
`PUBLIC EXECUTE/USAGE`. They affect future functions/types created by
`postgres` in every schema. Before deployment, all migrations and Supabase
components that create functions or types as `postgres` outside `public` must be
inventoried. If that impact is unacceptable, the alternative is to retain the
global defaults and require every migration to revoke PUBLIC immediately after
creation; that is less fail-safe and does not close the default risk.

No change to `supabase_admin` defaults is proposed. The administrative session
cannot assume that role, and changing its defaults or removing its `public`
CREATE privilege may disrupt Supabase-managed behavior. Supabase support or
documented platform guidance is required before addressing that creator.

## Disposable PostgreSQL 17 verification

`backend/tests/rc5-default-privileges.pg17.test.ts` starts a task-owned private
PostgreSQL 17 cluster, reproduces the broad defaults, creates an existing RLS
table/function, applies the proposed `postgres` hardening, and creates future
table, identity sequence, function, and enum objects.

Verified assertions:

- existing table/function ACLs are byte-for-byte unchanged;
- existing RLS remains enabled;
- `anon`, `authenticated`, `meddecode_scoped_worker`, and `meddecode_worker`
  receive no tested privilege on any future object type;
- future `service_role` table, sequence, function, and type access remains;
- no forbidden named-role or PUBLIC entry remains in the applicable defaults;
- task-owned cluster cleanup succeeds.

Result: 1 test passed, 0 failed, 0 skipped. The test also caught and corrected a
proposal defect: schema-specific function/type revocation alone cannot remove
PostgreSQL's built-in PUBLIC defaults.

## Deployment and remaining uncertainty

Deployment is required to change future-object defaults, but no hosted mutation
is authorized by RC-5. A forward migration must include:

1. exact project/database/session/TLS gates;
2. read-only capture and equality assertions for all affected default ACLs;
3. a fresh restore-tested backup;
4. the atomic bounded statements above;
5. independent verification using newly created disposable objects only in a
   local clone—not by creating hosted probe objects;
6. an application migration policy requiring explicit ACL/RLS grants;
7. a separate current-object ACL remediation plan for the 27 tables and four
   functions;
8. a Supabase compatibility decision for `supabase_admin` defaults.

```text
RC_5_STATUS: PARTIAL
HOSTED_IDENTITY: PASS
DEFAULT_PRIVILEGE_FINDINGS: FAIL_OPEN_FOR_POSTGRES_AND_SUPABASE_ADMIN_CREATORS
CURRENT_OBJECT_EXPOSURE: 27_TABLES_AND_4_PUBLIC_FUNCTIONS_REQUIRE_SEPARATE_REMEDIATION
FUTURE_OBJECT_RISK: CONFIRMED
LOCAL_TESTS: PASS_1_FAILED_0_SKIPPED_0
PROPOSED_REMEDIATION: LOCALLY_VERIFIED_POSTGRES_DEFAULT_ACL_HARDENING
DEPLOYMENT_REQUIRED: YES_SEPARATE_APPROVAL
HOSTED_MUTATIONS: NONE
```
