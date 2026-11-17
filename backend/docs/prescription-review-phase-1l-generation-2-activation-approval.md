# Generation 2 activation approval package -- not executed

## Scope and artifacts

This is a standalone operational activation package for Generation 2 created by
Migration 008. It is not a schema migration and was not run against hosted
Supabase.

| Artifact | SHA-256 |
| --- | --- |
| `001_preflight.sql` | `6B78301E0566733313B286D21C33D481AF060E7DC2B505F7AFE00ABA9ECCD578` |
| `002_activate.sql` | `3C03CAB35D8415B3562981895FD73A7AD04867FF0178683A13B5E95213E5523E` |
| `003_verify.sql` | `CA92395A4814B62AFB05E392361E961F914E2FC3624AC2097135CB6D8654D365` |
| `004_emergency_disable.sql` | `6126BE32D6D70A6029467AA11BD3BF7838507A501746611F4CCFAC958B57783A` |
| `005_rollback_review.sql` | `8C5BC0EB53FBF063F02E747008CE65CDC1D465C002D2E2353349967E790C51E2` |

The artifacts are in
`backend/database/integration-migrations/202611160011_automatic_rollout_generation_2_activation_v1/`.

## Required caller inputs and limits

`001_preflight.sql` and `002_activate.sql` require:

- `meddecode_expected_database`
- `meddecode_expected_project` (must be `wyripeqruhvbksjfsvlr`)
- `meddecode_expected_test_account` (the independently verified synthetic UUID)
- `meddecode_v3_local_readiness=PASS`

`003_verify.sql` also requires the exact `meddecode_expected_test_account`
value. Use the same independently verified synthetic UUID for activation and
verification; do not substitute a local-fixture UUID.

The activation SQL now independently requires `current_database() =
'postgres'` as well as equality with the expected-database input. It verifies
the policy's actual `worker_login`, `worker_instance_id`, and `scope_seconds`
columns against `meddecode_auto_worker_login`,
`meddecode-auto-worker-001`, and `1200`. It also verifies the login's
non-privileged role attributes and set-only membership in
`meddecode_scoped_worker`.

Migration 008 has no `max_jobs` policy column. Its one-job-per-generation
limit is enforced by serializing submissions on the policy row and rejecting
a new admission when the current generation already has a row in
`meddecode_auto_authorized_jobs`. The activation checks the real
`rollout_generation` ledger column, requires zero Generation 2 admissions,
and confirms the deployed submission function retains that Migration 008
guard. The independent verifier checks the same contract; the local
concurrency test exercises it.

## Atomic behavior

The activation transaction locks the singleton policy and Generation 2 row,
then rechecks the disabled Generation 2 state, exact worker configuration,
zero Generation 2 admissions, exactly one matching allowlisted account,
Generation 1 ledger bindings and history, zero claimable automatic scopes,
zero automatic-worker sessions, and zero active leases. It updates only the
Generation 2 activation timestamp and singleton policy state. It creates no
jobs, prescriptions, results, or scopes.

Migration 008 creates the Generation 1 history row from the prior policy
activation, but does not define a Generation 1 retirement step for Generation 2
activation. This package therefore preserves the existing `retired_at` value
rather than assuming or setting one. It verifies the generation's activation
record and that its historical admissions still match their
job/prescription/owner records; neither the Generation 1 row nor its admission
ledger is rewritten.

The independent verifier requires the same expected synthetic UUID, checks
that anon cannot execute either automatic issuer RPC, and verifies both
functions remain owned by `postgres`, `SECURITY DEFINER`, and fixed to an
empty `search_path`. It also reports Generation 1 and Generation 2 admission
counts without exposing prescription or account data.

The emergency artifact disables new admission and disables only enabled scopes
linked to the current generation's ledger entries and configured automatic
worker identity. It preserves jobs, admissions, prescriptions, results, and
historical generations. It is not authorized for hosted use under this package.

## Disposable PostgreSQL 17 evidence

`backend/scripts/run-generation2-activation-suites.ps1` completed with exit
code 0 against the existing private PostgreSQL 17.11 cluster. The activation
suite passed 20/20 cases, including emergency disable; the admission and
concurrency suite passed 3/3 cases. Both suite process exit codes were 0. The
single runner owned cluster startup and graceful shutdown, and retained suite
logs under the private cluster's `test-logs` directory.

The runner connected read-only to all five connectable databases. None had the
`amcheck` extension installed, so it did not install extensions or modify
schemas; database checks were connection-level only. PostgreSQL WAL recovery
completed, and the cluster shut down cleanly after the run. The data directory
has page checksums disabled, so this is not a full page-level integrity proof.

Verified activation cases include:

- Direct database guard, preflight, wrong project/database, and non-admin
  identity rejection.
- Exact worker login/instance/scope, issuer RPC privilege/security, admission,
  allowlist, claimable-scope, active-lease, and active-worker-session barriers.
- Concurrent activation admits exactly one activation; the independent
  verifier checks the expected synthetic UUID and Generation 1 history.
- Emergency disable turns off admission and disables the synthetic current
  generation scope while preserving Generation 1 history.

The synthetic baseline models deployed Generation 008 structures and a
signature-compatible Migration 010 RPC. It is not a substitute for a fresh
hosted read-only preflight.

## Required separate hosted approval

Before hosted activation, obtain explicit approval for only the exact
`002_activate.sql` hash above, after a fresh TLS verify-full service identity
check, exact `001_preflight.sql`, allowlist confirmation, zero-session/lease/
scope barrier, and backup confirmation. Separate approval is still required for
local feature flags, worker credential loading, restricted worker start, and a
fictional prescription test. Do not run `004_emergency_disable.sql` or
`005_rollback_review.sql` automatically.
