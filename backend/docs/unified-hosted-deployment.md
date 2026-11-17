# Unified hosted Supabase deployment

Status: **operator package only**. No hosted command, migration, import, role
creation, privilege change, worker start, or application activation was
performed while preparing this package.

## Package

- Guarded one-stage runner:
  [`unified-hosted-deployment.ps1`](../scripts/unified-hosted-deployment.ps1)
- Read-only gate:
  [`unified_hosted_preflight.sql`](../database/unified_hosted_preflight.sql)
- Role provisioning stage:
  [`unified_hosted_role_provision.sql`](../database/unified_hosted_role_provision.sql)
- Read-only post-deployment verification:
  [`unified_hosted_post_deploy_verify.sql`](../database/unified_hosted_post_deploy_verify.sql)
- Catalogue-only first-stage gate:
  [`official_catalogue_target_preflight.sql`](../database/official_catalogue_target_preflight.sql)
- Worker active-job safety gate:
  [`worker_activation_safety_preflight.sql`](../database/worker_activation_safety_preflight.sql)
- Legacy TRUNCATE evidence audit:
  [`legacy_medicines_truncate_audit.sql`](../database/legacy_medicines_truncate_audit.sql)
- Existing catalogue deployment and rollback details:
  [`official-catalogue-deployment.md`](./official-catalogue-deployment.md)

The runner executes exactly one stage per invocation. Mutating stages require
`-ApprovedStage` to exactly equal `-Stage`; there are no automatic retries.
Use a password file, `PGSERVICE`, or an approved credential provider. Never put
passwords in `TargetDsn`, command history, logs, or `PGPASSWORD`.

## Immutable transfer input

Archive:

```text
C:\Users\dahiy\.copilot\session-state\3119dafc-d38d-45a4-8289-1320be7f544b\files\official_catalogue_deployment_2026-11-13.dump
```

SHA-256:

```text
E8962AFA0E5DF6D8F3B090E3EDC61A96E59C9BB3BBDE8A444C57CA77C01E365F
```

The archive is data-only and contains exactly the 13 `official_catalogue`
table-data entries. Do not rebuild it or use `--clean`, `--drop`, or
`--disable-triggers`.

## Approval boundaries

Obtain separate written approval for each of these stages:

1. `official-schema`
2. `replay-identity`
3. `archive-restore`
4. `official-rpc`
5. `role-provision`
6. `worker-submission-up`
7. `worker-claim-up`
8. `worker-finalization-up`
9. Worker process activation
10. Official catalogue application activation

The worker remains disabled throughout migration and verification. A queued or
processing prescription-analysis job blocks activation until an operator
reviews aggregate job counts and approves a privacy-preserving disposition.
Never select prescription payloads, patient columns, object keys, result JSON,
or job IDs for this gate.

## Ordered execution

Set the repository root and use an approved TLS-protected target connection.
The DSN below is a placeholder and must not contain a password.

```powershell
Set-Location C:\Users\dahiy\MedDecode-integration
$TargetDsn = '<approved passwordless TLS target DSN>'
$Archive = 'C:\Users\dahiy\.copilot\session-state\3119dafc-d38d-45a4-8289-1320be7f544b\files\official_catalogue_deployment_2026-11-13.dump'
$Runner = '.\backend\scripts\unified-hosted-deployment.ps1'
```

### 1. Identity, backup, and read-only gates

Confirm an independent Supabase backup/snapshot exists and record its
timestamp/retention externally. The SQL cannot prove backup availability.

```powershell
# Add -BackupConfirmed only after the independent backup/snapshot is recorded.
& $Runner -TargetDsn $TargetDsn -Stage preflight -BackupConfirmed
& $Runner -TargetDsn $TargetDsn -Stage legacy-capture
```

The unified preflight is an all-system gate and correctly blocks on any queued
or processing prescription-analysis job. The known queued job therefore
blocks worker preparation, but it does not prevent the independent catalogue
stage below. Run the catalogue-only gate first and stop if it fails:

```powershell
& $Runner -TargetDsn $TargetDsn -Stage catalogue-preflight -BackupConfirmed
```

The catalogue-only gate must report the hosted identity, the 238-row legacy
baseline, absent `official_catalogue`, absent official RPC objects, and
available Supabase auth prerequisites. It does not inspect or modify jobs.

The all-system preflight must still be run before any worker-related stage.
Stop if it reports any `BLOCKED` notice. In particular:

