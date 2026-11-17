# Reminders Security Fix V2 — local verification

## Final hardening checkpoint — supersedes earlier test counts and hashes below

The final candidate uses read-only independent verification with a 10-second
statement timeout and 2-second lock timeout. Eight explicit policy expectations
compare table, name, command, authenticated role OID array, permissive mode,
USING and WITH CHECK using pg_policy and pg_get_expr. Only whitespace is
normalized; NULL, additional clauses, different commands and role drift reject.
Expected expressions are derived from the original Reminders migration except
for the two explicitly corrected reminder Cabinet policies.

Both table owners must be postgres and both tables must retain RLS. Direct
PUBLIC ACLs and direct/effective anon and worker table/column access reject.
Authenticated must have CRUD only, with no grant options, elevated table
privileges or direct/inherited column REFERENCES. Relevant named worker roles
and non-superuser members of the restricted worker roles are discovered from
pg_roles and pg_has_role. Membership, role attributes, schema USAGE/CREATE and
default ACL diagnostics are returned, never changed. The same exact checks run
inside 002_up.sql before commit, preserving atomic rejection of unexpected drift.
001_preflight.sql already uses explicit EXISTS assertions for required policy
metadata; 002_up.sql now explicitly rejects NULL source policy expressions.

Final local run: **29 tests passed, zero failures/skips**, including all 14
independent-verifier rejection cases: missing policy, NULL expression, wrong
correlation, extra unsafe clause, wrong role, wrong command, restrictive mode,
worker table grant, worker column grant, inherited column REFERENCES, direct
column REFERENCES, anon TRUNCATE, wrong owner, disabled RLS. Every damaged
state is applied in a local transaction and rolled back; administrator data
snapshots and a fresh verifier pass confirm restoration. Missing worker fixtures
are created only inside the test transaction and rolled back. No persistent
global memberships/defaults are altered. The disposable database is dropped.

Backend production build PASS. Backend typecheck still reports the same eight
existing errors listed below, none in the new test. git diff --check PASS.

Final SHA-256 values (earlier hashes below are historical, not deployment inputs):

- 001_preflight.sql: EFDC74FA39F6F10D3D57907D6F448298CFE26CD0F6A345712BF388AB8CDAA3D5
- 002_up.sql: 79C60A6C5676435FF9BCC33A1083A0486D86F9BD80350C188A843361254070C2
- 003_verify.sql: EB1FFFB46D7AB48899C90C3B03821241DC46EAFBA42F98AC87ACB7B4B71F2D78
- 004_rollback_review.sql: 5D932647DA879041059F37FE3284C63B295EB5D5EDF0C2A963BD23EBA8434542

GO for a new independent review of this candidate. Hosted deployment still
requires separate explicit approval after a fresh restore-tested current-schema
backup and authorized read-only identity/TLS, ACL and membership checks.
Recalculate all hashes; run 001_preflight.sql first; apply 002_up.sql once with
error-stop; immediately run 003_verify.sql. Stop on failure. Never execute
004_rollback_review.sql automatically or reinstate vulnerable grants/policies.
No hosted SQL, seed, worker or generation change occurred during this phase.

No hosted SQL, seed application, worker startup or generation activation was performed.

## Root cause evidence

The existing local recovery archive
`MedDecode-Backups/generation2-activation-20261115T234619Z/meddecode-public-auth-current.dump`
records both tables owned by postgres and explicit GRANT ALL to anon,
authenticated and service_role. The previously observed anon table privileges
are therefore explained by direct table ACL entries, without assuming PUBLIC
or inherited access. This evidence is dated; current global role memberships and
default privileges were not queried because hosted SQL is prohibited.

Migration 012 preflight exposes table ACLs, column ACLs, direct memberships,
role attributes, schema privileges and defaults for independent inspection.
The migration touches only these two table ACLs/column ACLs and the two
defective reminder INSERT/UPDATE policies. It preserves service_role grants.
It revokes PUBLIC/anon/authenticated table and column grants, then restores
authenticated CRUD only. Effective worker/anon privilege checks run before
commit; unexpected inherited access aborts the whole repair. No global
membership or default privilege is modified.

## RLS correction

The reminder policies enforce `(SELECT auth.uid()) = user_id` and
`medicine_id IS NULL OR EXISTS (...)`, with
`mc.id = public.medication_reminders.medicine_id` and
`mc.user_id = (SELECT auth.uid())`.
The independent verifier inspects pg_policy/pg_get_expr, not source text.

## Verification

Command from repository root:
`npx --prefix backend tsx --test backend/tests/reminders-security-v2.pg17.test.ts backend/tests/reminders.test.ts backend/tests/reminders-migration-and-persistence.test.ts`

Result: 15 tests passed, zero failed/skipped. The SQL integration case uses a
new local PostgreSQL 17 database on 127.0.0.1:5433, real PostgreSQL SET ROLE
authorization on separate checked-out connections, synthetic users/cabinet
rows, and administrator snapshots for anonymous denial checks. It exercises
anonymous SELECT/INSERT/UPDATE/DELETE/TRUNCATE denial on both tables,
authenticated CRUD and TRUNCATE denial, REFERENCES/TRIGGER effective denial,
cross-owner reminder INSERT/UPDATE and dose-log INSERT/UPDATE denial,
same-owner and NULL links, duplicate dose rejection, reconnect persistence,
incorrect stored policy detection, reapplication rejection, and inherited
privilege rollback. The disposable database is dropped in finally.

Local SQL files replace only the postgres database-name guard with the disposable
database name; the production files remain guarded for database postgres.
No unauthenticated application login was performed: SET ROLE exercises database
privileges, not Supabase Auth token issuance.

Backend production build passed. Backend typecheck reports eight existing
test/configuration errors outside the new test: confirmed-review import.meta,
worker transport optional parameters, initial completion readonly parameters,
worker error-code union, two Reminders import paths and mock Response typing.
git diff --check passed with existing line-ending warnings.

## Hashes

- 001_preflight.sql: EFDC74FA39F6F10D3D57907D6F448298CFE26CD0F6A345712BF388AB8CDAA3D5
- 002_up.sql: 311C221760744E00D1A06B91906D4290585FDAA67B4FB38FA1365C01C4B92B82
- 003_verify.sql: 79E92AC9627A51E816FBD9EC5EAF52C5D7DFD73FC6B463EE8257465C0D17AA36
- 004_rollback_review.sql: 5D932647DA879041059F37FE3284C63B295EB5D5EDF0C2A963BD23EBA8434542

## Boundary and risks

GO for independent deployment review; hosted execution remains NO-GO until
fresh catalog evidence and recovery readiness are separately authorized and
checked. Historical archive ACL evidence cannot establish current membership
or default-ACL state. Policy matching is intentionally strict and may reject
unexpected drift. Rollback review performs no destructive action and never
restores vulnerable grants or policies. No remediation or demonstration seed
has been deployed.
