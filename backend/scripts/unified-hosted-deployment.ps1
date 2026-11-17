param(
  [Parameter(Mandatory = $true)]
  [string]$TargetDsn,
  [ValidateSet(
    "preflight",
    "catalogue-preflight",
    "legacy-capture",
    "legacy-truncate-audit",
    "official-schema",
    "replay-identity",
    "archive-restore",
    "catalogue-verify",
    "official-rpc",
    "role-provision",
    "worker-submission-preflight",
    "worker-submission-up",
    "worker-claim-preflight",
    "worker-claim-up",
    "worker-finalization-preflight",
    "worker-finalization-up",
    "post-deploy-verify"
  )]
  [string]$Stage = "preflight",
  [string]$ArchivePath = "",
  [string]$PgBinDirectory = "",
  [string]$ApprovedStage = "",
  [switch]$BackupConfirmed,
  [string]$PythonReaderRole = "meddecode_catalogue_python_reader",
  [string]$WorkerGroupRole = "meddecode_worker",
  [string]$WorkerLoginRole = "meddecode_worker_login"
)

$ErrorActionPreference = "Stop"

$ExpectedArchiveSha256 = "E8962AFA0E5DF6D8F3B090E3EDC61A96E59C9BB3BBDE8A444C57CA77C01E365F"
$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$DatabaseRoot = Join-Path $RepositoryRoot "backend\database"
$MigrationRoot = Join-Path $DatabaseRoot "integration-migrations"

function Resolve-PgTool([string]$Name) {
  if ($PgBinDirectory) {
    $candidate = Join-Path $PgBinDirectory "$Name.exe"
    if (-not (Test-Path $candidate -PathType Leaf)) {
      throw "PostgreSQL client tool is missing: $candidate"
    }
    return $candidate
  }
  $command = Get-Command "$Name.exe" -ErrorAction SilentlyContinue
  if (-not $command) {
    throw "$Name.exe was not found. Pass -PgBinDirectory."
  }
  return $command.Source
}

$psql = Resolve-PgTool "psql"
$pgRestore = Resolve-PgTool "pg_restore"

function Require-StageApproval {
  param([string]$Name)
  if ($ApprovedStage -ne $Name) {
    throw "Mutation stage '$Name' requires -ApprovedStage '$Name'. No hosted mutation was attempted."
  }
  if (-not $BackupConfirmed) {
    throw "Mutation stage '$Name' requires independent backup confirmation via -BackupConfirmed."
  }
}

function Require-BackupConfirmation {
  if (-not $BackupConfirmed) {
    throw "Stage '$Stage' requires independent backup confirmation via -BackupConfirmed."
  }
}

function Invoke-PsqlFile {
  param(
    [Parameter(Mandatory = $true)][string]$File,
    [hashtable]$Variables = @{}
  )
  if (-not (Test-Path $File -PathType Leaf)) {
    throw "SQL file is missing: $File"
  }
  $arguments = @($TargetDsn, "-X", "-v", "ON_ERROR_STOP=1")
  foreach ($key in $Variables.Keys) {
    $arguments += @("-v", "$key=$($Variables[$key])")
  }
  $arguments += @("-f", $File)
  & $psql @arguments
  if ($LASTEXITCODE -ne 0) {
    throw "psql failed for stage file $File. Do not retry until target state is inspected."
  }
}

function Confirm-Archive {
  if (-not $ArchivePath) {
    throw "ArchivePath is required for archive-restore."
  }
  $resolved = (Resolve-Path $ArchivePath -ErrorAction Stop).Path
  $hash = (Get-FileHash -Algorithm SHA256 $resolved).Hash.ToUpperInvariant()
  if ($hash -ne $ExpectedArchiveSha256) {
    throw "Archive SHA-256 mismatch. Expected $ExpectedArchiveSha256; observed $hash."
  }
  return $resolved
}

if ($Stage -in @(
  "official-schema", "replay-identity", "archive-restore", "official-rpc",
  "role-provision", "worker-submission-up",
  "worker-claim-up", "worker-finalization-up"
)) {
  Require-StageApproval $Stage
}

