# RC-5C Security Migration Deployment Readiness

Date: 2026-11-20

Status: `BLOCKED`. The two immutable migration candidates passed independent source, hosted read-only compatibility, and local PostgreSQL review, but no fresh current-state recovery point was created or restore-tested under this task's authorization. The newest documented restore-tested archive is from 2026-11-17 and cannot establish recovery of the current 2026-11-20 hosted state.

No hosted grant, revoke, migration, data mutation, backup export, restore, worker operation, or application-state change occurred.

## Repository and preservation

- Branch: `main`.
- HEAD: `dfcfbc35f418594cbde45da9b0f5e71172b81153`.
- After a fresh `git fetch origin main`, local HEAD and `origin/main` were synchronized (`0 0`).
- RC-5 documentation, both migration directories, their PostgreSQL tests, and all unrelated untracked reports were preserved. Nothing was staged, reset, cleaned, committed, or pushed.

## Exact candidate hashes

### Migration 014

`backend/database/integration-migrations/202611190014_current_object_privilege_hardening_v1/`

| File | SHA-256 |
| --- | --- |
| `001_preflight.sql` | `C659FB9CF9D0DC693F8BFAC2DEB9E7D5C92885218B3403C26E5ED73FEFFB278F` |
| `002_up.sql` | `C76FE4862A4C602AF8C92DD24DA5C2B3DE41C1F34F566BF50573D5C1F9C72E03` |
| `003_verify.sql` | `E78D54D74718613AEF22A83025B029BAD7EF578E5F687604197CBD04A1D04303` |
| `004_rollback_review.sql` | `37E219EE373B0FB2F66CFABABFCE448C084646194549C85D9AE83AE50EDA2376` |

### Migration 015

`backend/database/integration-migrations/202611200015_postgres_public_default_privilege_hardening_v1/`

| File | SHA-256 |
| --- | --- |
| `001_preflight.sql` | `DC77263B95316735FFFD1DFDB67510AEDA8475943EA2C8AC68FF4A121D7AF3E7` |
| `002_up.sql` | `DB4B278A87A77409D640AF3BF4B9972BF6EC6E190C6DAF51E5E865993CCF5379` |
| `003_verify.sql` | `6F23DDAE4DED16B689EC83B328B1D9A82EA4492306E37C27691BB2FAE5024DC3` |
| `004_rollback_review.sql` | `7731BAC440051D6CEACF8ED27BC87632257DFC9D8418DB76269EBDBFB866D74F` |

The hashes were freshly recalculated from the working tree. Both `001_preflight.sql` and `003_verify.sql` files use bounded read-only transactions and roll back. Both `004_rollback_review.sql` files are also read-only. Neither migration contains application DML, RLS-policy changes, ownership changes, or function-body changes.

## Migration 014 independent review

Migration 014 targets exactly 27 reviewed `public` tables and four exact zero-argument trigger-function signatures. Hosted catalog evidence confirms all tables exist, are owned by `postgres`, retain RLS, and match the reviewed before-state. It preserves the special asymmetric CRUD matrix on `ai_jobs`, required CRUD elsewhere, full `service_role` access, and zero worker direct-table access.

The four functions and nine enabled trigger dependencies are accounted for: `handle_new_user()` on `auth.users`; six `set_updated_at()` triggers; `update_updated_at_column()` on `medicines`; and `validate_cabinet_family_member()` on `medicine_cabinet`. Local PostgreSQL proves trigger execution continues after direct EXECUTE is revoked. No application direct-call dependency was found.

The deployment changes only excessive existing-object ACLs. It revokes `TRUNCATE`, `REFERENCES`, `TRIGGER`, and `MAINTAIN` from unintended roles and direct EXECUTE on the four trigger functions from PUBLIC/API/worker roles. It does not change records, CRUD, RLS, policies, constraints, owners, trigger bindings, function bodies, service maintenance, default ACLs, or worker RPC behavior.

Rollback is forward-only: the review script does not regrant unsafe privileges. A post-commit problem requires a separately reviewed forward fix or an explicitly authorized restore based on catalog evidence.

## Migration 015 independent review

Migration 015 is limited to two default-ACL changes for objects created by role `postgres` in schema `public`: future tables and future sequences. It removes automatic privileges for `anon`, `authenticated`, `meddecode_scoped_worker`, and `meddecode_worker`, and preserves `postgres` and `service_role`.

It does not alter existing objects, functions, types, other schemas, application data, RLS, ownership, RPCs, or `supabase_admin`. Disposable PostgreSQL verification demonstrates that existing ACL/RLS state is unchanged, future `public` tables and sequences deny the four unintended roles, service behavior remains available, other-schema behavior is unchanged, and reapplication fails closed.

The limitation is material: future function/type PUBLIC defaults and platform-managed `supabase_admin` defaults remain unresolved. They require separate compatibility decisions and must not be bundled into Migration 015.

## Ordering and dependencies

The migrations are logically independent, but the reviewed deployment order is:

1. Fresh current backup and independent restore verification.
2. Separate authorization for Migration 014; run its preflight, deploy once, and independently verify.
3. Reassess backup freshness and drift.
4. Separate authorization for Migration 015; run its preflight, deploy once, and independently verify.

Migration 014 first closes current-object exposure; Migration 015 then prevents recurrence for future `postgres`-created `public` tables/sequences. Approval or success of one does not authorize the other. Never combine their transactions.

## Backup and recovery readiness

