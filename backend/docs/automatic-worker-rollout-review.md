# Automatic scoped-worker rollout: review only

Nothing in this file authorizes a hosted change or worker start. Run the read-only preflight against the independently verified project and a current verified backup. Verify all hashes against the approved review. Stop on any mismatch, unexpected active job or privilege, SQL error, or verification failure. Do not retry failed DDL blindly.

Order for a future, separately approved deployment: `automatic-worker-preflight-review.sql`; `automatic-worker-role-provision-review.sql`; `automatic-worker-authorization-review.sql`; then `automatic-worker-verify-review.sql`. Role provisioning sets no password. The tested non-superuser postgres identity requires its existing ADMIN=true, SET=false, INHERIT=false creator membership on meddecode_scoped_worker. The role migration creates meddecode_auto_worker_login, NOINHERIT, SET-only membership; the issuer is the scoped RPC executing under that role, not a broad privileged application identity. Its scope is admission-ledger jobs owned by the submitting authenticated user, never arbitrary queue jobs. The candidate creates a disabled policy and empty ledger; default concurrency is one and scope TTL is 1,200 seconds, renewed every 30 seconds. Verify no table access, no unrestricted claim/recovery EXECUTE and correct role session identity. A separately approved, private password-provisioning step and verified TLS session-pooler login are required.

Before activation, deployment review must cover default ACLs and any unrelated direct grants, all five scoped RPCs, lock ordering and long-running issuer/heartbeat races, server identity, backup freshness and an operational rollback for admitted jobs. This test package has only been run in a rolled-back local transaction with the database-name guard adapted to the isolated test database and creator membership simulated. It is not evidence of hosted readiness.

For a future approved deployment, the backend and worker are separate processes. Supply required database and AWS credentials from the deployment host's protected secret mechanism; never paste them into a command or tracked file. The existing prepare-scoped-hosted-readiness.ps1 sets the *single-job* login and is not an automatic-login credential loader. Do not use that login as the automatic login. After the dedicated login and its TLS connection are verified and the database policy is explicitly enabled, configure a dedicated worker process with:

```powershell
$env:WORKER_RPC_MODE='scoped'
$env:WORKER_AUTOMATIC_AUTHORIZATION_ENABLED='true'
$env:PROCESSING_WORKER_INSTANCE_ID='meddecode-auto-worker-001'
$env:WORKER_SINGLE_ATTEMPT='false'
$env:PROCESSING_WORKER_ENABLED='true'
npm run worker:start
```

Set WORKER_DATABASE_URL to the dedicated automatic login and configure the CA file, S3 worker identity and Python/catalogue variables required by workerStartupConfig; the worker fails closed when those are missing. In the separate backend process only, enable PRESCRIPTION_AUTO_SUBMIT_ENABLED after approval; configure VITE_PRESCRIPTION_AUTO_SUBMIT_ENABLED at frontend build time if the opt-in is desired. Do not turn on a general worker in the backend process. Keep default flags false until activation approval.

Emergency disable: stop the worker process, set PRESCRIPTION_AUTO_SUBMIT_ENABLED=false in the backend process and restart that process, then, only with separately authorized hosted access, run `automatic-worker-emergency-disable-review.sql` through the verified admin connection with ON_ERROR_STOP. This disables the policy and every outstanding scope for the dedicated automatic login without changing other logins' scopes. Confirm no automatic scope remains enabled and no worker remains. Existing in-flight leases/results require investigation; do not delete or rewrite jobs. Policy disabling alone does not revoke a previously issued scope. Do not drop the ledger or roles while admitted or processing jobs remain.

After a separate explicit activation and synthetic-write approval, use one fictional document through the authenticated website, verify its owner/job and S3 lineage, observe a single claim, genuine OCR, Contract v1 persistence and results/history, then verify the pre-existing unknown job and earlier completed record remain unchanged. No hosted test has yet been performed for automatic mode.
