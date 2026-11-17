# Migration 010 local security report

## Scope

`202611160010_prescription_review_initial_completion_v1` was tested only in a disposable PostgreSQL 17 database on `127.0.0.1:55440`. No hosted connection, worker, feature flag, generation activation, job claim, or database mutation occurred.

## Corrections

- Replaced a rendered-function-text search-path check with the canonical `pg_proc.proconfig` check.
- Qualified the `ai_jobs` lock query to remove a PL/pgSQL column ambiguity.
- Added explicit attempt-count fencing to the completion RPC.
- Removed successful duplicate completion replay; terminal jobs now reject a second completion.
- Required the current automatic policy to be enabled before completion.
- Corrected local test paths for the genuine confirmed-review Python adapter.

## Local evidence

- Migration preflight marker: `PRESCRIPTION_REVIEW_INITIAL_COMPLETION_PREFLIGHT_OK`.
- Independent verification marker: `PRESCRIPTION_REVIEW_INITIAL_COMPLETION_VERIFY_OK`.
- Functional marker: `PRESCRIPTION_REVIEW_INITIAL_COMPLETION_FUNCTIONAL_OK`.
- PG17 integration test: one positive completion, rejected wrong worker, wrong attempt, stale generation, wrong prescription/job binding, expired scope, expired lease, missing draft, missing admission, disabled-policy, and Generation 1 historical-admission cases. Administrator snapshots confirmed rejected calls did not alter the job or create intelligence results. Actual `anon` and `authenticated` login roles were independently denied EXECUTE.
- Two independent restricted-login sessions produced one completion and one rejection; no intelligence result was inserted.
- Confirmed-review Python Layers 4-5 test passed using the actual local interpreter.

## Security properties

The five-argument RPC is `SECURITY DEFINER`, owned by `postgres`, with `search_path=pg_catalog, public`. Execute is granted only to `meddecode_scoped_worker`; `PUBLIC`, `anon`, `authenticated`, and `meddecode_worker` are revoked. The worker role has no direct application-table mutation privileges.

## Rollback and deployment boundary

`004_rollback_review.sql` is guarded and must not run where initial-review provenance exists. The local security matrix is complete; hosted read-only preflight and any deployment require a separate approval after final review of the hashes below.

## Final hashes

Recalculate before any approval; this report is evidence for the current local candidate only.

## Cleanup

The disposable database is removed and the local Phase 1F PostgreSQL cluster is stopped after testing.
