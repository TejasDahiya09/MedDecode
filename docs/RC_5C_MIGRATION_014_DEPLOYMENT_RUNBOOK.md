# RC-5C Migration 014 deployment runbook

Status: blocked pending a fresh, current, independently restore-tested backup and separate hash-specific authorization. This runbook is not execution approval.

## Immutable candidate

Directory: `backend/database/integration-migrations/202611190014_current_object_privilege_hardening_v1/`

| File | SHA-256 |
| --- | --- |
| `001_preflight.sql` | `C659FB9CF9D0DC693F8BFAC2DEB9E7D5C92885218B3403C26E5ED73FEFFB278F` |
| `002_up.sql` | `C76FE4862A4C602AF8C92DD24DA5C2B3DE41C1F34F566BF50573D5C1F9C72E03` |
| `003_verify.sql` | `E78D54D74718613AEF22A83025B029BAD7EF578E5F687604197CBD04A1D04303` |
| `004_rollback_review.sql` | `37E219EE373B0FB2F66CFABABFCE448C084646194549C85D9AE83AE50EDA2376` |

## Authorization and recovery gates

1. Obtain a fresh application-database archive after the final preflight. Store it outside Git in a restricted directory.
2. Record UTC time, byte size, SHA-256, PostgreSQL versions, archive inventory, application-object inventory, ACL definitions, and aggregate counts.
3. Restore the archive into a new task-owned PostgreSQL 17 environment. Compare schema, functions, policies, constraints, indexes, ACL metadata, and aggregate counts. Stop and remove only task-owned restore resources.
4. Record limitations: a logical application archive does not independently recover Supabase global roles, managed platform configuration, original owner/ACL execution context, Auth platform state, S3/KMS objects, or external service configuration.
5. Require an independent reviewer to accept the recovery evidence and the forward-only recovery boundary.
6. Obtain one explicit authorization naming `002_up.sql`, its exact hash above, project `wyripeqruhvbksjfsvlr`, and database `postgres`.

## Final preflight

1. Recalculate all four hashes; stop on any mismatch.
2. Connect through the reviewed project-qualified libpq profile with `sslmode=verify-full` and the reviewed CA. Require database, session user, and effective role `postgres` and the expected project-qualified endpoint.
3. Begin a read-only transaction with 10-second statement and 2-second lock timeouts.
4. Execute the exact `001_preflight.sql`; require `CURRENT_OBJECT_PRIVILEGE_HARDENING_PREFLIGHT_OK` and its rollback.
5. Confirm all 27 tables, four function signatures, nine enabled trigger dependencies, expected owners/RLS states, current ACL matrices, worker isolation, and `service_role` privileges remain unchanged from review.
6. Stop on drift, missing dependencies, changed grants, a failed backup check, an unexpected session identity, or TLS failure.

## One-time deployment

Only after the preceding gates and separate approval, execute the exact `002_up.sql` as supplied. It contains one bounded transaction. Do not split it, edit it, retry it after an ambiguous failure, combine it with Migration 015, or run rollback SQL automatically.

Expected changes are limited to revoking `TRUNCATE`, `REFERENCES`, `TRIGGER`, and `MAINTAIN` from unintended API/worker roles on the 27 named tables and revoking direct EXECUTE on the four reviewed trigger functions. CRUD, RLS, ownership, data, constraints, function bodies, trigger execution, `service_role`, and worker RPC grants must remain unchanged.

## Independent post-deployment verification

1. Open a new read-only session and run exact `003_verify.sql`.
2. Require `CURRENT_OBJECT_PRIVILEGE_HARDENING_VERIFY_OK`.
3. Independently confirm the 27-table privilege matrix, no PUBLIC/worker table access, preserved CRUD and `service_role`, four direct function revocations, all nine triggers enabled, unchanged RLS/ownership, and unchanged aggregate application counts.
4. Capture sanitized execution records, timestamps, SQL hashes, marker, and reviewer signoff.
5. Stop application rollout and preserve evidence if verification fails. Do not infer partial success or apply compensating grants.

## Failure and recovery boundary

`004_rollback_review.sql` is read-only. Regranting the removed broad privileges is not a safe automatic rollback. Before commit, SQL failure rolls back atomically. After a successful commit with failed verification, stop, preserve evidence, assess application compatibility, and choose only between a separately reviewed forward correction or an explicitly authorized restore. Recovery must be catalog-derived, not guessed `GRANT ALL`.
