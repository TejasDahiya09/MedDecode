[CmdletBinding()]
param()

$ErrorActionPreference='Stop'
$root='C:\Users\dahiy\MedDecode-integration'
$pg='C:\Program Files\PostgreSQL\17\bin'
$clusterRoot=Join-Path $env:USERPROFILE 'MedDecode-ScopedWorker-PG17-20261114'
$data=Join-Path $clusterRoot 'data'
$pass=Join-Path $clusterRoot 'local-test.pgpass'
$port=55439
$helper=Join-Path $root 'backend\scripts\scoped-worker-private-cluster.ps1'
$suites=@(
  [pscustomobject]@{ Name='activation'; Path=(Join-Path $root 'backend\scripts\test-generation-2-activation.ps1') },
  [pscustomobject]@{ Name='admission'; Path=(Join-Path $root 'backend\scripts\test-automatic-rollout-generation.ps1') }
)
$logRoot=Join-Path $clusterRoot ('test-logs\' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$env:PGPASSFILE=$pass
$clusterOwned=$false
$suiteFailures=0
$cleanupFailure=$null

function Assert-ExpectedCluster {
  $ready=& (Join-Path $pg 'pg_isready.exe') -h 127.0.0.1 -p $port 2>$null
  if($ready -notmatch 'accepting connections'){return $false}
  & (Join-Path $pg 'pg_ctl.exe') -D $data status
  if($LASTEXITCODE -ne 0){throw 'Port 55439 accepts connections, but the expected cluster is not running from its configured data directory.'}
  $identity=& (Join-Path $pg 'psql.exe') -X -w -qAt -h 127.0.0.1 -p $port -U scoped_cluster_admin -d postgres -v ON_ERROR_STOP=1 -F '|' -c "SELECT current_setting('server_version_num'),current_setting('port'),current_setting('data_directory')"
  if($LASTEXITCODE -ne 0){throw 'Could not verify local PostgreSQL identity.'}
  $parts=$identity -split '\|',3
  if($parts.Count -ne 3 -or $parts[0] -notmatch '^17' -or $parts[1] -ne "$port" -or [IO.Path]::GetFullPath($parts[2]).TrimEnd('\') -ine [IO.Path]::GetFullPath($data).TrimEnd('\')) {
    throw "Refusing to use unexpected PostgreSQL instance: $identity"
  }
  return $true
}

function Invoke-Suite([string]$Name,[string]$Path) {
  $stdout=Join-Path $logRoot "$Name.stdout.log"
  $stderr=Join-Path $logRoot "$Name.stderr.log"
  $arguments=@('-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$Path`"")
  $process=Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $arguments -PassThru -Wait -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  $out=if(Test-Path -LiteralPath $stdout){Get-Content -LiteralPath $stdout -Raw}else{''}
  $err=if(Test-Path -LiteralPath $stderr){Get-Content -LiteralPath $stderr -Raw}else{''}
  $summaryPattern="(?m)^TEST_SUMMARY suite=$([regex]::Escape($Name)) passed=(\d+) failed=(\d+)\r?$"
  $summary=[regex]::Match($out,$summaryPattern)
  if($summary.Success) {
    $passed=[int]$summary.Groups[1].Value
    $failed=[int]$summary.Groups[2].Value
  } else {
    $passed=([regex]::Matches($out,'(?m)^TEST_PASS:')).Count
    $failed=([regex]::Matches($out,'(?m)^TEST_FAIL:')).Count
    if($failed -eq 0){$failed=1}
    Write-Output "TEST_FAIL:$Name missing or invalid suite summary"
  }
  if($process.ExitCode -ne 0 -and $failed -eq 0){$failed=1}
  Write-Output "SUITE_RESULT name=$Name exit_code=$($process.ExitCode) passed=$passed failed=$failed stdout=$stdout stderr=$stderr"
  if($err){Write-Output "SUITE_STDERR:$Name`n$err"}
  if($process.ExitCode -ne 0 -or $failed -gt 0){$script:suiteFailures++}
}

try {
  if(-not (Test-Path -LiteralPath (Join-Path $data 'PG_VERSION')) -or -not (Test-Path -LiteralPath $pass)){throw 'The existing PostgreSQL 17 test cluster is incomplete.'}
  New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
  if(-not (Assert-ExpectedCluster)) {
    if(Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue){throw "Port $port is owned while the expected PostgreSQL cluster is unavailable."}
    $pidFile=Join-Path $data 'postmaster.pid'
    if(Test-Path -LiteralPath $pidFile) {
      $lines=Get-Content -LiteralPath $pidFile
      $stalePid=0
      if($lines.Count -gt 0 -and [int]::TryParse($lines[0],[ref]$stalePid) -and (Get-Process -Id $stalePid -ErrorAction SilentlyContinue)){throw "Refusing to start while postmaster.pid names active process $stalePid."}
    }
    $clusterOwned=$true
    & $helper -Action Start
    if($LASTEXITCODE -ne 0){throw 'PostgreSQL startup failed.'}
    if(-not (Assert-ExpectedCluster)){throw 'PostgreSQL startup or identity verification failed.'}
  } else {
    $clusterOwned=$true
  }
  $databaseNames=& (Join-Path $pg 'psql.exe') -X -w -qAt -h 127.0.0.1 -p $port -U scoped_cluster_admin -d postgres -v ON_ERROR_STOP=1 -c "SELECT datname FROM pg_database WHERE datallowconn AND NOT datistemplate ORDER BY datname"
  if($LASTEXITCODE -ne 0){throw 'Could not enumerate connectable databases for integrity checks.'}
  $amcheckDatabases=@()
  foreach($databaseName in $databaseNames) {
    & (Join-Path $pg 'psql.exe') -X -w -qAt -h 127.0.0.1 -p $port -U scoped_cluster_admin -d $databaseName -v ON_ERROR_STOP=1 -c 'SELECT 1'
    if($LASTEXITCODE -ne 0){throw "Read-only connection check failed for database $databaseName."}
    $hasAmcheck=& (Join-Path $pg 'psql.exe') -X -w -qAt -h 127.0.0.1 -p $port -U scoped_cluster_admin -d $databaseName -v ON_ERROR_STOP=1 -c "SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname='amcheck')"
    if($LASTEXITCODE -ne 0){throw "Could not inspect extension availability in database $databaseName."}
    if($hasAmcheck -eq 't'){$amcheckDatabases += $databaseName}
  }
  $integrityLog=Join-Path $logRoot 'pg-amcheck.log'
  foreach($databaseName in $amcheckDatabases) {
    & (Join-Path $pg 'pg_amcheck.exe') --database=$databaseName --no-password -h 127.0.0.1 -p $port -U scoped_cluster_admin *> $integrityLog
    $amcheckExit=$LASTEXITCODE
    if($amcheckExit -ne 0){throw "pg_amcheck failed for database $databaseName with exit code $amcheckExit; see $integrityLog"}
  }
  Write-Output "POSTGRESQL_INTEGRITY=PASS connectable_databases=$($databaseNames.Count) amcheck_databases=$($amcheckDatabases.Count)"
  foreach($suite in $suites){Invoke-Suite $suite.Name $suite.Path}
} catch {
  $suiteFailures++
  Write-Output "TEST_FAIL:runner:$($_.Exception.Message)"
} finally {
  if($clusterOwned) {
    try {
      & $helper -Action Stop
      if($LASTEXITCODE -ne 0){throw "Graceful cluster shutdown returned exit code $LASTEXITCODE."}
      $ready=& (Join-Path $pg 'pg_isready.exe') -h 127.0.0.1 -p $port 2>$null
      if($ready -match 'accepting connections'){throw 'PostgreSQL remained available after requested shutdown.'}
      Write-Output 'POSTGRESQL_CLEANUP=PASS'
    } catch {
      $cleanupFailure=$_.Exception.Message
      Write-Output "POSTGRESQL_CLEANUP=FAIL error=$cleanupFailure"
    }
  } else {
    Write-Output 'POSTGRESQL_CLEANUP=NOT_OWNED'
  }
  Remove-Item Env:PGPASSFILE -ErrorAction SilentlyContinue
}

Write-Output "OVERALL_RESULT suites_failed=$suiteFailures cleanup_failed=$([int][bool]$cleanupFailure) logs=$logRoot"
if($suiteFailures -gt 0 -or $cleanupFailure){$global:LASTEXITCODE=1; exit 1}
$global:LASTEXITCODE=0
exit 0
