[CmdletBinding()]
param([ValidateSet('Prompt','ProtectedStore')][string]$CredentialSource = 'Prompt', [switch]$DatabaseOnly, [switch]$LoadOnly)
# Run in a dedicated PowerShell session, not the normal backend terminal.
# Prompts are hidden. This script only configures this process and runs reads.
$ErrorActionPreference = 'Stop'
if ($DatabaseOnly -and $LoadOnly) { throw 'Choose either database-only verification or loading only.' }
foreach ($name in @('PGHOST','PGHOSTADDR','PGOPTIONS','PGSSLMODE','PGUSER','PGDATABASE')) {
  if ([Environment]::GetEnvironmentVariable($name, 'Process')) { throw "Unexpected PostgreSQL override: $name" }
}
if ($CredentialSource -eq 'Prompt' -and (-not $env:AWS_ACCESS_KEY_ID -or -not $env:AWS_SECRET_ACCESS_KEY)) {
  throw 'Load the verified meddecode-worker-dev AWS credentials privately into this PowerShell session first.'
}
$serviceFile = Join-Path $env:APPDATA 'postgresql\pg_service.conf'
$section = [regex]::Match([IO.File]::ReadAllText($serviceFile), '(?ms)^\[meddecode_hosted_admin\]\s*\r?\n(?<body>.*?)(?=^\[|\z)').Groups['body'].Value
if ($section -notmatch '(?m)^\s*sslmode\s*=\s*verify-full\s*$' -or
    $section -notmatch '(?m)^\s*dbname\s*=\s*postgres\s*$' -or
    $section -notmatch '(?m)^\s*port\s*=\s*5432\s*$' -or
    $section -notmatch '(?m)^\s*user\s*=\s*postgres\.wyripeqruhvbksjfsvlr\s*$' -or
    $section -match '(?m)^\s*(hostaddr|password|options)\s*=') { throw 'Hosted service configuration mismatch.' }