- database must be `postgres`, migration role must be `postgres`, and version
  must be PostgreSQL 17+;
- `public.medicines` must still contain the observed 238-row baseline;
- official schema/RPC objects must be absent for a fresh deployment;
- queued or processing jobs must be zero before worker migration/activation;
- partial submission, claim, or finalization migration states must not be
  replayed.

### 2. Official catalogue

Run the independent catalogue gate immediately before its first mutation:

```powershell
& $Runner -TargetDsn $TargetDsn -Stage catalogue-preflight -BackupConfirmed
```

Expected result: target is `postgres` on PostgreSQL 17+, `public.medicines`
has 238 rows, `official_catalogue` and its official RPC objects are absent,
and Supabase auth prerequisites are available. This gate does not inspect or
modify the queued prescription-analysis job.

Each command below is a separate approved mutation. The archive stage verifies
the checksum before invoking `pg_restore`.

```powershell
& $Runner -TargetDsn $TargetDsn -Stage official-schema -ApprovedStage official-schema -BackupConfirmed
& $Runner -TargetDsn $TargetDsn -Stage replay-identity -ApprovedStage replay-identity -BackupConfirmed
& $Runner -TargetDsn $TargetDsn -Stage archive-restore -ArchivePath $Archive -ApprovedStage archive-restore -BackupConfirmed
& $Runner -TargetDsn $TargetDsn -Stage catalogue-verify
& $Runner -TargetDsn $TargetDsn -Stage official-rpc -ApprovedStage official-rpc -BackupConfirmed
```

`official-rpc` runs its own preflight, transactional up migration, and
post-deployment verification. It fails closed if the managed `auth` dependency
cannot be used effectively; it never grants privileges on Supabase-managed
`auth` objects.

### 3. Restricted reader and worker roles

The role stage creates or validates:

- `meddecode_catalogue_python_reader`: login, no inheritance, no create/admin
  powers, and only `USAGE` plus selected-column `SELECT` on
  `official_catalogue.catalogue_entities`;
- `meddecode_worker`: `NOLOGIN`, no inheritance, no create/admin powers, and no
  direct application-table access;
- `meddecode_worker_login`: login identity allowed to `SET ROLE meddecode_worker`.

The role stage does not set passwords. Provision passwords through the approved
secret manager or passfile after the role DDL succeeds.

```powershell
& $Runner -TargetDsn $TargetDsn -Stage role-provision `
  -ApprovedStage role-provision -BackupConfirmed
```

Do not substitute `postgres`, `service_role`, `anon`, `authenticated`, or
`meddecode_worker` as the login identity. The worker code explicitly verifies
that the session login is restricted and that `SET LOCAL ROLE meddecode_worker`
has taken effect.

### 4. Worker migrations

Run each read-only migration preflight first. Because the hosted database has
no migration-history table, object names alone are not completion evidence.
Any existing function/index set must pass that migration's exact verification
SQL before its `*-up` stage is skipped. Never replay an object set that is
partial or not independently verified.

```powershell
& $Runner -TargetDsn $TargetDsn -Stage worker-submission-preflight
# Only when absent and approved:
& $Runner -TargetDsn $TargetDsn -Stage worker-submission-up -ApprovedStage worker-submission-up -BackupConfirmed

& $Runner -TargetDsn $TargetDsn -Stage worker-claim-preflight
# Only when absent and approved:
& $Runner -TargetDsn $TargetDsn -Stage worker-claim-up -ApprovedStage worker-claim-up -BackupConfirmed

