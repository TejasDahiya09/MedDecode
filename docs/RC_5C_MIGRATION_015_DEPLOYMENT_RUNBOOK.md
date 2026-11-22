# RC-5C Migration 015 deployment runbook

Status: blocked pending a fresh, current, independently restore-tested backup and separate hash-specific authorization. This runbook is not execution approval.

## Immutable candidate

Directory: `backend/database/integration-migrations/202611200015_postgres_public_default_privilege_hardening_v1/`

| File | SHA-256 |
| --- | --- |
| `001_preflight.sql` | `DC77263B95316735FFFD1DFDB67510AEDA8475943EA2C8AC68FF4A121D7AF3E7` |
| `002_up.sql` | `DB4B278A87A77409D640AF3BF4B9972BF6EC6E190C6DAF51E5E865993CCF5379` |
| `003_verify.sql` | `6F23DDAE4DED16B689EC83B328B1D9A82EA4492306E37C27691BB2FAE5024DC3` |
| `004_rollback_review.sql` | `7731BAC440051D6CEACF8ED27BC87632257DFC9D8418DB76269EBDBFB866D74F` |

## Scope and ordering

Migration 015 changes only PostgreSQL default ACLs for future tables and sequences created by role `postgres` in schema `public`. It removes automatic access for `anon`, `authenticated`, `meddecode_scoped_worker`, and `meddecode_worker`, while preserving `postgres` and `service_role`. It does not change existing objects, data, RLS, policies, ownership, functions, types, other schemas, RPCs, or `supabase_admin`.

Migration 014 is not a SQL dependency, but deploy and independently verify 014 first when both are planned in one change sequence: it resolves current-object exposure, while 015 prevents recurrence for future tables/sequences. Each requires its own approval and execution record; never combine their transactions.

## Authorization and recovery gates

1. Obtain a fresh, restricted application-database archive and record UTC time, size, SHA-256, versions, inventory, default ACL catalog evidence, object ACLs, and safe aggregate counts.
2. Restore-test it in a new task-owned PostgreSQL 17 environment. Verify application objects and data plus retained default-ACL definitions. Record the limitations of logical restore for global roles, managed platform configuration, owner/ACL replay, Auth, S3/KMS, and external services.
3. Require independent recovery review and one explicit authorization naming `002_up.sql`, its exact hash above, project `wyripeqruhvbksjfsvlr`, and database `postgres`.

## Final preflight

1. Recalculate all four hashes; stop on mismatch.
2. Require the reviewed project-qualified endpoint, database/session/effective role `postgres`, reviewed CA, and `sslmode=verify-full`.
3. Run exact `001_preflight.sql` in its bounded read-only transaction and require `POSTGRES_PUBLIC_DEFAULT_PRIVILEGE_PREFLIGHT_OK`.
4. Confirm the reviewed before-state for `postgres`/`public` future table and sequence defaults, expected role existence, preserved `service_role`, and no prior application of Migration 015.
5. Reconfirm current-object ACLs are unchanged by this candidate and functions, types, other schemas, and every `supabase_admin` default remain explicitly outside scope.
6. Stop on drift, identity/TLS failure, backup failure, role/default-ACL mismatch, or unexpected platform-managed dependencies.

## One-time deployment

Only after separate approval, execute exact `002_up.sql` once. It has one bounded transaction and two schema-qualified `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public` revocations, for future tables and sequences. Do not split, edit, retry after ambiguity, combine with Migration 014, or run rollback automatically.

## Independent post-deployment verification

1. In a new read-only session, run exact `003_verify.sql` and require `POSTGRES_PUBLIC_DEFAULT_PRIVILEGE_VERIFY_OK`.
2. Confirm future `public` table/sequence defaults for the four untrusted roles are absent and `postgres`/`service_role` defaults remain.
3. Confirm existing object ACLs, RLS, policies, ownership, data counts, function/type defaults, other-schema defaults, and `supabase_admin` defaults are unchanged.
4. An independently authorized disposable canary may subsequently create future objects to validate inheritance; do not create canaries on hosted production as part of this migration.
5. Capture sanitized execution evidence and independent reviewer signoff.

## Failure and recovery boundary

`004_rollback_review.sql` is read-only. Broad defaults must never be automatically regranted. A pre-commit failure rolls back atomically. After commit, a failed verifier requires a stop, evidence preservation, and a separately reviewed forward correction or explicitly authorized restore. Future API objects must receive explicit grants in their own reviewed migrations.

Function/type PUBLIC defaults and platform-managed `supabase_admin` defaults remain unresolved, separately scoped risks; Migration 015 must not be represented as complete default-privilege hardening.
