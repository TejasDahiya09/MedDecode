# Migration 013: final preflight diagnosis and fresh recovery evidence

Verified 2026-11-17, project wyripeqruhvbksjfsvlr, database postgres.
Session/current role postgres; existing session-pooler profile sslmode verify-full,
client TLS 1.3. All hosted operations in this task were read-only. No permits,
scope renewal, job changes, policy changes, worker startup or migration execution.

## Root cause

Migration 013's objects already exist on hosted PostgreSQL. Its four altered
base-function bodies match the reviewed **post-deployment** hashes. Its four new
functions also match. The unchanged independent verifier returned:

```text
EXACT_JOB_RETRY_VERIFY_OK
```

001_preflight.sql deliberately requires an uninstalled migration and the old
function bodies. It is correctly rejecting reinstallation. This is a deployment
state/implementation assumption, not a JSONB defect, expired-job failure or
failed owner/role check. Available metadata does not establish who installed
the objects or when. This task did not install or modify them.

Do not weaken the preflight, drop the objects, alter hashes or rerun 002_up.sql.
Use the installed-schema verification checkpoint. No local migration correction
was needed and no reviewed deployment SQL changed. The exact fresh-installation
preflight was not pointlessly rerun after diagnosis: its valid absence
requirements remain unmet and must remain FAIL for an already-installed schema.

## Every original predicate

The new 005_preflight_diagnostics.sql evaluates all predicates independently in
BEGIN READ ONLY with statement_timeout 10s and lock_timeout 2s. It reads only
catalog metadata and safe aggregates.

| Check | Expected | Actual | Result | Cause/category |
| --- | --- | --- | --- | --- |
| session_user | postgres | postgres | PASS | Authorization |
| current_user | postgres | postgres | PASS | Authorization |
| permit table absent | absent | meddecode_exact_job_retry_permits exists | FAIL | Already installed |
| initial completion RPC present | present | present | PASS | Migration 010 dependency |
| test-account table present | present | present | PASS | Authorization dependency |
| singleton current generation 2 | matching row | 2 | PASS | Generation authorization |
| initializer source | pre-013 hash | post-013 hash below | FAIL | Already installed |
| scoped claim source | pre-013 hash | post-013 hash below | FAIL | Already installed |
| scoped recovery source | pre-013 hash | post-013 hash below | FAIL | Already installed |
| automatic issuer source | pre-013 hash | post-013 hash below | FAIL | Already installed |
| authorize-exact-retry RPC absent | absent | exact reviewed signature exists | FAIL | Already installed |
| recover-claim-exact RPC absent | absent | exact reviewed signature exists | FAIL | Already installed |
| private retry core absent | absent | exact reviewed signature exists | FAIL | Already installed |
| fenced retry initializer absent | absent | exact reviewed signature exists | FAIL | Already installed |
| invalid base owners / SECURITY DEFINER modes | 0 | 0 | PASS | All four postgres-owned, SECURITY DEFINER |

Six predicates pass, nine reject reinstallation. Ownership and SECURITY DEFINER
were also inspected individually for all four base functions; all pass. Fixed
search paths are preserved. The independent installed verifier checks all eight
function body hashes, ownership/security/search paths and required ACL/effective
privilege boundaries. These checks passed. Zero permits exist (zero consumed,
zero live unused, zero associated with the target job).

Exact function-body SHA-256 comparisons (same CR treatment as the original
preflight; a separate CR-normalized comparison returned the same actual hashes):

| Function | Preflight expected | Actual / approved post-013 |
| --- | --- | --- |
| meddecode_initialize_prescription_review_v1 | 64a180563d00dfd5373756dbc33b2c359583738a8361521914badef034050930 | 21606cce69d469be85795ae4b520512618ff3c9af9ccf5b2fc8ff614a09add0a |
| meddecode_scoped_claim_next_prescription_analysis_job_v1 | 73d680941b284635b17e793f1db1f02efdcc47c86b69f81426c7e43143de6b2f | 04d2a9900c049ad5ec5538e997e618915f77d903772c12ec1fc4d18bdf3ff06e |
| meddecode_scoped_recover_expired_prescription_analysis_jobs_v1 | 35c25a1e9cdd0fd70355412155b5f0784885444c69cd915987610fe3639502e8 | 119619c13fd1708bacc49a5b6bbc876778b3c4fdbc1d3c2325738728107df6a8 |
| meddecode_scoped_authorize_next_automatic_job_v1 | 4c2196da5ac99a181159ae826e3e999a5470260dbf5ee45a1402820892bf0b56 | cebad947ab75f92bf0c48ff095d91018c5a3c80fc06d2c86c87695bc50d61be2 |

## Target and rollout state

At 2026-11-17 09:18:55 UTC:

- Target job 51c6cffd-ac79-4eaa-bc6d-851f20c2abab and prescription
  2bb56f2d-df83-4132-95a4-b9552fa48dd8 match the expected owner lineage.
- Job processing, attempt 1/3, claim generation 1; lease and scope expired.
- Owner is allowlisted; worker sessions 0.
- Generation 2 enabled/current; Generation 1 admissions 1, Generation 2 admissions 1.
- Hosted totals: prescriptions 8, jobs 9, results 2, review revisions 0.

These are not the cause of the installation-preflight rejection. No attempt
counter or generation was reset, no scope refreshed and no permit issued.

## Fresh backup and restore

