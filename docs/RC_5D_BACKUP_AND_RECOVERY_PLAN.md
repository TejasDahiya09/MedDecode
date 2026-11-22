# RC-5D Current-State Backup and Recovery Plan

Date: 2026-11-20

Status: `READY_FOR_SEPARATE_BACKUP_AUTHORIZATION`, but Migration 014 and Migration 015 remain blocked. This document is a preparation artifact only. No hosted backup, SQL mutation, restore, migration, worker action, or medical-data export was performed.

## Repository and preservation checkpoint

- Repository: `C:\Users\dahiy\MedDecode-integration`.
- Branch: `main`.
- HEAD: `dfcfbc35f418594cbde45da9b0f5e71172b81153`.
- Local HEAD and `origin/main`: synchronized (`0 0`) at inspection time.
- RC-5 through RC-5C documentation, tests, and Migration 014/015 candidates remain untracked and preserved.
- No file was staged, committed, reset, cleaned, or pushed.
- Migration 014 and Migration 015 remain undeployed according to the reviewed read-only preflight evidence. This task did not rerun or mutate the hosted database.

## Existing recovery point

The newest documented restore-tested application archive remains:

- path: `C:\Users\dahiy\MedDecode-Backups\exact-retry-013-20261117T173425Z\meddecode-public-auth-current.dump`;
- backup timestamp: `2026-11-17T17:34:52.3951365Z`;
- filesystem timestamp: `2026-11-17T17:34:52.1033512Z`;
- size: 994,856 bytes;
- SHA-256: `78961944C84EBECD6760EDFAE21243D5FE6CDB1F93087B3D4DD58564AB1F0611`;
- historical PostgreSQL 17 restore: PASS;
- historical source/restore data digests, function hashes, and index hashes: MATCH.

The archive, byte size, and SHA-256 were read again during RC-5D and remained unchanged. Its file owner is the expected local account and its ACL is restricted to two access rules. This does not establish volume encryption or an approved retention policy.

The archive predates this deployment decision by three days. It also predates any hosted changes that may have occurred after its repeatable-read snapshot. It is therefore historical evidence, not the recovery prerequisite for Migration 014 or 015.

## Supported backup mechanisms

### Supabase-managed backups

Supabase currently documents automatic daily backups for Pro, Team, and Enterprise projects, with plan-dependent retention, and PITR as a paid add-on. Free projects do not receive automatic managed backups and are directed to make manual CLI exports. Database backups do not copy Storage objects; managed restores can require downtime and custom-role passwords are not retained in downloadable daily backups.

The current plan tier and Dashboard backup inventory for project `wyripeqruhvbksjfsvlr` were not independently queried under this task. Earlier project evidence identified it as Free. If it is still Free, no managed recovery point should be assumed. If the plan changed, an authorized project administrator must inspect Database > Backups and record the newest recovery point and retention without initiating a restore.

References:

