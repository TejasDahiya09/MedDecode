# RC-5B Hosted Dependency and Default-ACL Review

Date: 2026-11-20
Status: `PARTIAL` — Migration 014 hosted compatibility is verified read-only;
the separately scoped `postgres` table/sequence default candidate is locally
verified, while function/type and `supabase_admin` defaults remain unresolved.

## Scope and safety evidence

The audit used project `wyripeqruhvbksjfsvlr` through the existing
`meddecode_hosted_admin` libpq service. The profile is project-qualified,
targets database `postgres`, uses the reviewed CA, and enforces
`sslmode=verify-full`; it contains no password. Hosted sessions reported
`session_user = current_user = postgres`, PostgreSQL 17.11, and
`transaction_read_only = on`. Queries used bounded statement, lock, and idle
transaction timeouts and ended in `ROLLBACK`.

The Supabase session pooler terminates client TLS, so `pg_stat_ssl=false`
describes the pooler-to-database hop rather than the CA-verified client hop.
No application rows, medical records, credentials, workers, grants, revokes,
migrations, or configuration were accessed or changed.

Repository `main` and `origin/main` were synchronized at
`dfcfbc35f418594cbde45da9b0f5e71172b81153` after a fresh fetch. Existing
untracked RC-5/RC-5A and unrelated reports were preserved.

## Migration 014 immutable candidate

| File | SHA-256 |
| --- | --- |
| `001_preflight.sql` | `C659FB9CF9D0DC693F8BFAC2DEB9E7D5C92885218B3403C26E5ED73FEFFB278F` |
| `002_up.sql` | `C76FE4862A4C602AF8C92DD24DA5C2B3DE41C1F34F566BF50573D5C1F9C72E03` |
| `003_verify.sql` | `E78D54D74718613AEF22A83025B029BAD7EF578E5F687604197CBD04A1D04303` |
| `004_rollback_review.sql` | `37E219EE373B0FB2F66CFABABFCE448C084646194549C85D9AE83AE50EDA2376` |

The exact hosted `001_preflight.sql` returned
`CURRENT_OBJECT_PRIVILEGE_HARDENING_PREFLIGHT_OK` and rolled back. This proves
Migration 014 has not already been applied: all reviewed excessive privileges
remain and satisfy the candidate's before-state guard.

Static and local SQL verification confirms Migration 014 changes only ACLs on
the named objects. It does not contain DML, policy changes, ownership changes,
function-body changes, default-ACL statements, or `supabase_admin` changes.

## Hosted function definitions and dependencies

All four functions are `public`, owned by `postgres`, accept no arguments,
return `trigger`, are volatile/non-strict PL/pgSQL functions, and grant EXECUTE
directly to PUBLIC, `anon`, `authenticated`, `postgres`, and `service_role`.
No worker role has a direct grant.

| Function | Security/search path | Exact enabled hosted trigger attachments | Direct-call assessment |
| --- | --- | --- | --- |
| `handle_new_user()` | SECURITY DEFINER; fixed `search_path=public` | `auth.users.on_auth_user_created`, AFTER INSERT | Creates/updates `public.users`. Trigger-returning functions cannot run as ordinary SQL RPC calls. No application direct-call reference was found. |
| `set_updated_at()` | SECURITY INVOKER; default path | BEFORE UPDATE on `public.users`, `health_profiles`, `family_members`, `prescriptions`, `prescription_medicines`, and `medicine_cabinet` | Trigger-only dependency; no direct-call reference found. |
| `update_updated_at_column()` | SECURITY INVOKER; default path | `public.medicines.medicines_updated_at_trigger`, BEFORE UPDATE | The previously unknown dependency is now resolved to this single enabled trigger. No direct-call reference found. |
| `validate_cabinet_family_member()` | SECURITY INVOKER; default path | `public.medicine_cabinet.medicine_cabinet_validate_family_member`, BEFORE INSERT OR UPDATE | Enforces same-owner family-member linkage; no direct-call reference found. |

`pg_depend` returned exactly these nine normal trigger dependencies and no
additional dependent object. The functions could be visible to an API schema
cache because they are in `public` and executable, but their trigger return type
prevents successful ordinary invocation. PUBLIC EXECUTE therefore does not by
itself prove a remotely exploitable RPC. Revocation is still appropriate
defense in depth, particularly for the SECURITY DEFINER function.

PostgreSQL checks function privilege when a trigger is created, not on every
row event. Removing caller EXECUTE does not disable an existing trigger. The
disposable PostgreSQL test independently demonstrates all four trigger paths
continue after revocation, including the auth-style SECURITY DEFINER path,
both timestamp helpers, and Cabinet validation.

## Migration 014 hosted drift report

The exact preflight and independent catalogs agree:

- all 27 expected `public` tables exist as ordinary tables;
- all are owned by `postgres`, have RLS enabled, and do not force RLS;
- 26 tables retain the reviewed full API-role ACL and `ai_jobs` retains its
  reviewed asymmetric CRUD matrix;
- all 27 still grant `TRUNCATE`, `REFERENCES`, `TRIGGER`, and `MAINTAIN` to
  `anon` and `authenticated`;
- PUBLIC has no table ACL and MedDecode worker roles have no table access;
- `service_role` retains the full reviewed matrix;
- all four function signatures, owners, return types, security modes, and ACLs
  match the candidate;
- all nine trigger dependencies are enabled and non-internal;
- no renamed, missing, or additional affected dependency invalidates the
  candidate.

Result: `PASS`. Migration 014 is catalog-compatible and ready for a fresh
restore-tested backup plus separate hash-specific deployment authorization. It
must not be deployed from this review.

