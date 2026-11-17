[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidateSet('Claim','Finalization')][string]$Suite,
  [switch]$ApproveSyntheticWrites
)
# Only a newly created, empty disposable database is eligible. Never creates,
# drops or resets a database, schema or cluster role. Approval is per run.
$ErrorActionPreference = 'Stop'
if (-not $ApproveSyntheticWrites) { throw 'Explicit -ApproveSyntheticWrites is required.' }
if ($env:PGHOSTADDR -and $env:PGHOSTADDR -cne '127.0.0.1') { throw 'PGHOSTADDR must be absent or loopback.' }
if ($env:PGSERVICE -or $env:PGOPTIONS) { throw 'PGSERVICE and PGOPTIONS must be absent.' }
$psql = 'C:\Program Files\PostgreSQL\17\bin\psql.exe'
if (-not (Test-Path -LiteralPath $psql -PathType Leaf)) { throw 'PostgreSQL 17 psql not found.' }
$targetDatabase = if ($Suite -eq 'Claim') { 'meddecode_worker_claim_20261113' } else { 'meddecode_worker_final_20261113' }
$argsBase = @('-X','-w','-h','127.0.0.1','-p','5433','-U','postgres','-d',$targetDatabase,'-v','ON_ERROR_STOP=1')
$base = Join-Path (Split-Path -Parent $PSScriptRoot) 'database\integration-migrations'
$submission = Join-Path $base '202611120001_processing_job_submission'
$worker = Join-Path $base '202611120002_processing_worker_claim_heartbeat'
$final = Join-Path $base '202611120003_processing_worker_finalization_recovery'

# This statement has only catalog reads and fails before any fixture write.
$identity = @'
SELECT CASE WHEN current_database()=:'expected_database'
 AND current_user='postgres' AND inet_server_addr()='127.0.0.1'::inet
 AND inet_server_port()=5433 AND current_setting('server_version_num')::integer / 10000=17
 AND (SELECT count(*) FROM pg_catalog.pg_database WHERE datname=current_database() AND datdba='postgres'::regrole)=1
 AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname NOT IN ('public','information_schema') AND nspname NOT LIKE 'pg\_%' ESCAPE '\')
 AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public')
 AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public')
 AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname <> 'plpgsql')
 AND (SELECT count(*) FROM pg_catalog.pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid())=0
 AND (SELECT count(*) FROM pg_catalog.pg_roles WHERE rolname IN ('anon','authenticated') AND NOT rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls)=2
 AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='meddecode_worker' AND NOT rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls)
 AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member='meddecode_worker'::regrole OR roleid='meddecode_worker'::regrole)
 THEN 'ISOLATED_EMPTY_OK' ELSE 'BLOCKED' END;
'@
$identity = $identity.Replace(":'expected_database'", "'$targetDatabase'")
$marker = & $psql @argsBase -qAt -c $identity
if ($LASTEXITCODE -ne 0 -or ($marker -join "`n").Trim() -cne 'ISOLATED_EMPTY_OK') { throw 'Identity, empty-database or role safety check failed.' }

$bootstrapPath = Join-Path $PSScriptRoot 'worker-synthetic-bootstrap.sql'
$bootstrap = Get-Content -LiteralPath $bootstrapPath -Raw
if ($bootstrap -match '(?i)\b(DROP|TRUNCATE|CREATE\s+ROLE|ALTER\s+ROLE)\b' -or
    $bootstrap -notmatch 'CREATE TABLE public\.users' -or $bootstrap -notmatch 'CREATE FUNCTION auth\.uid') {
  throw 'Synthetic bootstrap is unsafe or incompatible.'
}
& $psql @argsBase -q -f $bootstrapPath
if ($LASTEXITCODE -ne 0) { throw 'Synthetic bootstrap failed.' }

