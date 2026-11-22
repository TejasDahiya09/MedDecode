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
$catalogueInstalled = & $psql @(PgArgs) -qAt -c "SELECT to_regclass('official_catalogue.catalogue_entities') IS NOT NULL"
if ($catalogueInstalled -ne 't') {
  & $psql @(PgArgs) -f (Join-Path $repo 'backend\database\integration-migrations\202611130001_official_catalogue_source_aware\001_up.sql')
  if ($LASTEXITCODE) { throw 'Phase 1F local catalogue schema installation failed.' }
  & $psql @(PgArgs) -v "test_database=$database" -f (Join-Path $repo 'backend\database\integration-migrations\202611130004_official_catalogue_read_rpc\test\10_synthetic_fixture.sql')
  if ($LASTEXITCODE) { throw 'Phase 1F synthetic catalogue fixture installation failed.' }
}
@'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='meddecode_catalogue_rc1a_reader') THEN
    CREATE ROLE meddecode_catalogue_rc1a_reader LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END $$;
ALTER ROLE meddecode_catalogue_rc1a_reader SET default_transaction_read_only = on;
REVOKE ALL ON SCHEMA official_catalogue FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA official_catalogue FROM PUBLIC;
GRANT CONNECT ON DATABASE meddecode_phase1f_20261115 TO meddecode_catalogue_rc1a_reader;
GRANT USAGE ON SCHEMA official_catalogue TO meddecode_catalogue_rc1a_reader;
GRANT SELECT ON official_catalogue.catalogue_entities TO meddecode_catalogue_rc1a_reader;
'@ | & $psql @(PgArgs)
if ($LASTEXITCODE) { throw 'Phase 1F restricted catalogue role installation failed.' }
$catalogue = & $psql -X -w -qAt -F '|' -h 127.0.0.1 -p $port -U meddecode_catalogue_rc1a_reader -d $database -c "BEGIN READ ONLY; SELECT current_user,current_setting('transaction_read_only'),count(*),bool_and(entity_id::text LIKE 'd2000000-0000-4000-8000-%') FROM official_catalogue.catalogue_entities; ROLLBACK;"
if ($LASTEXITCODE -or $catalogue -notmatch "meddecode_catalogue_rc1a_reader\|on\|4\|t") { throw 'Phase 1F restricted catalogue verification failed.' }
$catalogueAcl = & $psql @(PgArgs) -qAt -F '|' -c "SELECT has_table_privilege('meddecode_catalogue_rc1a_reader','official_catalogue.catalogue_entities','SELECT'),has_table_privilege('meddecode_catalogue_rc1a_reader','official_catalogue.catalogue_entities','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')"
if ($catalogueAcl -ne 't|f') { throw 'Phase 1F restricted catalogue ACL verification failed.' }
$initialCompletion = & $psql @(PgArgs) -qAt -c "SELECT to_regprocedure('public.meddecode_complete_initial_review_job_v1(uuid,uuid,text,integer,bigint)') IS NOT NULL"
if ($initialCompletion -ne 't') {
  @'
ALTER TABLE public.meddecode_auto_worker_policy
  ADD COLUMN IF NOT EXISTS current_rollout_generation bigint NOT NULL DEFAULT 2 CHECK (current_rollout_generation > 0);
ALTER TABLE public.meddecode_auto_authorized_jobs
  ADD COLUMN IF NOT EXISTS rollout_generation bigint NOT NULL DEFAULT 2 CHECK (rollout_generation > 0);
UPDATE public.meddecode_auto_worker_policy
SET current_rollout_generation=2, enabled=false, activated_at=NULL
WHERE singleton;
'@ | & $psql @(PgArgs)
  if ($LASTEXITCODE) { throw 'Phase 1F local rollout-generation compatibility setup failed.' }
  & $psql @(PgArgs) -f (Join-Path $repo 'backend\database\integration-migrations\202611160010_prescription_review_initial_completion_v1\002_up.sql')
  if ($LASTEXITCODE) { throw 'Phase 1F initial-review completion migration failed.' }
}
@'
ALTER TABLE public.prescriptions
  ADD COLUMN IF NOT EXISTS file_type text,
  ADD COLUMN IF NOT EXISTS file_size_bytes bigint;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='rc1b_prescriptions_file_type_check') THEN
    ALTER TABLE public.prescriptions ADD CONSTRAINT rc1b_prescriptions_file_type_check
      CHECK (file_type IS NULL OR file_type IN ('application/pdf','image/jpeg','image/png'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='rc1b_prescriptions_file_size_check') THEN
    ALTER TABLE public.prescriptions ADD CONSTRAINT rc1b_prescriptions_file_size_check
      CHECK (file_size_bytes IS NULL OR file_size_bytes BETWEEN 1 AND 10485760);
  END IF;
END $$;
'@ | & $psql @(PgArgs)
if ($LASTEXITCODE) { throw 'Phase 1F upload-schema compatibility setup failed.' }
$identity = & $psql @(PgArgs) -qAt -F '|' -c 'SELECT current_user,current_database(),inet_server_addr(),inet_server_port()'
if ($identity -ne "phase1f_admin|$database|127.0.0.1|$port") { throw 'Phase 1F database identity guard failed.' }
Write-Output "PHASE1F_DATABASE_READY:$identity"
& $psql @(PgArgs) -f (Join-Path $repo 'backend\scripts\phase1f-user-modules.sql')
if ($LASTEXITCODE) { throw 'Phase 1F user-module fixture installation failed.' }
Write-Output 'PHASE1F_USER_MODULES_READY:verified'
Write-Output 'RC1A_SYNTHETIC_CATALOGUE_READY:records=4:restricted_reader=verified'
Write-Output 'RC1B_INITIAL_REVIEW_COMPLETION_READY:verified'
