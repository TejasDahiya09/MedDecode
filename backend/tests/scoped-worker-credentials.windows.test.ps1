# Synthetic local regression; never connects to a database or AWS.
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this regression as a non-elevated Windows user.'
}
$root = Join-Path $env:TEMP ('meddecode-scoped-credential-test-' + [guid]::NewGuid().ToString('N'))
$local = Join-Path $root 'local'
$roaming = Join-Path $root 'roaming'
$directory = Join-Path $local 'MedDecode\ScopedWorkerCredentials'
$file = Join-Path $directory 'credentials.xml'
$postgres = Join-Path $roaming 'postgresql'
$service = Join-Path $postgres 'pg_service.conf'
$ca = Join-Path $root 'test-ca.pem'
$backend = Split-Path -Parent $PSScriptRoot
try {
  New-Item -ItemType Directory -Path $directory,$postgres -Force | Out-Null
  # Reproduce the empty partially created directory left by the failed setup.
  $env:LOCALAPPDATA = $local; $env:APPDATA = $roaming
  foreach ($name in @('PGHOST','PGHOSTADDR','PGOPTIONS','PGSSLMODE','PGUSER','PGDATABASE','AWS_SESSION_TOKEN')) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
  $env:AWS_ACCESS_KEY_ID = 'SYNTHETIC_TEST_KEY'
  $env:AWS_SECRET_ACCESS_KEY = 'SYNTHETIC_TEST_AWS_SECRET'
  $env:WORKER_DATABASE_URL = 'postgresql://meddecode_scoped_worker_login.wyripeqruhvbksjfsvlr:TEST%21WORKER@unit.pooler.supabase.com:5432/postgres'
  $env:MEDDECODE_CATALOGUE_USER = 'meddecode_catalogue_python_reader.wyripeqruhvbksjfsvlr'
  $env:MEDDECODE_CATALOGUE_PASSWORD = 'SYNTHETIC_TEST_READER'
  & (Join-Path $backend 'scripts\scoped-worker-credentials.ps1') -Action Initialize
  . (Join-Path $backend 'scripts\scoped-worker-acl.ps1')
  Assert-ScopedCredentialDacl $directory $true
  Assert-ScopedCredentialDacl $file $false
  $raw = [IO.File]::ReadAllText($file)
  foreach ($secret in @('SYNTHETIC_TEST_KEY','SYNTHETIC_TEST_AWS_SECRET','TEST!WORKER','SYNTHETIC_TEST_READER')) {
    if ($raw.Contains($secret)) { throw 'Credential store contains plaintext.' }
  }
  $items = @(Import-Clixml -LiteralPath $file)
  if ($items.Count -ne 4 -or @($items | Where-Object { $_ -isnot [pscredential] }).Count) { throw 'Protected store reuse failed.' }
  try {
    & (Join-Path $backend 'scripts\scoped-worker-credentials.ps1') -Action Initialize
    throw 'Existing store was overwritten.'
  } catch { if ($_.Exception.Message -notmatch 'refusing to overwrite') { throw } }
  [IO.File]::WriteAllText($ca, 'synthetic-test-ca')
  @"
[meddecode_hosted_admin]
host=unit.pooler.supabase.com
port=5432
dbname=postgres
user=postgres.wyripeqruhvbksjfsvlr
sslmode=verify-full
sslrootcert=$ca
"@ | Set-Content -LiteralPath $service
  $global:mockReadinessCalls = 0
  function node {
    if ($args[0] -cne 'scripts/verify-scoped-hosted-readiness.cjs' -or
        $env:PROCESSING_WORKER_ENABLED -cne 'false' -or $env:WORKER_RPC_MODE -cne 'scoped' -or
        $env:WORKER_SINGLE_ATTEMPT -cne 'true' -or $env:AWS_ACCESS_KEY_ID -cne 'SYNTHETIC_TEST_KEY' -or
        $env:MEDDECODE_CATALOGUE_PASSWORD -cne 'SYNTHETIC_TEST_READER') { throw 'Readiness invocation mismatch.' }
    $global:LASTEXITCODE = 0
    $global:mockReadinessCalls += 1
    'MOCK_READINESS_INVOCATION_OK'
  }
  & (Join-Path $backend 'scripts\prepare-scoped-hosted-readiness.ps1') -CredentialSource ProtectedStore
  & (Join-Path $backend 'scripts\prepare-scoped-hosted-readiness.ps1') -CredentialSource ProtectedStore -LoadOnly
  if ($global:mockReadinessCalls -ne 1 -or $env:PROCESSING_WORKER_ENABLED -cne 'false') { throw 'Load-only mode ran checks or enabled worker.' }
  function Read-Host {
    param($Prompt, [switch]$AsSecureString)
    if ($Prompt -match 'session token\?') { return 'no' }
    if ($Prompt -match 'key ID') { return (ConvertTo-SecureString 'SYNTHETIC_REPLACED_KEY' -AsPlainText -Force) }
    return (ConvertTo-SecureString 'SYNTHETIC_REPLACED_SECRET' -AsPlainText -Force)
  }
  & (Join-Path $backend 'scripts\scoped-worker-credentials.ps1') -Action ReplaceAws
  $replaced = @(Import-Clixml -LiteralPath $file)
  if (@($replaced | Where-Object UserName -CEQ 'SCOPED_POSTGRES_PASSWORD')[0].GetNetworkCredential().Password -cne 'TEST!WORKER' -or
      @($replaced | Where-Object UserName -CEQ 'CATALOGUE_POSTGRES_PASSWORD')[0].GetNetworkCredential().Password -cne 'SYNTHETIC_TEST_READER' -or
      @($replaced | Where-Object UserName -CEQ 'AWS_ACCESS_KEY_ID')[0].GetNetworkCredential().Password -cne 'SYNTHETIC_REPLACED_KEY') {
    throw 'AWS-only replacement did not preserve PostgreSQL credentials.'
  }
  if ([IO.File]::ReadAllText($file).Contains('SYNTHETIC_REPLACED_SECRET')) { throw 'Replacement store contains plaintext.' }
  'MOCK_AWS_ONLY_REPLACEMENT_OK'
  & (Join-Path $backend 'scripts\scoped-worker-credentials.ps1') -Action Remove
  if (Test-Path -LiteralPath $file) { throw 'Credential removal failed.' }
  'NONADMIN_DACL_DPAPI_REUSE_AND_REMOVAL_OK'
} finally {
  if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force }
  foreach ($path in @($service,$ca,$directory,(Join-Path $local 'MedDecode'),$local,$postgres,$roaming,$root)) {
    if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue }
  }
}
