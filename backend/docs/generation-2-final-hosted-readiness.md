# Generation 2 final independent activation review

Review completed 2026-11-16. GO for requesting separate activation approval.
No activation SQL, workers, flags, job claims, seed or hosted mutations occurred.

## Candidate integrity and hash change

| Artifact | SHA-256 |
| --- | --- |
| 001_preflight.sql | 6B78301E0566733313B286D21C33D481AF060E7DC2B505F7AFE00ABA9ECCD578 |
| 002_activate.sql | 3C03CAB35D8415B3562981895FD73A7AD04867FF0178683A13B5E95213E5523E |
| 003_verify.sql | CA92395A4814B62AFB05E392361E961F914E2FC3624AC2097135CB6D8654D365 |
| 004_emergency_disable.sql | 6126BE32D6D70A6029467AA11BD3BF7838507A501746611F4CCFAC958B57783A |
| 005_rollback_review.sql | 8C5BC0EB53FBF063F02E747008CE65CDC1D465C002D2E2353349967E790C51E2 |

The old activation hash F1587077E3DDA568635474D5D6B8A4FEB5CD15C6B2917394172861BB1A74F3CC
described a smaller guard. The current source adds an independent postgres
database guard, expected-role/RPC existence and ACL checks, SECURITY DEFINER /
owner / empty search_path checks, exact worker login/instance/scope duration,
restricted login attributes and set-only membership, one-job RPC guard evidence,
Generation 1 activation/lineage checks and post-update history assertions. The
verifier was strengthened correspondingly. These are substantive changes and
the old execution checksum must not be reused. Current hashes match the updated
activation approval package, not an automatically inferred execution approval.

## Independent design assessment

The candidate uses one transaction with 5s lock and 60s statement timeouts. It
locks the singleton policy and Generation 2, reads/locks the allowlist and
Generation 1, revalidates state, and updates only policy admission and the
Generation 2 activation timestamp. No job/result/prescription/scope writes exist.
Generation 1 metadata is checked after activation. The preflight is weaker than
the full in-transaction guard, so passing it does not replace that guard.

Project identity and local runtime readiness are operational attestations, not
facts PostgreSQL can discover. Empty-search-path and one-job function-body
checks are compatibility checks, not a general proof of arbitrary function
semantics. Session/lock observations are snapshots; claim fencing and database
admission locks remain required. Credentials were not loaded for any worker.

## Hosted evidence

The configured service uses project login postgres.wyripeqruhvbksjfsvlr;
database/session role postgres; sslmode verify-full; client TLS 1.3 confirmed.
Exact 001_preflight.sql returned
AUTOMATIC_ROLLOUT_GENERATION_2_ACTIVATION_PREFLIGHT_OK and ROLLBACK.

Generation 2 disabled, zero admissions; Generation 1 one admission with valid
job/prescription/owner lineage and activation metadata. Exactly one allowlisted
account matched 9a1b7896-34cd-439b-9cfd-b26411086786. Claimable scopes, worker
sessions, active leases, processing jobs and conflicting locks: zero. Four
historical jobs remain queued; the protected job e584f43c-51d9-436b-bbe6-da5572d2cdca
remains unadmitted. Worker configuration and role attributes, exact set-only
membership, issuer owner/SECURITY DEFINER/search_path and anonymous/authenticated
issuer denial passed read-only inspection.

## Fresh backup and restore

UTC timestamp 20261116T043014Z (10:00:14 IST).
Archive: C:\Users\dahiy\MedDecode-Backups\generation2-final-20261116T043014Z\meddecode-public-auth-current.dump
Size: 964,758 bytes.
SHA-256: F55216B10C3C62B1F88A7877BD109CCA822D6642314ADE02463D92972B6F5B1F

ACL-restricted public/auth custom archive includes schema, data, functions,
policies and ACL definitions. Restored with no-owner into a fresh isolated
PostgreSQL 17 UTF-8 database using existing local placeholder roles.
Source/restore: prescriptions 6; jobs 7; results 2; review revisions 0;
admissions 1; scopes 2; generations 2; functions 52; policies 47. Disabled
Generation 2 and Migration 010 RPC presence also matched. Archive hash was
rechecked. Disposable database removed; temporary cluster stopped.

Limitations: global roles/memberships and original ownership replay, Supabase
platform/Auth service configuration, S3 objects and external infrastructure are
not recovered. Restored ACL definitions do not prove faithful global-role
behavior. Backup is retained outside Git without automatic deletion.

## Local test evidence and approval boundary

Existing retained test logs were inspected: activation 20 passed/0 failed;
admission/concurrency 3 passed/0 failed. Suites were not rerun in this readiness
phase. These totals agree with the user's completed-test checkpoint.

Request explicit approval only for current 002_activate.sql at the hash above,
with fresh safety checks immediately before execution and immediate 003_verify.sql
afterward using the same synthetic account UUID. Worker startup, feature flags,
upload/processing and emergency disable remain separate approvals. No automatic
rollback is permitted. Reminders remediation and demo seed remain outside scope.
