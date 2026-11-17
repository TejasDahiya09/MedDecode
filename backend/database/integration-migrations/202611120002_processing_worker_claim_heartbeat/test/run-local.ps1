param(
  [Parameter(Mandatory = $true)][string]$DatabaseUrl,
  [Parameter(Mandatory = $true)][string]$PsqlPath,
  [switch]$ApproveDisposableReset
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'harness-safety.psm1') -Force
$uri = Assert-ApprovedWorkerTestTarget -DatabaseUrl $DatabaseUrl `
  -ResetApproved $ApproveDisposableReset.IsPresent
$resolvedPsql = [IO.Path]::GetFullPath($PsqlPath)
$expectedPsql = [IO.Path]::GetFullPath('C:\Program Files\PostgreSQL\17\bin\psql.exe')
if (-not [string]::Equals($resolvedPsql, $expectedPsql, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'PsqlPath must be the approved PostgreSQL 17 executable.'
}
$connection = @('-h', $uri.Host, '-p', '5433', '-U', $uri.UserInfo,
  '-d', 'meddecode_job_test', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1')
$oldRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..\202611120001_processing_job_submission')
$root = Split-Path -Parent $PSScriptRoot

# These two scripts are read-only and must succeed before the inherited
# bootstrap is allowed to drop either disposable schema.
$identityOutput = & $resolvedPsql @connection -f `
  (Join-Path $PSScriptRoot '00_identity_preflight.sql')
if ($LASTEXITCODE -ne 0) { throw 'Read-only database identity verification failed.' }
Assert-WorkerTestPreflightMarker -Output ($identityOutput -join "`n") -Expected IDENTITY_OK

$inventoryOutput = & $resolvedPsql @connection -f `
  (Join-Path $PSScriptRoot '01_reset_inventory.sql')
if ($LASTEXITCODE -ne 0) { throw 'Read-only reset inventory verification failed.' }
Assert-WorkerTestPreflightMarker -Output ($inventoryOutput -join "`n") `
  -Expected RESET_INVENTORY_OK

$scripts = @(
  (Join-Path $oldRoot 'test\00_bootstrap.sql'), (Join-Path $oldRoot '001_preflight.sql'),
  (Join-Path $oldRoot '002_up.sql'), (Join-Path $oldRoot '003_verify.sql'),
  (Join-Path $PSScriptRoot '00_worker_role.sql'), (Join-Path $root '001_preflight.sql'),
  (Join-Path $root '002_up.sql'), (Join-Path $root '003_verify.sql'),
  (Join-Path $root '002_up.sql'), (Join-Path $root '003_verify.sql'),
  (Join-Path $PSScriptRoot '10_behavior.sql'),
  (Join-Path $PSScriptRoot '15_prepare_concurrency.sql')
)
foreach ($script in $scripts) {
  & $resolvedPsql @connection -f $script
  if ($LASTEXITCODE -ne 0) { throw "psql failed for $script" }
}

$concurrent = Join-Path $PSScriptRoot '20_concurrent_claim.sql'
$temp = Join-Path ([IO.Path]::GetTempPath()) ('meddecode-worker-claim-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temp | Out-Null
try {
  $processes = 1..2 | ForEach-Object {
    $id = $_
    $stdout = Join-Path $temp "session-$id.stdout"
    $stderr = Join-Path $temp "session-$id.stderr"
    $args = $connection + @('-v', "session_id=$id", '-f', $concurrent)
    $process = Start-Process -FilePath $resolvedPsql -ArgumentList $args `
      -RedirectStandardOutput $stdout -RedirectStandardError $stderr `
      -WindowStyle Hidden -PassThru
    [pscustomobject]@{ Id=$id; Process=$process; Stdout=$stdout; Stderr=$stderr }
  }
  $processes.Process | Wait-Process
  foreach ($item in $processes) {
    if ($item.Process.ExitCode -ne 0) {
      $diagnostic = ((Get-Content $item.Stdout -Raw -ErrorAction SilentlyContinue) +
        (Get-Content $item.Stderr -Raw -ErrorAction SilentlyContinue))
      $diagnostic = $diagnostic -replace '(?i)(password\s*[=:]\s*)\S+', '$1<redacted>'
      throw "Concurrent worker $($item.Id) failed: $diagnostic"
    }
  }
  & $resolvedPsql @connection -f (Join-Path $PSScriptRoot '30_concurrency_verify.sql')
  if ($LASTEXITCODE -ne 0) { throw 'Concurrency verification failed.' }
} finally {
  Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Output 'Local worker claim and heartbeat migration tests passed.'
