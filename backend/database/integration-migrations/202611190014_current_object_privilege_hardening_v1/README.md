# Current object privilege hardening v1

This forward-only candidate removes only `TRUNCATE`, `REFERENCES`, `TRIGGER`,
and `MAINTAIN` from untrusted roles on 27 existing `public` tables and removes
direct execution of four trigger functions from PUBLIC/API/worker roles.

It does not change CRUD grants, RLS policies, table ownership, function bodies,
default privileges, `service_role`, `supabase_admin`, data, constraints, or
worker RPC grants.

Deployment order, after separate authorization:

1. verify project/database/session identity and `sslmode=verify-full`;
2. create and restore-test a fresh backup;
3. run `001_preflight.sql` and require its marker;
4. execute `002_up.sql` once as one bounded transaction;
5. run `003_verify.sql` independently;
6. do not automatically run `004_rollback_review.sql`.

The rollback review is deliberately read-only. Regranting the removed security
privileges is not a safe rollback. Any compatibility regression must be fixed
with a new, narrowly scoped forward migration.
