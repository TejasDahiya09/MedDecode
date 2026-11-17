# Synthetic worker isolation: proposal only

Status: **not implemented, tested, or approved for hosted deployment**.
Keep the production worker disabled. Do not resubmit or process the previously
cancelled prescription or job.

## Why the existing runtime is not isolated

`claim_next_prescription_analysis_job_v1` selects any eligible queued job.
`recover_expired_prescription_analysis_jobs_v1` can mutate any expired
processing job, and the normal worker runs recovery before its first claim.
An empty queue or a client-side ID filter is not a durable isolation boundary.

The five deployed RPCs require `current_setting('role') = 'meddecode_worker'`.
Granting that role to a test login would also allow the unrestricted claim and
recovery RPCs. A security-definer wrapper cannot safely assume that role using
`SET ROLE` inside the function. No existing production worker login, role,
or RPC grant should be reused as the isolation mechanism.

## Proposed database-enforced boundary

Prepare a **separately reviewed migration**, not a modification to any applied
migration:

1. A separate NOLOGIN, NOINHERIT smoke capability role and a dedicated
   restricted login with only SET membership. The login must not belong to
   `meddecode_worker` or inherit public table or column access.
2. A private, RLS-enabled registry owned by the migration owner. Each enabled
   authorization binds exactly one approved job UUID, prescription UUID,
   synthetic owner UUID, worker instance and an expiry. Ordinary users and
   the smoke role cannot read or write the registry. The old cancelled job and
   prescription must be explicitly excluded.
3. Separate security-definer, fixed-search-path smoke RPCs, executable only by
   the smoke role and inaccessible to PUBLIC, anon, authenticated and the
   ordinary worker. Claim must select the explicitly registered job, verify the
   owner/prescription lineage and queued state, and lock job then prescription.
   Recovery must select only that same registered job and only if its lease has
   expired. A client-supplied job ID alone is not authorization.
4. Heartbeat, completion and failure must also enforce the registry and fencing
   before mutating the exact registered job. Preserve the existing atomic
   finalization and Contract v1 validation. Review how to share core logic:
   nested security-definer calls still see the caller's role setting, so the
   current ordinary-worker role checks will reject the smoke role. Merely
   calling the deployed functions from a wrapper will not work. Any shared
   helper extraction or tightly guarded role-aware internal entry point must
   preserve the existing production grants, signatures and behavior and receive
   independent security review.
5. A separate, disabled-by-default smoke entry point injects the scoped
   transport into the existing worker composition. It must never invoke the
   unrestricted claim or recovery RPC. Normal startup behavior stays intact.
   All five operations must reject an unregistered ID, including forged
   heartbeat, failure and completion requests.

## Required local proof before any hosted proposal

Use only an approved disposable PostgreSQL database and synthetic fixtures.
Test concurrent insertion of unrelated jobs during claim, both lock race
orders, expired unrelated jobs during recovery, fencing after expiry, wrong
owner/prescription/worker, registry expiry and revocation, ambiguous transport
errors, duplicate finalization, rollback, and absence of all direct table
privileges. Prove every denied role and PUBLIC lacks direct access to both
ordinary and smoke RPCs as appropriate. Verify production worker behavior is
unchanged. Review role creation and PostgreSQL 17 membership implications
under a non-superuser deployment identity.

Before requesting hosted execution, prepare exact migration files and hashes,
fresh backup, registry provisioning and removal procedures, credential handling,
synthetic fixture identifiers and a no-retry stop procedure. Hosted schema
changes, creation of the test login, registry insertion, synthetic uploads and
jobs, and worker activation each need their own explicit authorization. No
hosted changes or synthetic writes are authorized by this proposal.
