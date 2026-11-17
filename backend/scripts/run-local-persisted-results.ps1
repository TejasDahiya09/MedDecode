[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$backend = Split-Path -Parent $PSScriptRoot
$serviceFile = Join-Path $env:APPDATA 'postgresql\pg_service.conf'
$section = [regex]::Match((Get-Content -LiteralPath $serviceFile -Raw),
  '(?ms)^\[meddecode_hosted_admin\]\s*\r?\n(?<body>.*?)(?=^\[|\z)').Groups['body'].Value
if ($section -notmatch '(?m)^\s*sslmode\s*=\s*verify-full\s*$' -or
    $section -notmatch 'wyripeqruhvbksjfsvlr' -or
    $section -notmatch '(?m)^\s*dbname\s*=\s*postgres\s*$') {
  throw 'Hosted read-only service identity or TLS guard failed.'
}
if ($env:PGHOSTADDR -or $env:PGOPTIONS) { throw 'Unexpected PostgreSQL environment override.' }
$keys = @('PGSERVICEFILE','PGOPTIONS','PGPASSFILE','LOCAL_DEMO_OWNER_ID','LOCAL_PERSISTED_DEMO_ENABLED','PROCESSING_WORKER_ENABLED')
$old = @{}
foreach ($key in $keys) { $old[$key] = [Environment]::GetEnvironmentVariable($key,'Process') }
$temp = $null
try {
  $env:PGSERVICEFILE = $serviceFile
  $env:PGOPTIONS = '-c default_transaction_read_only=on'
  $owner = & 'C:\Program Files\PostgreSQL\17\bin\psql.exe' -X -w -qAt -v ON_ERROR_STOP=1 -d 'service=meddecode_hosted_admin' -c "SELECT p.user_id FROM public.prescriptions p JOIN public.ai_jobs j ON j.prescription_id=p.id AND j.user_id=p.user_id WHERE p.id='79dac9bf-4ea2-4949-acfa-caea7c301040'::uuid AND j.id='65624a5e-f197-465e-a34a-712f979e9624'::uuid AND j.status='cancelled';"
  if ($LASTEXITCODE -ne 0 -or @($owner).Count -ne 1 -or $owner -notmatch '^[0-9a-f-]{36}$') { throw 'Approved synthetic owner lookup failed.' }
  $env:PGSERVICEFILE = $null
  $env:PGOPTIONS = $null
  $source = Join-Path $env:APPDATA 'postgresql\pgpass.conf'
  $line = Get-Content -LiteralPath $source | Where-Object { $_ -match '^127\.0\.0\.1:5433:postgres:postgres:' } | Select-Object -First 1
  if (-not $line) { throw 'Existing local PostgreSQL credential is unavailable.' }
  $temp = New-TemporaryFile
  $acl = Get-Acl -LiteralPath $temp.FullName
  $acl.SetAccessRuleProtection($true,$false)
  $acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new([System.Security.Principal.WindowsIdentity]::GetCurrent().User,'FullControl','Allow'))
  Set-Acl -LiteralPath $temp.FullName -AclObject $acl
  [IO.File]::WriteAllLines($temp.FullName,@($line.Replace('127.0.0.1:5433:postgres:postgres:','127.0.0.1:5433:meddecode_worker_final_20261113:postgres:')),[Text.Encoding]::ASCII)
  $env:PGPASSFILE = $temp.FullName
  $env:LOCAL_DEMO_OWNER_ID = $owner
  $env:LOCAL_PERSISTED_DEMO_ENABLED = 'true'
  $env:PROCESSING_WORKER_ENABLED = 'false'
  Push-Location $backend
  try {
    & npx --no-install tsx scripts/local-persisted-results-server.ts
    if ($LASTEXITCODE -ne 0) { throw 'Local read-only server stopped with an error.' }
  } finally { Pop-Location }
} finally {
  foreach ($key in $keys) { [Environment]::SetEnvironmentVariable($key,$old[$key],'Process') }
  if ($temp) { Remove-Item -LiteralPath $temp.FullName -Force }
}
