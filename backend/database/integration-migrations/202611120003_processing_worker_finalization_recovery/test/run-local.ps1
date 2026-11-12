param(
  [Parameter(Mandatory = $true)][string]$DatabaseUrl,
  [Parameter(Mandatory = $true)][string]$PsqlPath,
  [switch]$ApproveDisposableReset
)
$ErrorActionPreference = 'Stop'

# This script is a future, separately approved destructive local harness. It is
# intentionally not invoked by static tests or application startup.
# Target validation is delegated to the inherited strict 127.0.0.1:5433 /
# meddecode_job_test guard; this runner has no alternate target path.
$workerRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..\202611120002_processing_worker_claim_heartbeat')
$submissionRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..\202611120001_processing_job_submission')
Import-Module (Join-Path $workerRoot 'test\harness-safety.psm1') -Force
$uri = Assert-ApprovedWorkerTestTarget -DatabaseUrl $DatabaseUrl `
  -ResetApproved $ApproveDisposableReset.IsPresent
$expectedPsql = [IO.Path]::GetFullPath('C:\Program Files\PostgreSQL\17\bin\psql.exe')
$resolvedPsql = [IO.Path]::GetFullPath($PsqlPath)
if (-not [string]::Equals($resolvedPsql, $expectedPsql, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'PsqlPath must be the approved PostgreSQL 17 executable.'
}
$connection = @('-h', $uri.Host, '-p', '5433', '-U', $uri.UserInfo, '-d', 'meddecode_job_test', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1')
$root = Split-Path -Parent $PSScriptRoot

$identityOutput = & $PsqlPath @connection -f (Join-Path $workerRoot 'test\00_identity_preflight.sql')
if ($LASTEXITCODE -ne 0) { throw 'Read-only database identity verification failed.' }
Assert-WorkerTestPreflightMarker -Output ($identityOutput -join "`n") -Expected IDENTITY_OK
$inventoryOutput = & $PsqlPath @connection -f (Join-Path $workerRoot 'test\01_reset_inventory.sql')
if ($LASTEXITCODE -ne 0) { throw 'Read-only reset inventory verification failed.' }
Assert-WorkerTestPreflightMarker -Output ($inventoryOutput -join "`n") -Expected RESET_INVENTORY_OK

$scripts = @(
  (Join-Path $submissionRoot 'test\00_bootstrap.sql'),
  (Join-Path $submissionRoot '001_preflight.sql'), (Join-Path $submissionRoot '002_up.sql'),
  (Join-Path $submissionRoot '003_verify.sql'),
  (Join-Path $workerRoot 'test\00_worker_role.sql'),
  (Join-Path $workerRoot '001_preflight.sql'), (Join-Path $workerRoot '002_up.sql'),
  (Join-Path $workerRoot '003_verify.sql'),
  (Join-Path $root 'test\00_completion_fixture.sql'),
  (Join-Path $root '001_preflight.sql'), (Join-Path $root '002_up.sql'),
  (Join-Path $root '003_verify.sql'), (Join-Path $root '002_up.sql'),
  (Join-Path $root '003_verify.sql'), (Join-Path $root 'test\10_behavior.sql'),
  (Join-Path $root 'test\20_fencing_and_recovery.sql'),
  (Join-Path $root 'test\30_prepare_completion_recovery_concurrency.sql')
)
foreach ($script in $scripts) {
  & $PsqlPath @connection -f $script
  if ($LASTEXITCODE -ne 0) { throw "psql failed for $script" }
  Write-Output "PASS: $(Split-Path -Leaf $script)"
}

$temp = Join-Path ([IO.Path]::GetTempPath()) ('meddecode-finalization-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temp | Out-Null
try {
  $concurrentScripts = @(
    @{ Id = 1; Script = (Join-Path $root 'test\40_concurrent_recovery.sql') },
    @{ Id = 2; Script = (Join-Path $root 'test\41_concurrent_stale_completion.sql') }
  )
  $processes = foreach ($item in $concurrentScripts) {
    $stdout = Join-Path $temp "session-$($item.Id).stdout"
    $stderr = Join-Path $temp "session-$($item.Id).stderr"
    $process = Start-Process -FilePath $PsqlPath -ArgumentList ($connection + @('-f', $item.Script)) `
      -RedirectStandardOutput $stdout -RedirectStandardError $stderr `
      -WindowStyle Hidden -PassThru
    [pscustomobject]@{ Id = $item.Id; Process = $process; Stdout = $stdout; Stderr = $stderr }
  }
  $processes.Process | Wait-Process
  foreach ($item in $processes) {
    if ($item.Process.ExitCode -ne 0) {
      $diagnostic = ((Get-Content -LiteralPath $item.Stdout -Raw -ErrorAction SilentlyContinue) +
        (Get-Content -LiteralPath $item.Stderr -Raw -ErrorAction SilentlyContinue))
      $diagnostic = $diagnostic -replace '(?i)(password\s*[=:]\s*)\S+', '$1<redacted>'
      throw "Phase 7 concurrent session $($item.Id) failed: $diagnostic"
    }
    Write-Output "PASS: concurrent session $($item.Id)"
  }
  $verify = Join-Path $root 'test\50_completion_recovery_concurrency_verify.sql'
  & $PsqlPath @connection -f $verify
  if ($LASTEXITCODE -ne 0) { throw 'Phase 7 completion/recovery concurrency verification failed.' }
  Write-Output 'PASS: completion/recovery concurrency verification'
} finally {
  Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Output 'Local worker finalization candidate behavior completed: success, failure, recovery, and concurrency scenarios passed.'