- [Supabase database backups](https://supabase.com/docs/guides/platform/backups)
- [Supabase Free-plan backup policy](https://supabase.com/kb/faqs/platform/free-plan-backups)
- [Restore to a new project](https://supabase.com/docs/guides/platform/clone-project)

### Manual logical application backup

The supported immediate mechanism is a fresh PostgreSQL 17 logical backup through the existing project-qualified, CA-verified administrative service. The repository's reviewed `backend/scripts/backup-exact-retry.ps1` already implements the essential controls:

- exact project/database/profile validation;
- `sslmode=verify-full` and reviewed root CA;
- rejection of process-level libpq overrides;
- a repeatable-read, read-only exported snapshot;
- safe aggregate and catalog evidence from the same snapshot;
- PostgreSQL 17 custom-format `pg_dump` of `public` and `auth`;
- `pg_restore --list` inventory and SHA-256/size binding;
- a task-owned PostgreSQL 17 restore test;
- source/restore count, digest, index, function, generation, and migration checks;
- private-cluster shutdown and cleanup.

The script must not be run until separately authorized for a real-data export. Before execution it requires a narrowly scoped RC-5D review update: use a new RC-5D directory name, add Migration 014/015 absence and preflight-compatibility evidence, capture current ACL/default-ACL/ownership metadata, verify encrypted destination storage, and bind an independently named restore operator. Do not modify or overwrite the historical archive.

The Supabase CLI is an alternative official logical-export path, but its default schema dump excludes managed schemas and contains neither data nor custom roles. Separate schema, data, and role-only exports are required. For MedDecode, direct PostgreSQL 17 `pg_dump` of explicitly reviewed `public` and `auth` schemas is the better-established application recovery artifact, while an optional separately protected role-only export can document custom role definitions. No role password should be exported or recorded.

References:

- [Supabase CLI db dump reference](https://supabase.com/docs/reference/cli/introduction#supabase-db-dump)
- [Supabase CLI backup and restore](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)

## Required privileges and connection boundary

The backup connection requires only privileges sufficient to:

- connect to database `postgres` on project `wyripeqruhvbksjfsvlr`;
- read the explicitly approved `public` and `auth` schemas, their definitions, sequences, and table data;
- read relevant PostgreSQL catalogs for functions, triggers, policies, constraints, indexes, owners, ACLs, default ACLs, extensions, and role dependencies;
- export a repeatable-read snapshot.

The existing reviewed session identity is `postgres` through the project-qualified `meddecode_hosted_admin` service. It is broader than an ideal backup-only role, so its use requires explicit owner authorization, a read-only transaction for evidence queries, no SQL from unreviewed input, and no credentials on the command line or in output. The connection must fail closed unless database, project-qualified host/login, session/effective role, CA file, port, and `sslmode=verify-full` match the reviewed profile.

The backup operation must not use `service_role`, an application JWT, worker credentials, or a browser session. It must not list or retrieve S3 objects.

## Recovery coverage matrix

| Component | Logical archive coverage | Restore-test method | Limitation |
| --- | --- | --- | --- |
| `public` schema and data | Included | Restore custom archive and compare counts/digests | Contains sensitive application data; approved isolated host required |
| `auth` schema and data | Included by explicit schema selection | Restore and compare aggregate counts/catalog objects | Does not reproduce Supabase Auth configuration, JWT keys, OAuth, SMTP, or existing token validity |
| Tables, sequences, views, indexes, constraints | Included | Catalog inventory plus source/restore hashes | Extension/platform dependencies must exist first |
| Functions and triggers | Included | Signature, owner metadata, definition hash, trigger attachment and enabled-state comparison | Definer identities may require safe local role mapping |
| RLS and policies | Included in schema definition | Compare `relrowsecurity`, policy names, roles, commands, modes, and parsed expressions | Local placeholder roles do not prove hosted API behavior |
| Object ACL definitions | Present in archive/catalog evidence | Compare source ACL/default-ACL manifests; optionally restore into an approved role-compatible target | `--no-privileges` local restore intentionally does not execute hosted ACLs |
| Object ownership | Captured as catalog evidence | Compare expected owner map; restore under controlled mapping | `--no-owner` local restore cannot prove faithful hosted ownership replay |
| Custom role definitions | Not complete in the application archive | Optional Supabase CLI role-only export, sanitized inventory, allowlisted NOLOGIN placeholders | Passwords, platform roles, memberships, and SET/ADMIN behavior need separate review |
| Default ACLs | Capture explicitly from `pg_default_acl` | Compare source manifest and run Migration 014/015 preflights locally | Restoring platform-managed defaults may be unsafe |
| Supabase managed physical recovery | Not covered | Dashboard/Management API evidence by authorized project admin | Current plan and managed recovery points remain unverified |
| Storage/S3 objects and bucket settings | Not covered | Separate storage inventory/recovery plan | Database contains metadata only; object bytes are external |
| KMS, Vault root material, API/JWT secrets | Not covered by this logical plan | Platform-specific recovery process | Never export secrets into this archive/report |
| Edge Functions, Auth provider settings, Realtime, extensions/settings, DNS | Not covered or only partially represented | Separate platform configuration inventory | Manual reconfiguration is required after project duplication/self-hosted restore |

## Disposable PostgreSQL 17 restore-test design

No restore may begin until the backup export and the destination are separately authorized. The destination must be a task-owned Windows host or VM with approved handling of hosted personal data, full-disk encryption, access limited to the backup and restore operators, no network exposure beyond loopback, and no backup/synchronization agent that copies the restored files elsewhere.

### 1. Integrity and provenance

1. Bind the archive path, byte size, SHA-256, backup UTC, project reference, database, source server version, tool version, and exported snapshot identifier in a signed or access-controlled manifest.
2. Run PostgreSQL 17 `pg_restore --list`; require a readable custom archive and allowlisted schemas/object classes.
3. Recalculate the hash before and after restore. Stop on any mismatch, missing manifest, unexpected schema, or unapproved object class.

### 2. Isolated environment

1. Allocate a unique loopback port and new task-owned directory on encrypted storage.
2. Initialize PostgreSQL 17 with a random temporary password held only in process memory or a restricted temporary file.
3. Verify process ownership, data-directory containment, port identity, PostgreSQL major version, and absence of an existing listener.
4. Create only allowlisted NOLOGIN placeholder roles and reviewed extensions needed to parse and restore the application schemas. Never recreate platform login passwords.

### 3. Restore and comparison

1. Restore in one transaction with `--no-owner --no-privileges` for the baseline data/schema recovery test.
2. Verify tables, sequences, constraints, indexes, function definitions, trigger attachments, RLS enablement, parsed policy definitions, and safe aggregate counts.
3. Compare deterministic data digests for approved application tables without emitting row contents.
4. Compare source and restored object/function/index inventories and hashes.
5. Compare the captured owner, ACL, column ACL, default ACL, and role-membership manifests independently. Record that these were compared, not executed, in the baseline restore.
6. Run Migration 014 and 015 exact preflights against the restored baseline only after adapting no production identity guards; do not apply either `002_up.sql` during backup verification.
7. Run focused backend repository/authorization tests against the isolated database: owner CRUD, cross-owner denial, RLS behavior, trigger execution, `service_role` maintenance assumptions, and worker direct-table denial.

### 4. Optional faithful security replay

A faithful owner/ACL/role restore requires a separate, explicitly approved platform-compatible disposable target. It must use reviewed role mappings and exclude passwords and Supabase-managed roles that cannot safely be recreated. Do not run a role-only dump or raw ACL replay into an ordinary local cluster merely to claim parity. If this stage is not approved, report ownership/ACL recovery as metadata-verified but execution-unverified.

### 5. Cleanup and evidence

1. Stop the exact task-owned cluster and confirm the port is closed.
2. Securely remove only the task-owned restored data directory and temporary password after evidence approval. Retain sanitized manifests and logs; logs must contain no row data, connection strings, tokens, object keys, or credentials.
3. Keep the encrypted source archive until both Migration 014 and 015 deployment windows and their defined retention period have ended. Deletion requires owner approval and verified target-path containment.

## Backup operation plan — not authorized for execution

1. **Approval record:** project owner names the exact project, database, schemas, source role/profile, output root, permitted operator, independent restore operator, retention period, encryption control, and whether `auth` data export is authorized.
2. **Operator preflight:** authorized backup operator verifies branch/candidate hashes, project-qualified service profile, database `postgres`, expected `postgres` session/effective role, port, CA path, `sslmode=verify-full`, PostgreSQL 17 client tools, and no libpq environment overrides.
3. **Managed-backup check:** an authorized Supabase project administrator records the plan tier, available managed recovery points, retention, and restore-to-new-project availability without starting a restore.
4. **Destination:** create a new non-reused directory under an approved encrypted volume outside Git. Apply an allowlisted ACL before writing. Confirm cloud sync, indexing, crash dumps, and inherited broad access do not expose the archive.
5. **Snapshot:** start one repeatable-read, read-only transaction; set UTC, bounded statement/lock/idle timeouts; verify identity; export a snapshot.
6. **Evidence:** from that snapshot capture only safe aggregate counts/digests and catalog metadata needed for recovery. Do not print patient rows or Auth records.
7. **Export:** run PostgreSQL 17 custom-format `pg_dump` for explicitly authorized schemas using the exported snapshot. Send no password in arguments; use the protected libpq service/passfile mechanism.
8. **Validation:** close with rollback; inspect the archive inventory; compute size and SHA-256; verify source version and expected object coverage. Stop if the snapshot session or dump has an ambiguous result.
9. **Independent restore:** hand the immutable hash/size-bound archive to the separately named restore operator. Restore only into the approved encrypted disposable environment using the procedure above.
10. **Signoff:** backup operator, restore operator, security reviewer, and project owner sign the evidence. Only then may Migration 014 receive a separate hash-specific execution request.

### Abort conditions

Abort without retry or partial evidence claims if identity/TLS differs, project plan/backup state is unexpected, destination encryption or ACLs are unverified, a credential appears in output, snapshot consistency fails, `pg_dump`/inventory/hash fails, unapproved schemas appear, restore counts/digests/objects differ, a required role/extension cannot be safely represented, cleanup ownership is ambiguous, or an independent operator/signoff is unavailable.

## Storage, encryption, retention, and private-data handling

- Approved destination: a new directory under `C:\Users\dahiy\MedDecode-Backups\` only if the underlying volume's encryption is independently verified; otherwise use an owner-approved encrypted volume or encrypted container outside Git.
- Directory/file ACL: backup operator plus explicitly named recovery custodian only; no inheritance that grants other local users, build agents, cloud-sync tools, or application processes.
- At-rest protection: full-disk encryption is mandatory. If the archive is transferred or retained outside the originating encrypted machine, wrap it in approved authenticated encryption and store the key separately. SHA-256 is integrity evidence, not encryption.
- In transit: PostgreSQL `sslmode=verify-full` with the reviewed CA; encrypted approved transfer only between backup and restore custodians.
- Temporary files: restricted encrypted task directory; no plaintext SQL exports in repository, shell history, `%TEMP%`, or shared folders; delete only after verified receipt and with explicit owner-approved scope.
- Retention proposal: retain the current pre-deployment archive until both migrations are independently verified and for an owner-selected rollback window; then require explicit deletion approval. Retain sanitized manifests and deployment evidence longer according to project policy. No retention period is currently approved.
- The archive contains hosted application/Auth data and must be treated as confidential medical/account data even when the test account is fictional. No row-level content may enter reports.

## Recovery authority and unresolved approvals

No named individual or account has yet been authorized for the new export or restore. Required roles are:

| Authority | Required actor | Current state |
| --- | --- | --- |
| Inspect managed backup inventory | Supabase organization/project owner or administrator | Unresolved |
| Create logical backup | Project owner-designated database backup operator authorized to use `meddecode_hosted_admin` read-only export path | Unresolved |
| Access/retain archive | Named backup custodian on verified encrypted storage | Unresolved |
| Restore test | Different named recovery operator on an approved isolated encrypted PostgreSQL 17 environment | Unresolved |
| Review recovery evidence | Independent PostgreSQL/security reviewer | Unresolved |
| Accept backup limitations and retention | Project owner/data controller | Unresolved |
| Authorize Migration 014 | Project owner, separate exact-file/hash approval after recovery signoff | Not authorized |
| Authorize Migration 015 | Project owner, separate exact-file/hash approval after 014 decision and fresh recovery review | Not authorized |

The administrative connection's technical ability to dump data is not authorization to export it. Similarly, possession of an archive does not authorize restoration, access to its row contents, or migration execution.

## Exact conditions for unblocking Migration 014

Migration 014 remains blocked until all of the following are documented:

1. Current project plan and managed recovery-point availability are recorded by an authorized project administrator.
2. The project owner explicitly authorizes one current logical export, naming operator, schemas, destination, encryption, and retention.
3. A fresh repeatable-snapshot archive is created after final drift review, with exact size, SHA-256, UTC, versions, inventory, owner/ACL/default-ACL metadata, and safe aggregate manifest.
4. A separately authorized operator restore-tests the immutable archive in an approved encrypted PostgreSQL 17 environment.
5. Schema/data/object comparisons pass; owner/ACL replay limitations are explicitly accepted or a faithful platform-compatible restore test passes.
6. All temporary restore resources are stopped and cleaned, and the protected source archive remains available.
7. An independent reviewer signs off on recovery evidence and limitations.
8. Migration 014 hashes are recalculated, its exact hosted read-only preflight is rerun after backup, and no drift is found.
9. The project owner issues a separate one-time authorization naming Migration 014 `002_up.sql` and SHA-256 `C76FE4862A4C602AF8C92DD24DA5C2B3DE41C1F34F566BF50573D5C1F9C72E03`.

Migration 015 remains separately blocked until Migration 014's deployment decision and verification are known, backup freshness is reassessed, its exact preflight passes, and the project owner issues its separate hash-specific authorization.

```text
RC_5D_STATUS: PREPARATION_COMPLETE_AUTHORIZATIONS_PENDING
BACKUP_METHOD: POSTGRESQL_17_REPEATABLE_SNAPSHOT_CUSTOM_LOGICAL_DUMP_OF_EXPLICIT_PUBLIC_AND_AUTH_SCOPE
RECOVERY_COVERAGE: APPLICATION_SCHEMA_DATA_FUNCTIONS_TRIGGERS_RLS_AND_CATALOG_METADATA_PARTIAL_FOR_OWNERS_ACLS_ROLES_AND_PLATFORM
RESTORE_TEST_DESIGN: COMPLETE_NOT_EXECUTED
BACKUP_OPERATOR: UNASSIGNED_REQUIRES_PROJECT_OWNER_AUTHORIZATION
RESTORE_OPERATOR: UNASSIGNED_MUST_BE_SEPARATELY_AUTHORIZED
APPROVAL_REQUIREMENTS: MANAGED_BACKUP_INVENTORY_EXPORT_DATA_HANDLING_ENCRYPTED_DESTINATION_RESTORE_TEST_RETENTION_INDEPENDENT_SIGNOFF_AND_SEPARATE_MIGRATION_APPROVALS
MIGRATION_014_GATE: BLOCKED_PENDING_FRESH_AUTHORIZED_RESTORE_TESTED_BACKUP_AND_HASH_SPECIFIC_APPROVAL
MIGRATION_015_GATE: BLOCKED_PENDING_014_DECISION_RECOVERY_REASSESSMENT_AND_SEPARATE_HASH_SPECIFIC_APPROVAL
HOSTED_MUTATIONS: NONE
REMAINING_BLOCKERS: CURRENT_PLAN_BACKUP_INVENTORY_NAMED_OPERATORS_ENCRYPTION_RETENTION_EXPORT_AUTHORIZATION_RESTORE_AUTHORIZATION_AND_INDEPENDENT_SIGNOFF
```
