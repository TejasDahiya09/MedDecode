param(
  [Parameter(Mandatory = $true)]
  [string]$OutputPath,
  [string]$PgBinDirectory
)

$ErrorActionPreference = "Stop"

if (-not $PgBinDirectory) {
  $pgDumpCommand = Get-Command "pg_dump.exe" -ErrorAction SilentlyContinue
  if (-not $pgDumpCommand) {
    throw "pg_dump.exe was not found. Pass -PgBinDirectory for the installed PostgreSQL client."
  }
  $PgBinDirectory = Split-Path -Parent $pgDumpCommand.Source
}

$psql = Join-Path $PgBinDirectory "psql.exe"
$pgDump = Join-Path $PgBinDirectory "pg_dump.exe"
$pgRestore = Join-Path $PgBinDirectory "pg_restore.exe"
foreach ($tool in @($psql, $pgDump, $pgRestore)) {
  if (-not (Test-Path $tool -PathType Leaf)) {
    throw "Required PostgreSQL client tool is missing: $tool"
  }
}

$fullOutputPath = [System.IO.Path]::GetFullPath($OutputPath)
if (Test-Path $fullOutputPath) {
  throw "Refusing to overwrite an existing export: $fullOutputPath"
}
$outputDirectory = Split-Path -Parent $fullOutputPath
if (-not (Test-Path $outputDirectory -PathType Container)) {
  throw "Export destination directory does not exist: $outputDirectory"
}

$sourceArgs = @(
  "-w", "-h", "127.0.0.1", "-p", "5433", "-U", "postgres",
  "-d", "meddecode_job_test", "-X", "-A", "-t", "-q",
  "-c", "SELECT current_database() || '|' || host(inet_server_addr()) || '|' || inet_server_port()::text"
)
$identity = (& $psql @sourceArgs).Trim()
if ($LASTEXITCODE -ne 0 -or $identity -ne "meddecode_job_test|127.0.0.1|5433") {
  throw "Refusing export: the local database identity did not match the approved source."
}

$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$verifier = Join-Path $repositoryRoot "backend\database\official_catalogue_snapshot_verify.sql"
& $psql -w -h 127.0.0.1 -p 5433 -U postgres -d meddecode_job_test -X -v ON_ERROR_STOP=1 -f $verifier
if ($LASTEXITCODE -ne 0) {
  throw "The read-only official catalogue snapshot verification failed."
}

& $pgDump -w -h 127.0.0.1 -p 5433 -U postgres -d meddecode_job_test `
  --format=custom --data-only --schema=official_catalogue --no-owner --no-acl `
  "--file=$fullOutputPath"
if ($LASTEXITCODE -ne 0) {
  throw "pg_dump failed. Inspect the partial output before any cleanup or retry."
}

$listing = & $pgRestore --list $fullOutputPath
if ($LASTEXITCODE -ne 0) {
  throw "pg_restore could not read the archive. Preserve it for inspection."
}
$tableDataEntries = @()
foreach ($line in $listing) {
  if ($line -match "TABLE DATA\s+(\S+)\s+(\S+)") {
    $tableDataEntries += "$($Matches[1]).$($Matches[2])"
  }
}
$expectedTables = @(
  "official_catalogue.sources",
  "official_catalogue.releases",
  "official_catalogue.import_batches",
  "official_catalogue.source_records",
  "official_catalogue.ingredients",
  "official_catalogue.formulations",
  "official_catalogue.formulation_ingredients",
  "official_catalogue.products",
  "official_catalogue.product_packages",
  "official_catalogue.price_observations",
  "official_catalogue.regulatory_events",
  "official_catalogue.link_candidates",
  "official_catalogue.catalogue_entities"
)
$missing = @($expectedTables | Where-Object { $_ -notin $tableDataEntries })
$unexpected = @($tableDataEntries | Where-Object { $_ -notin $expectedTables })
if ($missing.Count -gt 0 -or $unexpected.Count -gt 0 -or $tableDataEntries.Count -ne 13) {
  throw "Archive table-data list is incomplete or contains unexpected tables. Preserve it for inspection."
}

$file = Get-Item $fullOutputPath
$hash = (Get-FileHash -Algorithm SHA256 $fullOutputPath).Hash
[pscustomobject]@{
  SourceDatabase = $identity
  ExportScope = "official_catalogue table data only"
  TableDataEntries = $tableDataEntries.Count
  ExportBytes = $file.Length
  SHA256 = $hash
  ArchivePath = $fullOutputPath
} | Format-List
