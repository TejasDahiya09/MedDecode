# Official catalogue read RPC

This migration adds a separate authenticated read path over
`official_catalogue`. It does not replace the legacy `public.medicines` RPCs.
Official IDs are `official_catalogue.formulation_id` values and are marked in
responses with `catalogue_source` and `id_namespace`; they are not legacy
medicine IDs. Unlinked prices and aliases remain empty, and manufacturer data
is null until its formulation relationship is verified.

The functions are owned by a non-login role with column-level SELECT on only
the fields used by the RPCs. Client roles receive EXECUTE on the functions but
no schema usage or direct table access.
The preflight requires the six queried catalogue tables to have row-level
security disabled, matching the verified local schema; review and resolve any
hosted RLS difference rather than weakening the checks.
The owner role is cluster-wide and requires `CREATEROLE`; the migration grants
it `CREATE` on `public` only while creating its functions, then revokes that
privilege. Because the hosted migration role is not authorized to grant on
Supabase-managed `auth`, the migration creates a locked-down
`SECURITY DEFINER` wrapper owned by `postgres` that calls `auth.uid()` with an
empty search path. Only the restricted RPC owner can execute that wrapper; it
receives no direct `auth` privileges. Hosted role-provisioning support and
cleanup must still be reviewed before deployment.

PostgreSQL 17 grants a non-superuser CREATEROLE creator an automatic,
bootstrap-granted ADMIN membership in the newly created role. The migration
adds a separate SET-only grant for function creation, then revokes only that
grant. Verification permits only the bootstrap grant to `postgres` with
ADMIN=true, SET=false, INHERIT=false. A superuser-created local fixture may
have no automatic membership. The residual ADMIN privilege is significant:
the trusted deployment administrator can grant itself SET access again. It
cannot be removed by that non-superuser administrator; monitor and restrict
that identity, and do not deploy without explicit acceptance of this trade-off.
The complete revised migration and verifier passed locally in a separate
PostgreSQL 17 cluster as a non-superuser `postgres` with CREATEROLE. Synthetic
authenticated search/detail, anonymous denial, direct-table denial and wrapper
denial passed. Additional transaction-scoped tests rejected temporary SET,
INHERIT and extra-member grants and confirmed rollback. A forced conflict in
the preceding candidate rolled the migration back before the ACL-order fix;
that initial attempt and its schema snapshot remain in the isolated cluster.
Hosted role attributes, grants, schema and authentication remain unverified.

## Isolated PostgreSQL test plan

Do not run these tests against `meddecode_job_test`,
`meddecode_worker_test`, `meddecode_backup_restore_test`, or a hosted database.
Use the uniquely named test database
`meddecode_catalogue_rpc_runtime_20261113_01`. It was separately approved,
created, verified empty, and used for the completed isolated runtime suite.
Do not reset, drop, or reuse it for a fresh run without separate approval.

Use the checked-in official catalogue schema migrations, not reconstructed
table definitions. On the approved, empty local test database, run in order:

1. `test/00_auth_fixture.sql`
2. `202611130001_official_catalogue_source_aware/001_up.sql`
3. `202611130002_official_catalogue_link_replay_identity/001_up.sql`
4. This migration's `001_preflight.sql`, `002_up.sql`, and `003_verify.sql`
5. `test/10_synthetic_fixture.sql`
6. `test/20_behavior.sql` and `test/30_unauthorized.sql`

Each test script requires the runner-supplied `test_database` variable and
checks `current_database()` before writing or reading. The auth fixture mirrors
the verified local `auth.uid()` claim lookup and is test-only. Fixtures are
synthetic and insert-only; the completed target must not be reset or cleaned.

The SQL tests cover authenticated search/detail, stable official identifiers,
component strengths, missing ingredients, response allowlists, empty prices,
input bounds, missing IDs, anonymous denial, and direct-table denial.
`003_verify.sql` checks effective anonymous and PUBLIC EXECUTE privileges and
the owner role's restricted attributes.