Archive:
`C:\Users\dahiy\MedDecode-Backups\exact-retry-013-20261117T092247Z\meddecode-public-auth-current.dump`

- Export UTC: 2026-11-17T09:23:09.3238811Z.
- Restore verified UTC: 2026-11-17T09:23:18.0311713Z.
- Size: 990,811 bytes.
- SHA-256: 8C126E3D6F87641D1724DD74F9AEE1D8061C0F145E0E2F2167064DD201DF318A.
- Custom pg_dump, public/auth schema and data, functions, sequence state, RLS
  policies and original ACL/ownership definitions in the archive.
- Exported REPEATABLE READ READ ONLY snapshot used for both source aggregate
  evidence and pg_dump, so the comparison has one consistent recovery point.

Source and independently restored PostgreSQL 17.11 database matched:

| Item | Source | Restored |
| --- | --- | --- |
| Prescriptions | 8 | 8 |
| Jobs | 9 | 9 |
| Intelligence results | 2 | 2 |
| Reviews / evidence | 0 / 0 | 0 / 0 |
| Admissions / scopes | 2 / 3 | 2 / 3 |
| Auth users | 2 | 2 |
| Cabinet / reminders / dose logs | 0 / 0 / 0 | 0 / 0 / 0 |
| Tables | 67 | 67 |
| Indexes | 233 | 233 |
| Sequences | 1 | 1 |
| Functions | 56 | 56 |
| RLS policies | 47 | 47 |
| Constraints | 321 | 321 |
| Relevant relations total | 301 | 301 |

All 233 index-definition hashes and 56 function-body hashes matched. Aggregate
data digests matched for prescriptions, jobs, results, reviews, admissions,
singleton policy, scopes, Generation 1 history and allowlist. Generation 2
remained enabled/current; both generation admission counts remained 1.
Migration 010 completion and Migration 013 recovery functions were present in
both source and restore. The archive SHA-256 was rechecked after restoration.

Evidence is retained under the protected archive directory:

- EXPORT-MANIFEST.json (snapshot/export evidence).
- RECOVERY-MANIFEST.json (consolidated successful recovery point).
- source-verification.json (metadata, counts and digests only).
- inventory.list (archive inventory, including ACL definitions).
- restore-verification-20261117T092309Z/RESTORE-VERIFIED.json and protected logs.

The private SCRAM-authenticated cluster was bound only to 127.0.0.1:55614 and
launched using independently managed hidden pg_ctl processes. It was stopped
and its exact task-owned data directory and temporary password were removed.
Port release and resource removal were independently confirmed. No existing
development/PostgreSQL service was stopped. The archive remains outside Git,
restricted to the current user and SYSTEM, retained until explicitly deleted
by the owner; no automatic expiry.

Recovery limits remain: restore uses --no-owner --no-privileges with isolated
NOLOGIN policy-role placeholders. This verifies application schema/data,
constraints/indexes/policies/function bodies, not executable original global
role/ownership/ACL replay, full Supabase Auth/platform disaster recovery or S3
objects/configuration. Original ACL definitions are retained in the archive.

## Local changes and validation

- Added migration 013/005_preflight_diagnostics.sql (read-only diagnostics).
- Updated backend/scripts/backup-exact-retry.ps1 to use the proven independent
  restore helper instead of the obsolete synchronous daemon startup; extended
  source evidence with generation/Migration 010–013 and explicit index hashes.
- Updated backend/scripts/verify-exact-retry-backup.ps1 to accept an explicitly
  hash/size-bound backup directory and verify current-state metadata.
- Added this report. No application/worker code or deployment SQL was modified.

PowerShell parsing passed for both runners. Genuine fresh export and restore
verification passed. Unchanged 003_verify.sql passed hosted read-only. Git
diff --check passed. No migration defect was found, so no new migration patch
or replacement PostgreSQL functional/security test cycle was necessary; this
report does not claim a new run of the earlier 39-test suite.

## Final SQL hashes and decision

| File | SHA-256 |
| --- | --- |
| 001_preflight.sql | 6525CCB08DD50D0BFEF067340377260470B94A65907D8C7AA1D05501027BB975 |
| 002_up.sql | 0E220202A308B79C488A68A82DD329257960920506B3CB6CE1891629B4B43357 |
| 003_verify.sql | ACDD030B6DFF22911EF4CFF199DA9D8EBF691386ED1452E62E6725860DF4FA52 |
| 004_rollback_review.sql | 7257A167E0F65EE68FA5D356BE617ACAA33279DE49C01CDC7874BCFBE1AAEBA1 |
| 005_preflight_diagnostics.sql (new, read-only) | 808CEF40FCE1D4B1CBCFBAF314B1A58EFAC4F6EBBDF40E006E24DF41A20E8F91 |

No schema remediation or renewed deployment SQL approval is required: the
already-installed schema passes independent verification. Deployment must not
be repeated. The next distinct operation would be controlled exact-job permit
issuance and recovery after fresh runtime checks and explicit user direction.
Neither is part of this task.

MIGRATION_013_PREFLIGHT: FAIL (valid one-time guard; already installed)
MIGRATION_013_INSTALLED_VERIFY: PASS
FRESH_BACKUP_RESTORE: PASS
TARGET_JOB_STATE: VERIFIED
GENERATION_2: ENABLED
MIGRATION_013_HASHES: MATCH (four approved artifacts unchanged)
READY_FOR_DEPLOYMENT: NO (already installed; do not redeploy)
HOSTED_MUTATIONS: NONE