The newest documented restore-tested archive is:

- archive: `C:\Users\dahiy\MedDecode-Backups\exact-retry-013-20261117T173425Z\meddecode-public-auth-current.dump`;
- backup UTC: `2026-11-17T17:34:52.3951365Z`;
- documented SHA-256: `78961944C84EBECD6760EDFAE21243D5FE6CDB1F93087B3D4DD58564AB1F0611`;
- documented PostgreSQL 17 restore: PASS;
- disposable restore cleanup: PASS.

The archive was independently re-read in this task: it exists, is 994,856 bytes, has filesystem timestamp `2026-11-17T17:34:52.1033512Z`, and freshly hashes to the documented SHA-256. PostgreSQL 17 `pg_restore --list` successfully read 825 entries, including 67 table-data entries, 115 functions, 47 policies, 141 ACL entries, and five schema entries. This inventory check is not a new restore test; the prior restore receipt remains historical evidence. More importantly, the archive is three days older than this readiness review. It is useful historical evidence, not a current deployment recovery point.

Historical recovery testing proves that a task-owned PostgreSQL 17 environment is available and that application `public`/`auth` schema and data can be restored. It does not prove hosted restore authority. The logical archive also does not independently recover global roles, exact owner/ACL execution context, Supabase-managed platform configuration, Auth platform state, S3/KMS objects, or external service configuration. No current retention guarantee or authorized hosted restore procedure was independently established.

Consequently:

- backup readiness: `BLOCKED` pending a fresh archive, hash, inventory, and safe aggregate manifest;
- recovery readiness: `PARTIAL` historically, but `BLOCKED` as a deployment prerequisite pending an independent current restore test and explicit recovery-authority decision.

## Hosted read-only evidence

Prior exact preflights used the project-qualified `meddecode_hosted_admin` libpq profile for project `wyripeqruhvbksjfsvlr`, database `postgres`, session/effective role `postgres`, reviewed CA, and `sslmode=verify-full`. They returned:

- `CURRENT_OBJECT_PRIVILEGE_HARDENING_PREFLIGHT_OK` for Migration 014;
- `POSTGRES_PUBLIC_DEFAULT_PRIVILEGE_PREFLIGHT_OK` for Migration 015.

Those checks were read-only and rolled back. They establish candidate compatibility at the recorded checkpoint, not permission to deploy and not a substitute for a fresh final preflight after backup verification.

## Local verification

The combined RC-5, RC-5A, and RC-5B PostgreSQL 17 suite exercises actual roles, ACLs, RLS, trigger behavior, existing-object preservation, future-object inheritance, service access, worker isolation, fail-closed reapplication, and cleanup: 3 passed, 0 failed, 0 skipped. Focused backend repository/authorization tests cover owner CRUD, cross-owner denial, catalogue paths, PostgreSQL transport, and restricted worker behavior: 137 passed, 0 failed, 0 skipped. Backend typecheck passed. `git diff --check`, the untracked-file whitespace check, and the focused secret scan passed.

## Deployment artifacts and stop conditions

- Migration 014 runbook: `docs/RC_5C_MIGRATION_014_DEPLOYMENT_RUNBOOK.md`.
- Migration 015 runbook: `docs/RC_5C_MIGRATION_015_DEPLOYMENT_RUNBOOK.md`.

Stop either deployment for a hash mismatch, stale or failed backup, failed restore comparison, project/database/role/TLS mismatch, failed exact preflight, catalog drift, unexpected dependency, ambiguous execution result, failed verifier, changed aggregate counts, or absent independent reviewer signoff. Never automatically execute either rollback review.

## Required separate authorizations

Migration 014 requires an explicit one-time authorization naming project `wyripeqruhvbksjfsvlr`, database `postgres`, `002_up.sql`, and hash `C76FE4862A4C602AF8C92DD24DA5C2B3DE41C1F34F566BF50573D5C1F9C72E03`, issued only after a fresh restore-tested backup and exact final preflight.

Migration 015 requires a distinct one-time authorization naming the same target, its own `002_up.sql`, and hash `DB4B278A87A77409D640AF3BF4B9972BF6EC6E190C6DAF51E5E865993CCF5379`, after Migration 014's independent verification (if 014 is deployed first), a backup-freshness decision, and its own exact final preflight.

```text
RC_5C_STATUS: BLOCKED
MIGRATION_014_HASHES: MATCH
MIGRATION_015_HASHES: MATCH
BACKUP_READINESS: BLOCKED_STALE_AND_NOT_INDEPENDENTLY_RECHECKABLE
RECOVERY_READINESS: PARTIAL_HISTORICAL_BLOCKED_FOR_CURRENT_DEPLOYMENT
INDEPENDENT_REVIEW: PASS
LOCAL_POSTGRESQL_TESTS: PASS_3_OF_3
MIGRATION_014_DEPLOYMENT_GATE: BLOCKED_PENDING_FRESH_RESTORE_TESTED_BACKUP_AND_SEPARATE_HASH_APPROVAL
MIGRATION_015_DEPLOYMENT_GATE: BLOCKED_PENDING_014_DECISION_FRESH_RECOVERY_EVIDENCE_AND_SEPARATE_HASH_APPROVAL
HOSTED_MUTATIONS: NONE
REMAINING_BLOCKERS: FRESH_CURRENT_BACKUP_RESTORE_TEST_RECOVERY_AUTHORITY_AND_INDEPENDENT_SIGNOFF
```
