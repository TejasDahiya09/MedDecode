[CmdletBinding()]
param([ValidateSet('pdf','jpg','png')][string]$Format = 'pdf')
# Synthetic fixtures and local PostgreSQL only. No hosted writes or AWS calls.
$ErrorActionPreference = 'Stop'
$backend = Split-Path -Parent $PSScriptRoot
$root = Split-Path -Parent $backend
$fixtures = 'C:\Users\dahiy\MedDecode-Test-Fixtures'
$python = Join-Path $root 'intelligence\.venv\Scripts\python.exe'
$models = Join-Path $fixtures 'easyocr-model-cache'
$fixture = Join-Path $fixtures $(if ($Format -eq 'pdf') { 'synthetic-prescription-002.pdf' } else { "synthetic-prescription-001.$Format" })
foreach ($path in @($python, $fixture, (Join-Path $models 'craft_mlt_25k.pth'), (Join-Path $models 'english_g2.pth'))) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw 'Required local fictional fixture, model or Python executable is missing.' }
}
if ($env:PGHOSTADDR -and $env:PGHOSTADDR -cne '127.0.0.1') { throw 'Unexpected PostgreSQL host override.' }
if ($env:PGSERVICE -or $env:PGOPTIONS) { throw 'Unexpected PostgreSQL service or options override.' }
$passwordFile = Join-Path $env:APPDATA 'postgresql\pgpass.conf'
$line = Get-Content -LiteralPath $passwordFile | Where-Object { $_ -match '^127\.0\.0\.1:5433:postgres:postgres:' } | Select-Object -First 1
if (-not $line) { throw 'Existing local PostgreSQL maintenance credential entry is unavailable.' }
$keys = @('PGPASSFILE','WORKER_LOCAL_SYNTHETIC_TEST','WORKER_SYNTHETIC_REAL_OCR','WORKER_TEST_FORMAT','MEDDECODE_PYTHON','MEDDECODE_INTELLIGENCE_DIR','MEDDECODE_EASYOCR_MODELS')
$old = @{}
foreach ($key in $keys) { $old[$key] = [Environment]::GetEnvironmentVariable($key,'Process') }
$temp = $null
try {
  $temp = New-TemporaryFile
  $acl = Get-Acl -LiteralPath $temp.FullName
  $acl.SetAccessRuleProtection($true,$false)
  $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
  $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','Allow'))
  Set-Acl -LiteralPath $temp.FullName -AclObject $acl
  $lines = @(
    $line.Replace('127.0.0.1:5433:postgres:postgres:','127.0.0.1:5433:meddecode_worker_final_20261113:postgres:'),
    $line.Replace('127.0.0.1:5433:postgres:postgres:','127.0.0.1:5433:meddecode_job_test:postgres:')
  )
  [IO.File]::WriteAllLines($temp.FullName,$lines,[Text.Encoding]::ASCII)
  $env:PGPASSFILE = $temp.FullName
  $env:WORKER_LOCAL_SYNTHETIC_TEST = 'true'
  $env:WORKER_SYNTHETIC_REAL_OCR = 'true'
  $env:WORKER_TEST_FORMAT = $Format
  $env:MEDDECODE_PYTHON = $python
  $env:MEDDECODE_INTELLIGENCE_DIR = Join-Path $root 'intelligence'
  $env:MEDDECODE_EASYOCR_MODELS = $models
  Push-Location $backend
  try {
    & npx --no-install tsx tests/worker-postgres-lifecycle.manual.ts
    if ($LASTEXITCODE -ne 0) { throw 'Local synthetic demonstration failed; inspect before retry.' }
  } finally { Pop-Location }
} finally {
  foreach ($key in $keys) { [Environment]::SetEnvironmentVariable($key,$old[$key],'Process') }
  if ($temp) { Remove-Item -LiteralPath $temp.FullName -Force }
}
