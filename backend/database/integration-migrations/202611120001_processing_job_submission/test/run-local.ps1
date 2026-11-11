param(
  [Parameter(Mandatory = $true)]
  [string]$DatabaseUrl,

  [string]$PsqlPath = 'C:\Program Files\PostgreSQL\17\bin\psql.exe'
)

$ErrorActionPreference = 'Stop'
$uri = [Uri]$DatabaseUrl
if ($uri.Scheme -notin @('postgres', 'postgresql') -or
    $uri.Host -notin @('localhost', '127.0.0.1', '::1') -or
    $uri.Port -ne 5433 -or
    $uri.AbsolutePath -ne '/meddecode_job_test') {
  throw 'DatabaseUrl must target meddecode_job_test on loopback port 5433.'
}
if ([string]::IsNullOrWhiteSpace($uri.UserInfo) -or $uri.UserInfo.Contains(':')) {
  throw 'DatabaseUrl must contain a user name but must not embed a password.'
}

$resolvedPsql = (Resolve-Path -LiteralPath $PsqlPath -ErrorAction Stop).Path
$expectedPsql = [System.IO.Path]::GetFullPath(
  'C:\Program Files\PostgreSQL\17\bin\psql.exe'
)
if (-not [string]::Equals($resolvedPsql, $expectedPsql,
    [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'PsqlPath must be the approved PostgreSQL 17 executable.'
}

$databaseName = $uri.AbsolutePath.TrimStart('/')
$databaseUser = [Uri]::UnescapeDataString($uri.UserInfo)
$connectionArgs = @(
  '-h', $uri.Host,
  '-p', $uri.Port.ToString(),
  '-U', $databaseUser,
  '-d', $databaseName,
  '-X',
  '-v', 'ON_ERROR_STOP=1'
)
$hadPassword = Test-Path Env:PGPASSWORD
$priorPassword = $env:PGPASSWORD
$pgpassFile = $env:PGPASSFILE
if ([string]::IsNullOrEmpty($pgpassFile)) {
  $pgpassFile = Join-Path $env:APPDATA 'postgresql\pgpass.conf'
}
$hasPgpass = Test-Path -LiteralPath $pgpassFile -PathType Leaf
$passwordPointer = [IntPtr]::Zero
$concurrencyOutputDirectory = $null

function Get-SanitizedDiagnostic {
  param([string]$Content)

  if ([string]::IsNullOrWhiteSpace($Content)) { return '<no output>' }

  $sanitized = $Content
  if (-not [string]::IsNullOrEmpty($env:PGPASSWORD)) {
    $sanitized = $sanitized -replace [regex]::Escape($env:PGPASSWORD), '<redacted>'
  }
  $sanitized = $sanitized -replace '(?i)(postgres(?:ql)?://[^:\s]+:)[^@\s]+@', '$1<redacted>@'
  $sanitized = $sanitized -replace '(?i)(password\s*[=:]\s*)\S+', '$1<redacted>'
  return $sanitized.Trim()
}

function Get-ConcurrencyFailureKind {
  param([string]$Diagnostic)

  if ($Diagnostic -match '(?i)password authentication failed|no password supplied') {
    return 'AUTHENTICATION'
  }
  if ($Diagnostic -match '(?i)connection refused|could not connect to server') {
    return 'CONNECTION'
  }
  if ($Diagnostic -match '(?i)not recognized|cannot find|no such file') {
    return 'PROCESS_LAUNCH'
  }
  return 'SQL_OR_PSQL'
}

function Invoke-ExpectedPsqlFailure {
  param(
    [string]$ScriptPath,
    [string]$ExpectedDiagnostic
  )

  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $resolvedPsql
  $processArguments = $connectionArgs + @('-f', $ScriptPath)
  $startInfo.Arguments = ($processArguments | ForEach-Object {
    '"' + ([string]$_).Replace('"', '\"') + '"'
  }) -join ' '
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $process = New-Object System.Diagnostics.Process
  $process.StartInfo = $startInfo
  if (-not $process.Start()) {
    throw "Could not start expected-failure check for $ScriptPath."
  }
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  $process.WaitForExit()
  $exitCode = $process.ExitCode
  $diagnostic = Get-SanitizedDiagnostic (
    $stdoutTask.GetAwaiter().GetResult() + [Environment]::NewLine +
    $stderrTask.GetAwaiter().GetResult()
  )
  $process.Dispose()

  if ($exitCode -eq 0) {
    throw "Expected $ScriptPath to reject the invalid catalog state."
  }
  if ($diagnostic -notmatch [regex]::Escape($ExpectedDiagnostic)) {
    throw "Expected failure did not report '$ExpectedDiagnostic':`n$diagnostic"
  }
  Write-Output "Expected verification failure confirmed for $(Split-Path -Leaf $ScriptPath)."
}

try {
  if ([string]::IsNullOrEmpty($env:PGPASSWORD) -and -not $hasPgpass) {
    $securePassword = Read-Host 'Local PostgreSQL password' -AsSecureString
    $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR(
      $securePassword
    )
    $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR(
      $passwordPointer
    )
  }

  $root = Split-Path -Parent $PSScriptRoot
  $scripts = @(
    (Join-Path $PSScriptRoot '00_bootstrap.sql'),
    (Join-Path $root '001_preflight.sql'),
    (Join-Path $root '002_up.sql'),
    (Join-Path $root '003_verify.sql'),
    (Join-Path $root '002_up.sql'),
    (Join-Path $root '003_verify.sql'),
    (Join-Path $PSScriptRoot '10_behavior.sql')
  )

  foreach ($script in $scripts) {
    & $resolvedPsql @connectionArgs -f $script
    if ($LASTEXITCODE -ne 0) { throw "psql failed for $script" }
  }

  $migrationRoot = Split-Path -Parent $PSScriptRoot
  & $resolvedPsql @connectionArgs -c `
    'REVOKE SELECT ON TABLE public.ai_jobs FROM authenticated'
  if ($LASTEXITCODE -ne 0) { throw 'Could not prepare negative verification test.' }
  try {
    Invoke-ExpectedPsqlFailure `
      (Join-Path $migrationRoot '003_verify.sql') `
      'authenticated SELECT privileges required by the status RPC are missing'
    Invoke-ExpectedPsqlFailure `
      (Join-Path $migrationRoot '002_up.sql') `
      'authenticated SELECT privileges required by the status RPC are missing'
  } finally {
    & $resolvedPsql @connectionArgs -c `
      'GRANT SELECT ON TABLE public.ai_jobs TO authenticated'
    if ($LASTEXITCODE -ne 0) {
      throw 'Could not restore local test SELECT privilege after negative verification.'
    }
  }
  & $resolvedPsql @connectionArgs -f (Join-Path $migrationRoot '003_verify.sql')
  if ($LASTEXITCODE -ne 0) {
    throw 'Post-failure verification found migration state was not rolled back.'
  }

  $concurrent = Join-Path $PSScriptRoot '20_concurrent_submit.sql'
  $concurrencyOutputDirectory = Join-Path `
    ([System.IO.Path]::GetTempPath()) `
    ('meddecode-concurrency-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $concurrencyOutputDirectory | Out-Null

  $processes = 1..2 | ForEach-Object {
    $sessionId = $_
    $stdoutPath = Join-Path $concurrencyOutputDirectory "session-$sessionId.stdout.log"
    $stderrPath = Join-Path $concurrencyOutputDirectory "session-$sessionId.stderr.log"
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $resolvedPsql
    $processArguments = $connectionArgs + @(
      '-v', "session_id=$sessionId", '-f', $concurrent
    )
    $startInfo.Arguments = ($processArguments | ForEach-Object {
      '"' + ([string]$_).Replace('"', '\"') + '"'
    }) -join ' '
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo
    try {
      if (-not $process.Start()) {
        throw 'Process.Start returned false.'
      }
    } catch {
      throw "Concurrent session $sessionId process launch failed: $($_.Exception.Message)"
    }
    [pscustomobject]@{
      SessionId = $sessionId
      Process = $process
      StdoutTask = $process.StandardOutput.ReadToEndAsync()
      StderrTask = $process.StandardError.ReadToEndAsync()
      StdoutPath = $stdoutPath
      StderrPath = $stderrPath
    }
  }

  $processes | ForEach-Object { $_.Process.WaitForExit() }
  $failedProcesses = @()
  $submissionResults = @{}
  foreach ($process in $processes) {
    if (-not $process.Process.HasExited) {
      throw "Concurrent session $($process.SessionId) did not exit after WaitForExit."
    }
    $exitCode = $process.Process.ExitCode
    Write-Output "Concurrent session $($process.SessionId) exit code: $exitCode"
    $stdout = $process.StdoutTask.GetAwaiter().GetResult()
    $stderr = $process.StderrTask.GetAwaiter().GetResult()
    [System.IO.File]::WriteAllText($process.StdoutPath, $stdout)
    [System.IO.File]::WriteAllText($process.StderrPath, $stderr)
    if ($exitCode -ne 0) {
      $diagnostic = Get-SanitizedDiagnostic ($stdout + [Environment]::NewLine + $stderr)
      $failureKind = Get-ConcurrencyFailureKind $diagnostic
      Write-Error "Concurrent session $($process.SessionId) [$failureKind] failed:`n$diagnostic" `
        -ErrorAction Continue
      $failedProcesses += $process
      continue
    }

    $resultMatches = [regex]::Matches(
      $stdout,
      '(?m)^SUBMISSION_RESULT\s+([0-9a-fA-F-]{36})\s+([tf])\s*$'
    )
    if ($resultMatches.Count -ne 1) {
      throw "Concurrent session $($process.SessionId) did not return exactly one submission result."
    }
    $submissionResults[$process.SessionId] = [pscustomobject]@{
      JobId = $resultMatches[0].Groups[1].Value
      Created = $resultMatches[0].Groups[2].Value
    }
  }
  if ($failedProcesses.Count -gt 0) {
    throw "$($failedProcesses.Count) concurrent submission process(es) failed."
  }
  if ($submissionResults[1].JobId -ne $submissionResults[2].JobId) {
    throw 'Concurrent submissions returned different job IDs.'
  }
  if (@($submissionResults.Values | Where-Object { $_.Created -eq 't' }).Count -ne 1 -or
      @($submissionResults.Values | Where-Object { $_.Created -eq 'f' }).Count -ne 1) {
    throw 'Concurrent submissions did not return exactly one created and one reused result.'
  }

  & $resolvedPsql @connectionArgs -f `
    (Join-Path $PSScriptRoot '30_concurrency_verify.sql')
  if ($LASTEXITCODE -ne 0) { throw 'Concurrency verification failed.' }

  Invoke-ExpectedPsqlFailure `
    (Join-Path $PSScriptRoot '35_recovery_refuses_jobs.sql') `
    'recovery blocked: ai_jobs changed from captured baseline'

  # Recovery is tested only after resetting the disposable schema so its
  # reviewed zero-job baseline is true. No production or hosted target can pass
  # the target guard near the top of this script.
  $recoveryScripts = @(
    (Join-Path $PSScriptRoot '00_bootstrap.sql'),
    (Join-Path $migrationRoot '001_preflight.sql'),
    (Join-Path $migrationRoot '002_up.sql'),
    (Join-Path $migrationRoot '003_verify.sql'),
    (Join-Path $PSScriptRoot '40_recovery.sql')
  )
  foreach ($script in $recoveryScripts) {
    & $resolvedPsql @connectionArgs -f $script
    if ($LASTEXITCODE -ne 0) { throw "psql failed for recovery test $script" }
  }

  Write-Output 'Local processing-job migration tests passed.'
} finally {
  if ($null -ne $concurrencyOutputDirectory -and
      (Test-Path -LiteralPath $concurrencyOutputDirectory)) {
    Remove-Item -LiteralPath $concurrencyOutputDirectory -Recurse -Force
  }
  if ($passwordPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
  }
  if ($hadPassword) {
    $env:PGPASSWORD = $priorPassword
  } else {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  }
}