## Current versus future privilege analysis

Migration 014 addresses existing objects only. It deliberately leaves future
defaults unchanged. Hosted defaults for role `postgres` in `public` currently
grant:

- future tables: all eight privileges to `anon`, `authenticated`, `postgres`,
  and `service_role`;
- future sequences: SELECT, UPDATE, and USAGE to the same four roles;
- future functions: EXECUTE to the same four roles;
- future types: PostgreSQL's built-in PUBLIC USAGE (no explicit default row).

`postgres` can create in `public`, `extensions`, and `official_catalogue` and
owns objects in all three. Consequently a global function/type default revoke
would affect more than the MedDecode API schema.

## Separate postgres default-ACL candidate

Migration candidate:
`202611200015_postgres_public_default_privilege_hardening_v1`.

| File | SHA-256 |
| --- | --- |
| `001_preflight.sql` | `DC77263B95316735FFFD1DFDB67510AEDA8475943EA2C8AC68FF4A121D7AF3E7` |
| `002_up.sql` | `DB4B278A87A77409D640AF3BF4B9972BF6EC6E190C6DAF51E5E865993CCF5379` |
| `003_verify.sql` | `6F23DDAE4DED16B689EC83B328B1D9A82EA4492306E37C27691BB2FAE5024DC3` |
| `004_rollback_review.sql` | `7731BAC440051D6CEACF8ED27BC87632257DFC9D8418DB76269EBDBFB866D74F` |

It changes only defaults for future tables and sequences created by `postgres`
in `public`:

- removes automatic access from `anon`, `authenticated`, and both worker roles;
- preserves `postgres` and `service_role` defaults;
- requires future API migrations to grant access explicitly;
- does not touch current objects, functions, types, other schemas, RLS,
  ownership, data, RPCs, or `supabase_admin`.

This is the narrowest fully schema-scoped correction PostgreSQL supports.
Function/type default hardening is excluded: schema-specific default ACLs are
additive and cannot subtract PostgreSQL's built-in global PUBLIC EXECUTE/USAGE.
A global revoke for `postgres` would also affect future objects in
`extensions` and `official_catalogue` and needs separate dependency analysis.

The exact hosted Migration 015 `001_preflight.sql` returned
`POSTGRES_PUBLIC_DEFAULT_PRIVILEGE_PREFLIGHT_OK` and rolled back. It was not
deployed.

## supabase_admin compatibility

`supabase_admin` has broad, schema-specific managed defaults in `public`,
`graphql`, `graphql_public`, `realtime`, and `extensions`. It can create in
platform schemas including `auth`, `storage`, `realtime`, `vault`, GraphQL,
catalog schemas, and `public`; it owns thousands of catalog/platform objects.
The administrative `postgres` session cannot inherit or `SET ROLE` to
`supabase_admin`.

No `supabase_admin` change is safe to propose from repository evidence alone.
Changing its defaults or CREATE privileges could break managed migrations,
Auth, Storage, Realtime, GraphQL, Vault, or extension maintenance. Supabase
platform documentation/support and a platform-owned test environment are
required. Migration 015 therefore leaves every `supabase_admin` ACL unchanged.

## Local PostgreSQL 17 evidence

The RC-5, RC-5A, and RC-5B tests use task-owned PostgreSQL 17 clusters and real
roles/connections.

RC-5B verifies that Migration 015:

1. passes exact preflight, atomic deployment, and independent verification;
2. leaves an existing RLS table's ACL and RLS state unchanged;
3. denies all tested future `public` table/sequence access to `anon`,
   `authenticated`, and worker roles;
4. preserves `service_role` table/sequence defaults;
5. leaves future function and type behavior unchanged and explicitly visible as
   remaining risk;
6. leaves another schema's `postgres` defaults unchanged;
7. leaves `supabase_admin` defaults and resulting objects unchanged;
8. rejects reapplication after the before-state no longer matches;
9. stops and removes its disposable cluster.

Focused application compatibility remains covered by RC-5A: owner CRUD, RLS
cross-owner denial, trigger execution, worker isolation, and privileged service
maintenance passed. The combined RC-5/RC-5A/RC-5B PostgreSQL suite passed 3
tests with 0 failures and 0 skips. Backend typecheck passed.

## Approval boundaries and remaining risks

Migration 014 and Migration 015 require separate backup, preflight, hash, and
execution approvals. Approval of one must not imply approval of the other.

Remaining risks:

- existing excessive ACLs remain until Migration 014 is separately deployed;
- future table/sequence defaults remain broad until Migration 015 is separately
  deployed;
- future function/type PUBLIC behavior remains unresolved;
- `supabase_admin` defaults remain platform-managed and broad;
- retained legacy CRUD grants still require a separate minimization review.

```text
RC_5B_STATUS: PARTIAL
MIGRATION_014_HASHES: MATCH
HOSTED_TRIGGER_DEPENDENCIES: VERIFIED_9_ENABLED_TRIGGER_ATTACHMENTS
HOSTED_DRIFT_PREFLIGHT: PASS
POSTGRES_DEFAULT_ACL: PARTIAL_SCHEMA_SCOPED_TABLE_SEQUENCE_CANDIDATE_PREPARED
SUPABASE_ADMIN_DEFAULT_ACL: UNCHANGED_PLATFORM_COMPATIBILITY_UNVERIFIED
MIGRATION_014_DEPLOYMENT_READINESS: READY_FOR_BACKUP_AND_SEPARATE_APPROVAL
HOSTED_MUTATIONS: NONE
```
