# Queued prescription job cancellation

Apply only after the submission migration and its verification. Run the
cancellation preflight, migration, and verification before cancelling a
specific job. The two pending worker preflight files must also include the
accompanying cancelled-status compatibility changes before those worker
migrations run. The worker stays disabled; migration alone does not cancel a job.

The authenticated RPC takes both prescription and job UUIDs, locks the job
before the prescription, and records the owner and time. It changes only queued
jobs to cancelled, returns the prescription to uploaded, and leaves the object,
result, and job history intact. The submission RPC can create a new job after
cancellation; it will not reuse cancelled jobs. A repeated call for the old job
returns the original cancellation and does not cancel a later job. A preexisting
result blocks a new cancellation. A claim that has already won blocks cancellation.

The result and history clients must tolerate the additional cancelled job status;
frontend changes are not included here.

## Recovery considerations

Disable cancellation access first by disabling the API route and revoking RPC
execution, subject to a separately authorized change. Preserve cancellation
audit rows. A rollback to the four-status constraint is unsafe once any job is
cancelled; do not silently relabel those jobs or delete their audit history.
Forward repair or a separately reviewed archival and status conversion plan is
required. If no cancellation has ever occurred, a separately reviewed
transaction may remove the new RPC and empty audit table and restore the original
status constraint after verifying dependencies and grants. Do not remove the
submission migration or worker roles as part of this recovery.