switch ($Stage) {
  "preflight" {
    Invoke-PsqlFile (Join-Path $DatabaseRoot "unified_hosted_preflight.sql") @{
      backup_confirmed = if ($BackupConfirmed) { "true" } else { "false" }
    }
  }
  "catalogue-preflight" {
    Require-BackupConfirmation
    Invoke-PsqlFile (Join-Path $DatabaseRoot "official_catalogue_target_preflight.sql")
  }
  "legacy-capture" {
    Invoke-PsqlFile (Join-Path $DatabaseRoot "legacy_catalogue_state_capture.sql")
  }
  "legacy-truncate-audit" {
    Invoke-PsqlFile (Join-Path $DatabaseRoot "legacy_medicines_truncate_audit.sql")
  }
  "official-schema" {
    Invoke-PsqlFile (Join-Path $DatabaseRoot "official_catalogue_target_preflight.sql")
    Invoke-PsqlFile (Join-Path $MigrationRoot "202611130001_official_catalogue_source_aware\001_up.sql")
  }
  "replay-identity" {
    Invoke-PsqlFile (Join-Path $MigrationRoot "202611130002_official_catalogue_link_replay_identity\001_up.sql")
  }
  "archive-restore" {
    $archive = Confirm-Archive
    & $pgRestore "--dbname=$TargetDsn" "--data-only" "--no-owner" "--no-acl" "--exit-on-error" "--single-transaction" $archive
    if ($LASTEXITCODE -ne 0) {
      throw "pg_restore failed or was interrupted. Do not retry until row counts and transaction state are inspected."
    }
  }
  "catalogue-verify" {
    Invoke-PsqlFile (Join-Path $DatabaseRoot "official_catalogue_snapshot_verify.sql")
  }
  "official-rpc" {
    $rpcRoot = Join-Path $MigrationRoot "202611130004_official_catalogue_read_rpc"
    Invoke-PsqlFile (Join-Path $rpcRoot "001_preflight.sql")
    Invoke-PsqlFile (Join-Path $rpcRoot "002_up.sql")
    Invoke-PsqlFile (Join-Path $rpcRoot "003_verify.sql")
  }
  "role-provision" {
    $roleFile = Join-Path $DatabaseRoot "unified_hosted_role_provision.sql"
    Invoke-PsqlFile $roleFile @{
      python_reader_role = $PythonReaderRole
      worker_group_role = $WorkerGroupRole
      worker_login_role = $WorkerLoginRole
    }
  }
  "worker-submission-preflight" {
    Invoke-PsqlFile (Join-Path $MigrationRoot "202611120001_processing_job_submission\001_preflight.sql")
  }
  "worker-submission-up" {
    Invoke-PsqlFile (Join-Path $DatabaseRoot "worker_activation_safety_preflight.sql")
    Invoke-PsqlFile (Join-Path $MigrationRoot "202611120001_processing_job_submission\002_up.sql")
    Invoke-PsqlFile (Join-Path $MigrationRoot "202611120001_processing_job_submission\003_verify.sql")
  }
  "worker-claim-preflight" {
    Invoke-PsqlFile (Join-Path $MigrationRoot "202611120002_processing_worker_claim_heartbeat\001_preflight.sql")
  }
  "worker-claim-up" {
    Invoke-PsqlFile (Join-Path $DatabaseRoot "worker_activation_safety_preflight.sql")
    Invoke-PsqlFile (Join-Path $MigrationRoot "202611120002_processing_worker_claim_heartbeat\002_up.sql")
    Invoke-PsqlFile (Join-Path $MigrationRoot "202611120002_processing_worker_claim_heartbeat\003_verify.sql")
  }
  "worker-finalization-preflight" {
    Invoke-PsqlFile (Join-Path $MigrationRoot "202611120003_processing_worker_finalization_recovery\001_preflight.sql")
  }
  "worker-finalization-up" {
    Invoke-PsqlFile (Join-Path $DatabaseRoot "worker_activation_safety_preflight.sql")
    Invoke-PsqlFile (Join-Path $MigrationRoot "202611120003_processing_worker_finalization_recovery\002_up.sql")
    Invoke-PsqlFile (Join-Path $MigrationRoot "202611120003_processing_worker_finalization_recovery\003_verify.sql")
  }
  "post-deploy-verify" {
    Invoke-PsqlFile (Join-Path $DatabaseRoot "unified_hosted_post_deploy_verify.sql")
  }
}

Write-Output "Completed stage: $Stage"