function Invoke-File([string]$path) {
  & $psql @argsBase -q -f $path
  if ($LASTEXITCODE -ne 0) { throw "SQL script failed: $path" }
  Write-Output "PASS: $path"
}
foreach ($name in @('001_preflight.sql','002_up.sql','003_verify.sql')) { Invoke-File (Join-Path $submission $name) }
Invoke-File (Join-Path $worker 'test\00_worker_role.sql')
foreach ($name in @('001_preflight.sql','002_up.sql','003_verify.sql')) { Invoke-File (Join-Path $worker $name) }

if ($Suite -eq 'Claim') {
  Invoke-File (Join-Path $worker 'test\10_behavior.sql')
  Invoke-File (Join-Path $worker 'test\15_prepare_concurrency.sql')
  $concurrent = Join-Path $worker 'test\20_concurrent_claim.sql'
  $jobs = foreach ($number in 1..2) {
    Start-Job -ArgumentList $psql,$argsBase,$concurrent,$number -ScriptBlock {
      param($exe,$connection,$file,$id)
      & $exe @connection -q -v "session_id=$id" -f $file
      if ($LASTEXITCODE -ne 0) { throw "claim session $id failed" }
    }
  }
  $jobs | Wait-Job | Out-Null
  foreach ($job in $jobs) { Receive-Job $job -ErrorAction Stop; if ($job.State -ne 'Completed') { throw 'Claim session failed.' } }
  Invoke-File (Join-Path $worker 'test\30_concurrency_verify.sql')
} else {
  Invoke-File (Join-Path $final 'test\00_completion_fixture.sql')
  foreach ($name in @('001_preflight.sql','002_up.sql','003_verify.sql','002_up.sql','003_verify.sql')) { Invoke-File (Join-Path $final $name) }
  foreach ($name in @('10_behavior.sql','20_fencing_and_recovery.sql','30_prepare_completion_recovery_concurrency.sql')) { Invoke-File (Join-Path $final "test\$name") }
  $files = @((Join-Path $final 'test\40_concurrent_recovery.sql'),(Join-Path $final 'test\41_concurrent_stale_completion.sql'))
  $jobs = foreach ($file in $files) {
    Start-Job -ArgumentList $psql,$argsBase,$file -ScriptBlock {
      param($exe,$connection,$scriptPath)
      & $exe @connection -q -f $scriptPath
      if ($LASTEXITCODE -ne 0) { throw 'Finalization concurrency session failed.' }
    }
  }
  $jobs | Wait-Job | Out-Null
  foreach ($job in $jobs) { Receive-Job $job -ErrorAction Stop; if ($job.State -ne 'Completed') { throw 'Finalization session failed.' } }
  Invoke-File (Join-Path $final 'test\50_completion_recovery_concurrency_verify.sql')
  Invoke-File (Join-Path $PSScriptRoot 'worker-lock-expiry-setup.sql')
  $lockFiles = @((Join-Path $PSScriptRoot 'worker-lock-expiry-holder.sql'),(Join-Path $PSScriptRoot 'worker-lock-expiry-contender.sql'))
  $lockJobs = foreach ($file in $lockFiles) {
    Start-Job -ArgumentList $psql,$argsBase,$file -ScriptBlock {
      param($exe,$connection,$scriptPath)
      & $exe @connection -q -f $scriptPath
      if ($LASTEXITCODE -ne 0) { throw 'Lock-expiry session failed.' }
    }
  }
  $lockJobs | Wait-Job | Out-Null
  foreach ($job in $lockJobs) { Receive-Job $job -ErrorAction Stop; if ($job.State -ne 'Completed') { throw 'Lock-expiry session failed.' } }
  Invoke-File (Join-Path $PSScriptRoot 'worker-lock-expiry-verify.sql')
  Invoke-File (Join-Path $PSScriptRoot 'worker-atomic-rollback.sql')
  Invoke-File (Join-Path $PSScriptRoot 'worker-contract-roundtrip.sql')
}
Write-Output "PASS: $Suite synthetic suite; database retained for inspection."
