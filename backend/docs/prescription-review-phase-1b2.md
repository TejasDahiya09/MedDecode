# Prescription Review Phase 1B.2

## Outcome

Phase 1B.2 replaces the Phase 1B.1 in-memory runtime default with a request-scoped,
owner-authenticated PostgREST RPC repository. The reviewed PostgreSQL migration
provides atomic draft mutation, confirmation, reopen, worker initialization,
job binding, and stale-result fencing without granting direct table mutation to
`authenticated` or the scoped worker.

No hosted database object or hosted application record was changed.
`MEDDECODE_PRESCRIPTION_REVIEW_V3_ENABLED` remains disabled by default.

## Runtime integration

- `PostgresPrescriptionReviewRepository` uses only the authenticated user's
  request-scoped Supabase client. It never sends a client-supplied owner ID.
- Routes construct the repository after authentication, preserving `auth.uid()`
  ownership enforcement for every RPC.
- Provider errors and malformed provider payloads are reduced to stable,
  non-sensitive repository errors.
- `createInitialReviewFromIntelligence` deterministically maps a validated
  Contract v1 result into an initial draft. It does not mutate Contract v1 and
  does not fabricate coordinates, generic identities, dose, or route.

## Reviewed PostgreSQL boundary

Authenticated RPCs derive ownership from `auth.uid()` and use row locks plus
revision/lock-version compare-and-swap checks:

- `meddecode_has_owned_prescription_review_v1`
- `meddecode_get_prescription_review_v1`
- `meddecode_list_prescription_review_revisions_v1`
- `meddecode_get_prescription_review_evidence_v1`
- `meddecode_get_review_intelligence_request_v1`
- `meddecode_apply_prescription_review_draft_v1`
- `meddecode_confirm_prescription_review_v1`
- `meddecode_reopen_prescription_review_v1`

Worker RPCs are granted only to `meddecode_scoped_worker`. They require the
expected `SET ROLE`, derive job ownership from existing job/prescription rows,
and require a live scope matching `session_user`:

- `meddecode_initialize_prescription_review_v1`
- `meddecode_bind_review_intelligence_job_v1`
- `meddecode_assert_current_review_result_v1`

The `prescription_result_review_fence` trigger rejects a V3 result unless its
revision, fingerprint, job, current status, and bound state still match under a
row lock. Legacy result rows with both review-binding columns null retain their
existing behavior.

All functions are `SECURITY DEFINER` with fixed
`search_path=pg_catalog,public`. Helper and trigger functions have no application
execution grant. Neither authenticated users nor the scoped worker receive
direct review-table mutation rights.

## Local PostgreSQL 17 evidence

Database: `meddecode_review_1b2_20261115`

Cluster: the pre-existing, loopback-only private PostgreSQL 17 cluster on
`127.0.0.1:55439`. The prior `scoped_worker_verify` evidence database was not
modified.

Evidence:

- Migration executed transactionally as the representative `postgres`
  `NOSUPERUSER` deployment identity.
- Independent verification returned `PRESCRIPTION_REVIEW_VERIFY_OK`.
- Restricted initialization through `meddecode_scoped_login` plus
  `SET LOCAL ROLE meddecode_scoped_worker` succeeded only for a live matching
  scope.
- An unrelated owner could not pass the ownership RPC.
- Two simultaneous updates using revision 1 / lock version 0 produced exactly
  one commit, one `review_stale` rejection, and final lock version 1.
- Rollback executed successfully; remaining review tables, review functions,
  and result-binding columns were each counted as zero.
- The private cluster was stopped after verification. The disposable database
  remains for controlled inspection or cleanup.

## SQL hashes

- `001_preflight.sql`: `945cc8b51956e4dfab819259eac61b9ef3a90ff35ae20b85416ceb92ad8027af`
- `002_up.sql`: `2602c69696983bc1a5d64f7fd93c667d237d74e7a934886b6ba579dc1427bf05`
- `003_verify.sql`: `bb39ffb12ff20c1b8b2c5bcfddc43a3a36814296e4295ebc9940fed17d1f2ff4`
- `004_rollback_review.sql`: `183f5bc39df22b5c4abef8dd93f7902c0217474a79611f94d9782fa3cf14d8db`

Any edit invalidates these hashes and requires a new review.

## Verification

- Backend tests: 536 passed, 0 failed.
- Backend TypeScript typecheck: passed.
- Backend production build: passed.
- `git diff --check`: passed; only existing line-ending conversion warnings
  were reported.

## Deployment and rollback boundary

Hosted deployment is not authorized. A future approval must name the four SQL
files and exact hashes above, require the read-only preflight marker, execute
only `002_up.sql` once with error-stop, and require independent
`PRESCRIPTION_REVIEW_VERIFY_OK` afterward.

Rollback is intentionally separate and destructive to review data. It must not
be executed automatically. Before any hosted rollback, inventory and preserve
review rows, disable the V3 feature flag, stop V3 writes, and obtain explicit
approval for the exact rollback hash.

The current `prescription_intelligence_results` one-result-per-prescription
behavior is preserved. A future requirement to retain multiple intelligence
results across reopened review revisions needs its own data-model review; this
migration does not silently broaden that contract.
