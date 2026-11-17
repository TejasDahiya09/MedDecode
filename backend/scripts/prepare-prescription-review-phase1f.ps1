[CmdletBinding()]
param([ValidateSet('Prepare','Start','Stop')][string]$Action = 'Prepare')

$ErrorActionPreference = 'Stop'
$pgBin = 'C:\Program Files\PostgreSQL\17\bin'
$data = 'C:\Users\dahiy\MedDecode\tmp\phase1f-pg17'
$log = 'C:\Users\dahiy\MedDecode\tmp\phase1f-pg17.log'
$port = 55440
$database = 'meddecode_phase1f_20261115'
$admin = 'phase1f_admin'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$pgCtl = Join-Path $pgBin 'pg_ctl.exe'
$psql = Join-Path $pgBin 'psql.exe'

function PgArgs([string]$Db = $database) {
  @('-X','-w','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p',"$port",'-U',$admin,'-d',$Db)
}
function IsReady { (& (Join-Path $pgBin 'pg_isready.exe') -h 127.0.0.1 -p $port 2>$null) -match 'accepting connections' }
function Start-Phase1F {
  if (-not (Test-Path (Join-Path $data 'PG_VERSION') -PathType Leaf)) { throw 'Phase 1F cluster is not initialized. Run -Action Prepare.' }
  if (-not (IsReady)) { & $pgCtl start -D $data -l $log -o "-p $port -h 127.0.0.1" -w; if ($LASTEXITCODE) { throw 'Phase 1F PostgreSQL start failed.' } }
}

if ($Action -eq 'Stop') {
  if (Test-Path (Join-Path $data 'PG_VERSION') -PathType Leaf) { & $pgCtl stop -D $data -m fast -w; if ($LASTEXITCODE) { throw 'Phase 1F PostgreSQL stop failed.' } }
  Write-Output 'PHASE1F_DATABASE_STOPPED'; exit
}
if ($Action -eq 'Start') { Start-Phase1F; Write-Output 'PHASE1F_DATABASE_STARTED'; exit }

if (-not (Test-Path (Join-Path $data 'PG_VERSION') -PathType Leaf)) {
  New-Item -ItemType Directory -Force -Path (Split-Path $data) | Out-Null
  & (Join-Path $pgBin 'initdb.exe') -D $data -U $admin --auth-local=trust --auth-host=trust --no-sync
  if ($LASTEXITCODE) { throw 'Phase 1F PostgreSQL initialization failed.' }
}
Start-Phase1F
$exists = & $psql @(PgArgs 'postgres') -qAt -c "SELECT 1 FROM pg_database WHERE datname='$database'"
if ($exists -ne '1') { & (Join-Path $pgBin 'createdb.exe') -h 127.0.0.1 -p $port -U $admin $database; if ($LASTEXITCODE) { throw 'Phase 1F database creation failed.' } }
$installed = & $psql @(PgArgs) -qAt -c "SELECT to_regprocedure('public.meddecode_finalize_review_result_v1(uuid,uuid,uuid,text,text,bigint,jsonb)') IS NOT NULL"
if ($installed -ne 't') {
  & $psql @(PgArgs) -f (Join-Path $repo 'backend\database\integration-migrations\202611120001_processing_job_submission\test\00_bootstrap.sql')
  @'
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='meddecode_worker') THEN CREATE ROLE meddecode_worker NOLOGIN NOINHERIT; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='meddecode_scoped_worker') THEN CREATE ROLE meddecode_scoped_worker NOLOGIN NOINHERIT; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='meddecode_scoped_login') THEN CREATE ROLE meddecode_scoped_login LOGIN NOINHERIT; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='postgres') THEN CREATE ROLE postgres NOLOGIN; END IF;
END $$;
GRANT meddecode_scoped_worker TO meddecode_scoped_login WITH SET TRUE, INHERIT FALSE;
GRANT authenticated TO phase1f_admin WITH SET TRUE, INHERIT FALSE;
'@ | & $psql @(PgArgs)
  & $psql @(PgArgs) -f (Join-Path $repo 'backend\database\integration-migrations\202611120002_processing_worker_claim_heartbeat\002_up.sql')
  & $psql @(PgArgs) -f (Join-Path $repo 'backend\database\integration-migrations\202611120003_processing_worker_finalization_recovery\test\00_completion_fixture.sql')
  'ALTER TABLE public.prescription_intelligence_results ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();' | & $psql @(PgArgs)
  & $psql @(PgArgs) -f (Join-Path $repo 'backend\database\integration-migrations\202611120003_processing_worker_finalization_recovery\002_up.sql')
  & $psql @(PgArgs) -f (Join-Path $repo 'backend\database\scoped-worker-isolation-review.sql')
  & $psql @(PgArgs) -f (Join-Path $repo 'backend\database\integration-migrations\202611150001_prescription_review_v1\002_up.sql')
  & $psql @(PgArgs) -f (Join-Path $repo 'backend\database\integration-migrations\202611150002_prescription_result_history_v1\002_up.sql')
  'GRANT USAGE ON SCHEMA public TO meddecode_scoped_worker;' | & $psql @(PgArgs)
  if ($LASTEXITCODE) { throw 'Phase 1F local migration failed.' }
}
$identity = & $psql @(PgArgs) -qAt -F '|' -c 'SELECT current_user,current_database(),inet_server_addr(),inet_server_port()'
if ($identity -ne "phase1f_admin|$database|127.0.0.1|$port") { throw 'Phase 1F database identity guard failed.' }
Write-Output "PHASE1F_DATABASE_READY:$identity"
