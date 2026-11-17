[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
$root='C:\Users\dahiy\MedDecode-integration'
$psql='C:\Program Files\PostgreSQL\17\bin\psql.exe'
$createdb='C:\Program Files\PostgreSQL\17\bin\createdb.exe'
$dropdb='C:\Program Files\PostgreSQL\17\bin\dropdb.exe'
$db='meddecode_rollout_generation_20261116'
$pass=Join-Path $env:USERPROFILE 'MedDecode-ScopedWorker-PG17-20261114\local-test.pgpass'
$migration=Join-Path $root 'backend\database\integration-migrations\202611160008_automatic_rollout_generation_v1'
$bootstrap=Join-Path $root 'backend\tests\automatic-rollout-generation.local.sql'
$env:PGPASSFILE=$pass
$createdTestWorkerRole=$false
$passedCases=@()
$testError=$null
$cleanupErrors=@()

function Record-Pass([string]$Name) {
  $script:passedCases += $Name
  Write-Output "TEST_PASS:$Name"
}

$ready=& 'C:\Program Files\PostgreSQL\17\bin\pg_isready.exe' -h 127.0.0.1 -p 55439 2>$null
if($ready -notmatch 'accepting connections'){throw 'The suite runner must start PostgreSQL before running admission tests.'}

try {
  & $dropdb -h 127.0.0.1 -p 55439 -U scoped_cluster_admin --if-exists $db
  if($LASTEXITCODE){throw 'Stale disposable database cleanup failed.'}
  $roleExists=& $psql -X -w -qAt -h 127.0.0.1 -p 55439 -U scoped_cluster_admin -d postgres -c "SELECT 1 FROM pg_roles WHERE rolname='meddecode_auto_worker_login'"
  if($LASTEXITCODE){throw 'Unable to inspect the local automatic-worker role.'}
  if($roleExists -eq '1'){throw 'Refusing to alter an existing local automatic-worker role.'}
  'CREATE ROLE meddecode_auto_worker_login LOGIN NOINHERIT; GRANT meddecode_scoped_worker TO meddecode_auto_worker_login WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;' | & $psql -X -w -h 127.0.0.1 -p 55439 -U scoped_cluster_admin -d postgres -v ON_ERROR_STOP=1
  if($LASTEXITCODE){throw 'Local automatic worker identity provisioning failed.'}
  $createdTestWorkerRole=$true
  & $createdb -h 127.0.0.1 -p 55439 -U scoped_cluster_admin -O postgres $db
  if($LASTEXITCODE){throw 'Disposable database creation failed.'}
  & $psql -X -w -h 127.0.0.1 -p 55439 -U postgres -d $db -v ON_ERROR_STOP=1 -f $bootstrap
  if($LASTEXITCODE){throw 'Synthetic V3 baseline failed.'}
  & $psql -X -w -h 127.0.0.1 -p 55439 -U postgres -d $db -At -c "SELECT current_database(),current_user,session_user,to_regprocedure('public.submit_automatic_prescription_analysis_job_v1(uuid,jsonb)'),to_regprocedure('public.meddecode_scoped_authorize_next_automatic_job_v1(text)'),to_regprocedure('public.meddecode_scoped_authorize_next_v3_job_v1(text)');"
  foreach($name in '001_preflight.sql','002_up.sql','003_verify.sql') {
    $text=Get-Content (Join-Path $migration $name) -Raw
    $text=$text -replace "current_database\(\) <> 'postgres'","current_database() <> '$db'" -replace "current_database\(\)<>'postgres'","current_database()<>'$db'"
    $temp=Join-Path $env:TEMP ("$name."+[guid]::NewGuid()+'.sql')
    try { [IO.File]::WriteAllText($temp,$text); & $psql -X -w -h 127.0.0.1 -p 55439 -U postgres -d $db -v ON_ERROR_STOP=1 -f $temp; if($LASTEXITCODE){throw "$name failed"} } finally { Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue }
  }
  $test=@'
BEGIN;
DO $x$ BEGIN
 SET LOCAL request.jwt.claim.sub='10000000-0000-4000-8000-000000000001'; SET LOCAL ROLE authenticated;
 BEGIN PERFORM * FROM public.submit_automatic_prescription_analysis_job_v1('30000000-0000-4000-8000-000000000003','{}'); RAISE EXCEPTION 'disabled admitted'; EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
 RESET ROLE;
 UPDATE public.meddecode_auto_worker_policy SET enabled=true,activated_at=clock_timestamp() WHERE singleton;
 UPDATE public.meddecode_auto_rollout_generations SET activated_at=clock_timestamp() WHERE generation=2;
 RESET ROLE;
 END $x$;
COMMIT;
SELECT 'AUTOMATIC_ROLLOUT_GENERATION_FUNCTIONAL_OK';
'@
  $test | & $psql -X -w -h 127.0.0.1 -p 55439 -U scoped_cluster_admin -d $db -v ON_ERROR_STOP=1
  if($LASTEXITCODE){throw 'Functional verification failed.'}
  Record-Pass 'generation008_disabled_admission_and_functional_behavior'
  $concurrentSql=@('30000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000002') | ForEach-Object { "BEGIN; SET LOCAL request.jwt.claim.sub='10000000-0000-4000-8000-000000000001'; SET LOCAL ROLE authenticated; SELECT * FROM public.submit_automatic_prescription_analysis_job_v1('$_','{}'); COMMIT;" }
  $jobs=@(); foreach($sql in $concurrentSql){$jobs += Start-Job -ArgumentList $psql,$db,$sql,$pass -ScriptBlock { param($exe,$database,$statement,$passfile); $env:PGPASSFILE=$passfile; & $exe -X -w -h 127.0.0.1 -p 55439 -U scoped_cluster_admin -d $database -v ON_ERROR_STOP=1 -c $statement 2>$null; "EXIT_CODE=$LASTEXITCODE" }}
  $jobs | Wait-Job | Out-Null; $codes=@($jobs | ForEach-Object { $out=(Receive-Job $_ -ErrorAction SilentlyContinue | Out-String); [void]($out -match 'EXIT_CODE=(\d+)'); $Matches[1] }); $jobs | Remove-Job -Force
  if((@($codes | Where-Object {$_ -eq '0'}).Count) -ne 1 -or (@($codes | Where-Object {$_ -ne '0'}).Count) -ne 1){throw "Concurrent admission did not produce exactly one success and one rejection: $($codes -join ',')."}
  Record-Pass 'concurrent_admission_exactly_one_success'
  $verify=@'
BEGIN;
DO $x$ BEGIN
 IF (SELECT count(*) FROM public.meddecode_auto_authorized_jobs WHERE rollout_generation=1)<>2 OR (SELECT count(*) FROM public.meddecode_auto_authorized_jobs WHERE rollout_generation=2)<>1 THEN RAISE EXCEPTION 'concurrent generation limit failed'; END IF;
END $x$;
SET SESSION AUTHORIZATION meddecode_auto_worker_login; SET LOCAL ROLE meddecode_scoped_worker;
DO $x$ DECLARE r record; BEGIN SELECT * INTO r FROM public.meddecode_scoped_authorize_next_automatic_job_v1('meddecode-auto-worker-001'); IF NOT r.authorized THEN RAISE EXCEPTION 'generation 2 issuer failed'; END IF; END $x$;
RESET SESSION AUTHORIZATION;
DO $x$ BEGIN IF EXISTS(SELECT FROM public.meddecode_scoped_worker_scope WHERE job_id='40000000-0000-4000-8000-000000000002') THEN RAISE EXCEPTION 'generation 1 queued job leaked'; END IF; END $x$;
ROLLBACK;
SELECT 'AUTOMATIC_ROLLOUT_GENERATION_CONCURRENCY_OK';
'@
  $verify | & $psql -X -w -h 127.0.0.1 -p 55439 -U scoped_cluster_admin -d $db -v ON_ERROR_STOP=1
  if($LASTEXITCODE){throw 'Concurrent admission verification failed.'}
  Record-Pass 'generation2_scope_and_generation1_isolation'
  Write-Output 'AUTOMATIC_ROLLOUT_GENERATION_LOCAL_TEST_OK'
} catch {
  $testError=$_.Exception.Message
  Write-Output "TEST_FAIL:admission:$testError"
}

$priorErrorAction=$ErrorActionPreference
$ErrorActionPreference='Continue'
$ready=& 'C:\Program Files\PostgreSQL\17\bin\pg_isready.exe' -h 127.0.0.1 -p 55439 2>$null
if($ready -match 'accepting connections') {
  & $dropdb -h 127.0.0.1 -p 55439 -U scoped_cluster_admin --if-exists $db 2>&1 | ForEach-Object { Write-Output $_ }
  if($LASTEXITCODE -ne 0){$cleanupErrors += 'Could not drop the admission test database.'}
  if($createdTestWorkerRole) {
    'REVOKE meddecode_scoped_worker FROM meddecode_auto_worker_login; DROP ROLE meddecode_auto_worker_login;' | & $psql -X -w -h 127.0.0.1 -p 55439 -U scoped_cluster_admin -d postgres -v ON_ERROR_STOP=1 2>&1 | ForEach-Object { Write-Output $_ }
    if($LASTEXITCODE -ne 0){$cleanupErrors += 'Could not drop the admission test worker role.'}
  }
} else {
  $cleanupErrors += 'PostgreSQL was unavailable; admission test database and role cleanup could not be verified.'
}
Remove-Item Env:PGPASSFILE -ErrorAction SilentlyContinue
$ErrorActionPreference=$priorErrorAction
if($cleanupErrors.Count -gt 0){Write-Output "TEST_FAIL:cleanup:$($cleanupErrors -join ' ')"; $testError='cleanup failed'}
$failedCount=if($testError){1}else{0}
Write-Output "TEST_SUMMARY suite=admission passed=$($passedCases.Count) failed=$failedCount"
if($failedCount -gt 0){exit 1}
