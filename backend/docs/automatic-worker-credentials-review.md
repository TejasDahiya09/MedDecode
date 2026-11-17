# Dedicated automatic worker credentials

The automatic login is not provisioned by this script. Do not run initialization until role and password provisioning have been explicitly approved and completed. The password is entered once through a hidden prompt and stored in a separate Windows DPAPI user-bound file under `%LOCALAPPDATA%\MedDecode\ScopedWorkerCredentials\automatic-worker.xml`; it does not overwrite the existing single-job store. The existing restricted AWS and catalogue credentials are read from the existing protected store only when loading the worker environment. Neither store belongs in the repository.

```powershell
# After separate hosted role/password approval; enter the dedicated password privately.
& .\scripts\automatic-worker-credentials.ps1 -Action Initialize
# After the reviewed RPC deployment, verifies TLS, login, role and privileges; read-only.
& .\scripts\automatic-worker-credentials.ps1 -Action Verify
# In the dedicated worker PowerShell process, loads credentials with worker flags false.
& .\scripts\automatic-worker-credentials.ps1 -Action Load
```

`Verify` expects `AUTO_WORKER_IDENTITY_OK`. It cannot pass before the new login and issuer RPC exist. `Load` returns `AUTO_WORKER_CREDENTIALS_LOADED_WORKER_DISABLED`; it does not check the remote service or start a worker. Set required runtime paths and AWS region/bucket from separately verified process configuration. Enabling worker, issuer, policy or website flags requires the separately authorized activation stage.

After separate approval for a controlled local V3 startup, `LoadDevelopment` resolves and validates the repository's `intelligence\.venv\Scripts\python.exe` and `intelligence` directory, then places those paths in the current process environment. The root launcher requires them when constructing the separate worker environment. The V3 feature flag remains a separate explicit process setting; this action does not start the worker.

To remove only the automatic database credential, run `& .\scripts\automatic-worker-credentials.ps1 -Action Remove`. This does not change hosted credentials, the single-job store, AWS credentials, or catalogue credentials. To replace the automatic password locally, remove only this store and initialize it again; changing the hosted password requires separate approval. Never put secrets in commands, source files or logs.