& $Runner -TargetDsn $TargetDsn -Stage worker-finalization-preflight
# Only when absent and approved:
& $Runner -TargetDsn $TargetDsn -Stage worker-finalization-up -ApprovedStage worker-finalization-up -BackupConfirmed
```

Every worker `*-up` invocation performs a fresh aggregate queued/processing-job
safety check immediately before the migration. With the currently observed
queued job, each worker `*-up` stage is expected to stop before applying SQL.
No worker activation stage exists in this runner; process activation remains a
separate operational approval.

The claim and finalization migrations must not run while an existing
prescription-analysis job is processing unless a separate lease-adoption plan
has been approved. The submission migration preserves existing jobs but its
preflight rejects incompatible historical lineage.

### 5. Final database verification

```powershell
& $Runner -TargetDsn $TargetDsn -Stage post-deploy-verify
```

Expected catalogue counts are:

| Table | Rows |
|---|---:|
| sources | 12 |
| releases | 22 |
| import_batches | 42 |
| source_records | 7,072 |
| ingredients | 8,388 |
| formulations | 4,802 |
| formulation_ingredients | 5,079 |
| products | 1,710 |
| product_packages | 4,781 |
| price_observations | 4,781 |
| regulatory_events | 1,951 |
| link_candidates | 9,982 |
| catalogue_entities | 26,419 |

The verifier also checks 17 validated foreign keys, no invalid price-package
references, restricted RPC grants, reader privileges, worker schema access, and
required RPC signatures.

## Runtime verification (not SQL)

These checks require separate HTTP/application credentials and are not proven
by the SQL verifier:

1. Authenticated PostgREST search/detail calls return
   `catalogue_source=official_catalogue` and
   `id_namespace=official_catalogue.formulation_id`.
2. Anonymous and unauthenticated calls fail with authorization/authentication
   errors.
3. Direct `official_catalogue` table REST access fails.
4. Python connects with `MEDDECODE_CATALOGUE_ENV=hosted`,
   `sslmode=verify-full`, the mounted CA, and the dedicated reader; `SELECT`
   succeeds only for the approved columns and writes fail.
5. A worker login connection can `SET LOCAL ROLE meddecode_worker`, reports
   `current_user=meddecode_worker`, and passes the existing startup identity
   query. It must not claim a job during this test.
6. S3 object-read configuration is verified with a designated non-patient
   synthetic object, not an existing prescription.
7. A separately approved synthetic prescription fixture is processed only after
   the queued-job gate is clear. Verify Contract v1 persistence, result/history
   HTTP authorization, cross-user denial, and no official-to-legacy UUID
   mapping.
8. Frontend search, comparison, upload, status, result, and history smoke tests
   run only against the approved deployment environment.

Keep `PROCESSING_WORKER_ENABLED=false`,
`MEDICINE_CATALOGUE_READ_ENABLED=false`, and
`MEDICINE_CATALOGUE_DEFAULT_SOURCE=legacy` until all runtime checks pass.

## Activation

Catalogue activation is separate from database migration:

```text
MEDICINE_CATALOGUE_READ_ENABLED=true
MEDICINE_CATALOGUE_DEFAULT_SOURCE=official_catalogue
```

Approve and deploy this application configuration first. Keep explicit
`source=legacy` support available. Worker activation is a separate approval:
only after the queue gate, role-assumption test, S3 synthetic test, and
Contract v1 persistence test pass may `PROCESSING_WORKER_ENABLED=true` be
deployed.

## Rollback and recovery

- If a migration or archive restore exits nonzero, stop. Do not retry until
  read-only inspection establishes whether its transaction committed.
- A failed transactional schema/RPC migration rolls back its own transaction.
  `pg_restore --single-transaction` similarly commits all table data or none.
- Do not drop or truncate `public.medicines`, processing tables, or queued jobs.
- Before catalogue activation, rollback is application configuration only:
  restore `MEDICINE_CATALOGUE_READ_ENABLED=false` and
  `MEDICINE_CATALOGUE_DEFAULT_SOURCE=legacy`.
- Before worker activation, leave `PROCESSING_WORKER_ENABLED=false`; do not
  drain, delete, or mutate existing jobs as part of rollback.
- Removal of catalogue schema, RPC owner, reader role, worker roles, or grants
  is a separately reviewed migration. Preserve audit evidence and inspect
  dependent functions before any removal.

## Final recommendation

**GO for the catalogue schema stage only, subject to the catalogue-only
preflight and explicit stage approval. NO-GO for worker migration or
activation while the queued job remains.**

The package is locally prepared and statically verifiable, but hosted
preflight, backup confirmation, role provisioning, migrations, runtime smoke
tests, application activation, and worker activation remain external approval
boundaries.

## Legacy TRUNCATE remediation proposal

Run the read-only evidence audit:

```powershell
& $Runner -TargetDsn $TargetDsn -Stage legacy-truncate-audit
```

It reports effective `TRUNCATE` for `anon` and `authenticated`, explicit
table ACL entries (including PUBLIC), and inherited role paths. If the audit identifies an unnecessary direct grant, the narrowly scoped
remediation proposal is:

```sql
REVOKE TRUNCATE ON TABLE public.medicines FROM anon, authenticated;
```

For an inherited grant, target the specific inherited role instead; for a
PUBLIC grant, target `PUBLIC`. Do not execute any form of the proposal until
the privilege source is confirmed and separately approved, and do not alter
unrelated table privileges.