$poolerHost = [regex]::Match($section, '(?m)^\s*host\s*=\s*(\S+)').Groups[1].Value
$caPath = [regex]::Match($section, '(?m)^\s*sslrootcert\s*=\s*(.*?)\s*$').Groups[1].Value
if ($poolerHost -notmatch '\.pooler\.supabase\.com$' -or -not $caPath) { throw 'Verified session-pooler host or CA is missing.' }
$caPath = [Environment]::ExpandEnvironmentVariables($caPath)
if (-not (Test-Path -LiteralPath $caPath -PathType Leaf)) { throw 'Verified TLS CA file is missing.' }
$loadedCredentials = @()
if ($CredentialSource -eq 'ProtectedStore') {
  . (Join-Path $PSScriptRoot 'scoped-worker-acl.ps1')
  $storePath = Join-Path $env:LOCALAPPDATA 'MedDecode\ScopedWorkerCredentials\credentials.xml'
  if (-not (Test-Path -LiteralPath $storePath -PathType Leaf) -or
      ((Get-Item -LiteralPath $storePath -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw 'Protected credential store is unavailable or unsafe.'
  }
  Assert-ScopedCredentialDacl (Split-Path -Parent $storePath) $true
  Assert-ScopedCredentialDacl $storePath $false
  $loadedCredentials = @(Import-Clixml -LiteralPath $storePath)
  $names = @('AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','SCOPED_POSTGRES_PASSWORD','CATALOGUE_POSTGRES_PASSWORD')
  if (($loadedCredentials.Count -ne 4 -and $loadedCredentials.Count -ne 5) -or
      @($loadedCredentials | Where-Object { $_ -isnot [pscredential] -or $_.UserName -notin ($names + 'AWS_SESSION_TOKEN') }).Count -ne 0) {
    throw 'Protected credential store is invalid.'
  }
  foreach ($name in $names) { if (@($loadedCredentials | Where-Object UserName -CEQ $name).Count -ne 1) { throw 'Protected credential store is incomplete.' } }
  if (@($loadedCredentials | Where-Object UserName -CEQ 'AWS_SESSION_TOKEN').Count -gt 1) { throw 'Protected credential store is invalid.' }
  $keyCredential = @($loadedCredentials | Where-Object UserName -CEQ 'AWS_ACCESS_KEY_ID')[0]
  $awsCredential = @($loadedCredentials | Where-Object UserName -CEQ 'AWS_SECRET_ACCESS_KEY')[0]
  $env:AWS_ACCESS_KEY_ID = $keyCredential.GetNetworkCredential().Password
  $env:AWS_SECRET_ACCESS_KEY = $awsCredential.GetNetworkCredential().Password
  $sessionCredential = @($loadedCredentials | Where-Object UserName -CEQ 'AWS_SESSION_TOKEN')
  if ($sessionCredential.Count) { $env:AWS_SESSION_TOKEN = $sessionCredential[0].GetNetworkCredential().Password }
  else { Remove-Item Env:AWS_SESSION_TOKEN -ErrorAction SilentlyContinue }
  $workerSecret = @($loadedCredentials | Where-Object UserName -CEQ 'SCOPED_POSTGRES_PASSWORD')[0].Password
  $readerSecret = @($loadedCredentials | Where-Object UserName -CEQ 'CATALOGUE_POSTGRES_PASSWORD')[0].Password
} else {
  $workerSecret = Read-Host 'Scoped worker PostgreSQL password (hidden)' -AsSecureString
  $readerSecret = Read-Host 'Catalogue reader PostgreSQL password (hidden)' -AsSecureString
}
if ($workerSecret.Length -eq 0 -or $readerSecret.Length -eq 0) { throw 'Both dedicated passwords are required.' }
try {
  $workerPassword = [pscredential]::new('scoped', $workerSecret).GetNetworkCredential().Password
  $env:WORKER_DATABASE_URL = 'postgresql://meddecode_scoped_worker_login.wyripeqruhvbksjfsvlr:' + [uri]::EscapeDataString($workerPassword) + '@' + $poolerHost + ':5432/postgres'
  $env:MEDDECODE_CATALOGUE_PASSWORD = [pscredential]::new('reader', $readerSecret).GetNetworkCredential().Password
  $env:WORKER_DATABASE_CA_FILE = $caPath
  $env:WORKER_RPC_MODE = 'scoped'
  $env:WORKER_SINGLE_ATTEMPT = 'true'
  $env:PROCESSING_WORKER_INSTANCE_ID = 'meddecode-synthetic-32e120ce'
  $env:WORKER_PYTHON_EXECUTABLE = 'C:\Users\dahiy\MedDecode-integration\intelligence\.venv\Scripts\python.exe'
  $env:WORKER_INTELLIGENCE_DIRECTORY = 'C:\Users\dahiy\MedDecode-integration\intelligence'
  $env:WORKER_EASYOCR_MODEL_DIRECTORY = 'C:\Users\dahiy\MedDecode-Test-Fixtures\easyocr-model-cache'
  $env:MEDDECODE_CATALOGUE_ENV = 'hosted'
  $env:MEDDECODE_CATALOGUE_HOST = $poolerHost
  $env:MEDDECODE_CATALOGUE_PORT = '5432'
  $env:MEDDECODE_CATALOGUE_DATABASE = 'postgres'
  $env:MEDDECODE_CATALOGUE_USER = 'meddecode_catalogue_python_reader.wyripeqruhvbksjfsvlr'
  $env:MEDDECODE_CATALOGUE_SSLMODE = 'verify-full'
  $env:MEDDECODE_CATALOGUE_SSLROOTCERT = $caPath
  $env:AWS_REGION = 'ap-south-1'
  $env:AWS_S3_BUCKET = 'meddecode-prescriptions-dev-226945380522-ap-south-1-an'
  $env:PROCESSING_WORKER_ENABLED = 'false'
  if ($LoadOnly) {
    # Deliberately not a readiness result. This avoids creating a new pooled
    # database session after a separate verified readiness run.
    'WORKER_ENV_LOADED_CHECKS_NOT_RUN'
  } else {
    Push-Location (Split-Path -Parent $PSScriptRoot)
    try {
      if ($DatabaseOnly) { & node 'scripts/verify-scoped-hosted-readiness.cjs' '--database-only' }
      else { & node 'scripts/verify-scoped-hosted-readiness.cjs' }
      if ($LASTEXITCODE -ne 0) { throw 'Readiness verification failed; do not insert scope or start the worker.' }
    } finally { Pop-Location }
  }
} finally {
  Remove-Variable workerPassword -ErrorAction SilentlyContinue
  if ($loadedCredentials.Count) {
    foreach ($credential in $loadedCredentials) { $credential.Password.Dispose() }
  } else { $workerSecret.Dispose(); $readerSecret.Dispose() }
}
