param(
  [string]$DatabaseName = "meddecode_catalogue_rpc_runtime_20261113_01",
  [string]$PgBinDirectory = "C:\Program Files\PostgreSQL\17\bin"
)

$ErrorActionPreference = "Stop"
$protectedDatabases = @(
  "meddecode_job_test",
  "meddecode_worker_test",
  "meddecode_backup_restore_test",
  "meddecode_catalogue_rpc_test"
)
if ($DatabaseName -notmatch '^meddecode_catalogue_rpc_runtime_20261113_01$') {
  throw "Refusing an unexpected catalogue RPC test database name."
}
if ($DatabaseName -in $protectedDatabases) {
  throw "Refusing a protected MedDecode database."
}

$psql = Join-Path $PgBinDirectory "psql.exe"
if (-not (Test-Path $psql -PathType Leaf)) {
  throw "psql.exe was not found: $psql"
}

$databaseList = & $psql -w -h 127.0.0.1 -p 5433 -U postgres -d postgres `
  -X -A -t -v ON_ERROR_STOP=1 -c "SELECT datname FROM pg_database WHERE datname = '$DatabaseName'"
if ($LASTEXITCODE -ne 0) {
  throw "Could not verify local PostgreSQL database inventory."
}
if (-not ($databaseList -contains $DatabaseName)) {
  throw "Target database does not exist. Obtain separate approval to create it; this runner never creates databases."
}

$identity = (& $psql -w -h 127.0.0.1 -p 5433 -U postgres -d $DatabaseName `
  -X -A -t -v ON_ERROR_STOP=1 -c "SELECT current_database() || '|' || host(inet_server_addr()) || '|' || inet_server_port()::text").Trim()
if ($LASTEXITCODE -ne 0 -or $identity -ne "$DatabaseName|127.0.0.1|5433") {
  throw "Target identity did not match the guarded local PostgreSQL endpoint."
}

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..\..\..")).Path
$migrationRoot = Join-Path $root "backend\database\integration-migrations"
$rpcRoot = Join-Path $migrationRoot "202611130004_official_catalogue_read_rpc"
$files = @(
  (Join-Path $rpcRoot "test\00_auth_fixture.sql"),
  (Join-Path $migrationRoot "202611130001_official_catalogue_source_aware\001_up.sql"),
  (Join-Path $migrationRoot "202611130002_official_catalogue_link_replay_identity\001_up.sql"),
  (Join-Path $rpcRoot "001_preflight.sql"),
  (Join-Path $rpcRoot "002_up.sql"),
  (Join-Path $rpcRoot "003_verify.sql"),
  (Join-Path $rpcRoot "test\10_synthetic_fixture.sql"),
  (Join-Path $rpcRoot "test\20_behavior.sql"),
  (Join-Path $rpcRoot "test\30_unauthorized.sql")
)

foreach ($file in $files) {
  & $psql -w -h 127.0.0.1 -p 5433 -U postgres -d $DatabaseName `
    -X -v ON_ERROR_STOP=1 -v "test_database=$DatabaseName" -f $file
  if ($LASTEXITCODE -ne 0) {
    throw "Catalogue RPC isolated test step failed: $file"
  }
}
Write-Output "PASS: isolated catalogue RPC runtime tests on $identity"
