[CmdletBinding()]
param()

$ErrorActionPreference='Stop'
$root='C:\Users\dahiy\MedDecode-integration'
$pg='C:\Program Files\PostgreSQL\17\bin'
$port=55439
$database='meddecode_generation2_activation_20261116'
$pass=Join-Path $env:USERPROFILE 'MedDecode-ScopedWorker-PG17-20261114\local-test.pgpass'
$migration=Join-Path $root 'backend\database\integration-migrations\202611160011_automatic_rollout_generation_2_activation_v1'
$generation=Join-Path $root 'backend\database\integration-migrations\202611160008_automatic_rollout_generation_v1'
$bootstrap=Join-Path $root 'backend\tests\automatic-rollout-generation.local.sql'
$owner='10000000-0000-4000-8000-000000000001'
$env:PGPASSFILE=$pass
$createdTestWorkerRole=$false
$localWorkerPassword=$null
$script:passedCases=@()
$testError=$null
$cleanupErrors=@()

function Record-Pass([string]$Name) {
  $script:passedCases += $Name
  Write-Output "TEST_PASS:$Name"
}

function Psql([string]$Sql,[string[]]$Variables=@(),[string]$User='postgres',[switch]$AllowFailure) {
  $args=@('-X','-w','-h','127.0.0.1','-p',$port,'-U',$User,'-d',$database,'-v','ON_ERROR_STOP=1') + $Variables + @('-c',$Sql)
  $priorErrorAction=$ErrorActionPreference; $ErrorActionPreference='Continue'
  $output=& "$pg\psql.exe" @args 2>&1
  $exitCode=$LASTEXITCODE
  $ErrorActionPreference=$priorErrorAction
  if($exitCode -ne 0 -and -not $AllowFailure){throw "Local test SQL failed as $User (exit $exitCode): $($output|Out-String)"}
  return $exitCode
}
function Invoke-Artifact([string]$Name,[string[]]$Variables=@(),[string]$User='postgres',[switch]$PreserveProductionDatabaseGuard) {
  $text=Get-Content (Join-Path $migration $Name) -Raw
  if(-not $PreserveProductionDatabaseGuard) {
    $text=$text -replace "current_database\(\) <> 'postgres'","current_database() <> '$database'" -replace "current_database\(\)<>'postgres'","current_database()<>'$database'"
  }
  $tmp=Join-Path $env:TEMP ("$Name."+[guid]::NewGuid()+'.sql')
  try {
    [IO.File]::WriteAllText($tmp,$text)
    $args=@('-X','-w','-h','127.0.0.1','-p',$port,'-U',$User,'-d',$database,'-v','ON_ERROR_STOP=1') + $Variables + @('-f',$tmp)
    $priorErrorAction=$ErrorActionPreference; $ErrorActionPreference='Continue'
    $out=& "$pg\psql.exe" @args 2>&1
    $exitCode=$LASTEXITCODE; $ErrorActionPreference=$priorErrorAction
    [pscustomobject]@{ ExitCode=$exitCode; Output=($out|Out-String) }
  } finally { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
}
function New-Baseline {
  & "$pg\psql.exe" -X -w -h 127.0.0.1 -p $port -U scoped_cluster_admin -d postgres -v ON_ERROR_STOP=1 -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$database' AND pid<>pg_backend_pid()" 2>$null | Out-Null
  $priorErrorAction=$ErrorActionPreference; $ErrorActionPreference='Continue'
  & "$pg\dropdb.exe" -h 127.0.0.1 -p $port -U scoped_cluster_admin --if-exists $database 2>$null
  $ErrorActionPreference=$priorErrorAction
  & "$pg\createdb.exe" -h 127.0.0.1 -p $port -U scoped_cluster_admin -O postgres $database
  if($LASTEXITCODE){throw 'disposable database creation failed'}
  & "$pg\psql.exe" -X -w -h 127.0.0.1 -p $port -U postgres -d $database -v ON_ERROR_STOP=1 -f $bootstrap
  if($LASTEXITCODE){throw 'baseline bootstrap failed'}
  $up=Get-Content (Join-Path $generation '002_up.sql') -Raw
  $up=$up -replace "current_database\(\)<>'postgres'","current_database()<>'$database'"
  $tmp=Join-Path $env:TEMP ('generation008.'+[guid]::NewGuid()+'.sql')
  try { [IO.File]::WriteAllText($tmp,$up); & "$pg\psql.exe" -X -w -h 127.0.0.1 -p $port -U postgres -d $database -v ON_ERROR_STOP=1 -f $tmp; if($LASTEXITCODE){throw 'Generation 008 baseline failed'} } finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
  $stub="CREATE FUNCTION public.meddecode_complete_initial_review_job_v1(uuid,uuid,text,integer,bigint) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS 'SELECT ''{}''::jsonb'; REVOKE ALL ON FUNCTION public.meddecode_complete_initial_review_job_v1(uuid,uuid,text,integer,bigint) FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.meddecode_complete_initial_review_job_v1(uuid,uuid,text,integer,bigint) TO meddecode_scoped_worker;"
  if((Psql $stub) -ne 0){throw 'Migration 010 RPC compatibility stub failed'}
}
function Snapshot {
  (& "$pg\psql.exe" -X -w -qAt -h 127.0.0.1 -p $port -U postgres -d $database -c "SELECT md5(jsonb_build_object('policy',(SELECT to_jsonb(p) FROM public.meddecode_auto_worker_policy p),'generation1',(SELECT to_jsonb(g) FROM public.meddecode_auto_rollout_generations g WHERE generation=1),'generation2',(SELECT to_jsonb(g) FROM public.meddecode_auto_rollout_generations g WHERE generation=2),'admissions',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.job_id) FROM public.meddecode_auto_authorized_jobs a),'scopes',(SELECT jsonb_agg(to_jsonb(s) ORDER BY s.job_id) FROM public.meddecode_scoped_worker_scope s))::text)").Trim()
}
function Generation1Snapshot {
  (& "$pg\psql.exe" -X -w -qAt -h 127.0.0.1 -p $port -U postgres -d $database -c "SELECT md5(jsonb_build_object('generation',(SELECT to_jsonb(g) FROM public.meddecode_auto_rollout_generations g WHERE generation=1),'admissions',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.job_id) FROM public.meddecode_auto_authorized_jobs a WHERE rollout_generation=1))::text)").Trim()
}
function New-ActivatedBaseline {
  New-Baseline
  $activation=Invoke-Artifact '002_activate.sql' $script:vars
  if($activation.ExitCode -ne 0 -or $activation.Output -notmatch 'AUTOMATIC_ROLLOUT_GENERATION_2_ACTIVATED') {
    throw 'Unable to prepare activated baseline for independent-verifier tests'
  }
}
function Assert-VerificationRejected([scriptblock]$Setup,[string]$Label) {
  New-ActivatedBaseline
  & $Setup
  $result=Invoke-Artifact '003_verify.sql' $script:vars
  if($result.ExitCode -eq 0){throw "Independent verification accepted $Label"}
  Write-Output "VERIFY_REJECTED:$Label"
  Record-Pass "verify_rejects_$Label"
}
function Assert-RejectedUnchanged([scriptblock]$Setup,[string]$Label) {
  New-Baseline; & $Setup; $before=Snapshot; $r=Invoke-Artifact '002_activate.sql' $script:vars; if($r.ExitCode -eq 0){throw "$Label unexpectedly activated"}; if((Snapshot) -ne $before){throw "$Label changed state despite rejection"}; Write-Output "REJECTED_UNCHANGED:$Label"; Record-Pass "rejects_$Label"
}

$ready=& "$pg\pg_isready.exe" -h 127.0.0.1 -p $port 2>$null
if($ready -notmatch 'accepting connections'){throw 'The suite runner must start PostgreSQL before running activation tests.'}

try {
  $roleExists=& "$pg\psql.exe" -X -w -qAt -h 127.0.0.1 -p $port -U scoped_cluster_admin -d postgres -c "SELECT 1 FROM pg_roles WHERE rolname='meddecode_auto_worker_login'"
  if($roleExists -eq '1'){throw 'Refusing to alter an existing local automatic-worker role'}
  $localWorkerPassword=[guid]::NewGuid().ToString('N')+[guid]::NewGuid().ToString('N')
  & "$pg\psql.exe" -X -w -h 127.0.0.1 -p $port -U scoped_cluster_admin -d postgres -v ON_ERROR_STOP=1 -c "CREATE ROLE meddecode_auto_worker_login LOGIN NOINHERIT PASSWORD '$localWorkerPassword'; GRANT meddecode_scoped_worker TO meddecode_auto_worker_login WITH ADMIN FALSE, INHERIT FALSE, SET TRUE" | Out-Null
  if($LASTEXITCODE){throw 'Local worker-role setup failed'}
  $createdTestWorkerRole=$true
  $script:vars=@('-v',"meddecode_expected_database=$database",'-v','meddecode_expected_project=wyripeqruhvbksjfsvlr','-v',"meddecode_expected_test_account=$owner",'-v','meddecode_v3_local_readiness=PASS')
  New-Baseline
  $before=Snapshot; $r=Invoke-Artifact '002_activate.sql' $vars 'postgres' -PreserveProductionDatabaseGuard; if($r.ExitCode -eq 0 -or (Snapshot) -ne $before){throw 'direct postgres database guard was bypassed or changed state'}; Write-Output 'REJECTED_UNCHANGED:direct_postgres_database_guard'
  Record-Pass 'direct_postgres_database_guard'
  $pre=Invoke-Artifact '001_preflight.sql' $vars; if($pre.ExitCode -ne 0 -or $pre.Output -notmatch 'ACTIVATION_PREFLIGHT_OK'){throw 'activation preflight failed'}
  Record-Pass 'activation_preflight'
  $wrongProject=@('-v',"meddecode_expected_database=$database",'-v','meddecode_expected_project=wrong','-v',"meddecode_expected_test_account=$owner",'-v','meddecode_v3_local_readiness=PASS'); $before=Snapshot; $r=Invoke-Artifact '002_activate.sql' $wrongProject; if($r.ExitCode -eq 0 -or (Snapshot) -ne $before){throw 'wrong project was accepted or changed state'}
  Record-Pass 'wrong_project_rejected'
  $wrongDatabase=@('-v','meddecode_expected_database=wrong','-v','meddecode_expected_project=wyripeqruhvbksjfsvlr','-v',"meddecode_expected_test_account=$owner",'-v','meddecode_v3_local_readiness=PASS'); $before=Snapshot; $r=Invoke-Artifact '002_activate.sql' $wrongDatabase; if($r.ExitCode -eq 0 -or (Snapshot) -ne $before){throw 'wrong database was accepted or changed state'}
  Record-Pass 'wrong_expected_database_rejected'
  $before=Snapshot; $r=Invoke-Artifact '002_activate.sql' $vars 'scoped_cluster_admin'; if($r.ExitCode -eq 0 -or (Snapshot) -ne $before){throw 'non-administrative session was accepted or changed state'}; Write-Output 'REJECTED_UNCHANGED:wrong_administrative_identity'
  Record-Pass 'wrong_administrative_identity_rejected'
  Assert-RejectedUnchanged { Psql "UPDATE public.meddecode_auto_worker_policy SET enabled=true,activated_at=clock_timestamp() WHERE singleton" | Out-Null } 'already_enabled'
  Assert-RejectedUnchanged {
    Psql "UPDATE public.meddecode_auto_worker_policy SET worker_login='meddecode_scoped_login',worker_instance_id='meddecode-auto-worker-002',scope_seconds=1199 WHERE singleton" | Out-Null
  } 'worker_login_instance_and_scope_configuration'
  Assert-RejectedUnchanged {
    Psql "GRANT EXECUTE ON FUNCTION public.submit_automatic_prescription_analysis_job_v1(uuid,jsonb) TO anon; GRANT EXECUTE ON FUNCTION public.meddecode_scoped_authorize_next_automatic_job_v1(text) TO anon; ALTER FUNCTION public.meddecode_scoped_authorize_next_automatic_job_v1(text) OWNER TO scoped_cluster_admin; CREATE OR REPLACE FUNCTION public.meddecode_scoped_authorize_next_automatic_job_v1(p_worker_instance_id text) RETURNS TABLE(authorized boolean) LANGUAGE sql SECURITY INVOKER SET search_path=public AS 'SELECT false'" -User 'scoped_cluster_admin' | Out-Null
  } 'issuer_rpc_privileges_and_security'
  Assert-RejectedUnchanged { Psql "INSERT INTO public.ai_jobs(id,user_id,prescription_id,job_type,status) VALUES('40000000-0000-4000-8000-000000000099','$owner','30000000-0000-4000-8000-000000000003','prescription_analysis','queued'); INSERT INTO public.meddecode_auto_authorized_jobs(job_id,prescription_id,user_id) VALUES('40000000-0000-4000-8000-000000000099','30000000-0000-4000-8000-000000000003','$owner');" | Out-Null } 'generation2_admission'
  Assert-RejectedUnchanged { Psql "UPDATE public.meddecode_auto_test_account SET user_id='20000000-0000-4000-8000-000000000002' WHERE singleton" | Out-Null } 'wrong_allowlist'
  New-Baseline; if((Psql "INSERT INTO public.meddecode_auto_test_account(singleton,user_id) VALUES(false,'20000000-0000-4000-8000-000000000002')" -AllowFailure) -eq 0){throw 'singleton allowlist accepted a second row'}; Write-Output 'STRUCTURALLY_PREVENTED:multiple_allowlist_entries'; Record-Pass 'allowlist_singleton_constraint'
  Assert-RejectedUnchanged { Psql "INSERT INTO public.meddecode_scoped_worker_scope(job_id,prescription_id,user_id,worker_login,worker_instance_id,enabled,expires_at) VALUES('40000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002','$owner','meddecode_auto_worker_login','meddecode-auto-worker-001',true,clock_timestamp()+interval '10 minutes')" | Out-Null } 'claimable_scope'
  Assert-RejectedUnchanged { Psql "UPDATE public.ai_jobs SET status='processing',lease_expires_at=clock_timestamp()+interval '10 minutes' WHERE id='40000000-0000-4000-8000-000000000002'" | Out-Null } 'active_lease'
  New-Baseline
  $workerSession=Start-Job -ArgumentList $pg,$port,$database,$localWorkerPassword -ScriptBlock { param($bin,$p,$db,$password); $env:PGPASSWORD=$password; & "$bin\psql.exe" -X -w -h 127.0.0.1 -p $p -U meddecode_auto_worker_login -d $db -c "SELECT pg_sleep(30)" 2>$null }
  try {
    $seen=$false; for($i=0;$i -lt 50;$i++){ $count=& "$pg\psql.exe" -X -w -qAt -h 127.0.0.1 -p $port -U postgres -d $database -c "SELECT count(*) FROM pg_stat_activity WHERE usename='meddecode_auto_worker_login'"; if($count -eq '1'){$seen=$true;break}; Start-Sleep -Milliseconds 100 }
    if(-not $seen){throw 'Actual local worker session was not observed'}
    $before=Snapshot; $r=Invoke-Artifact '002_activate.sql' $vars; if($r.ExitCode -eq 0 -or (Snapshot) -ne $before){throw 'active worker session was accepted or changed state'}; Write-Output 'REJECTED_UNCHANGED:active_worker_session'; Record-Pass 'active_worker_session_rejected'
  } finally { Stop-Job $workerSession -ErrorAction SilentlyContinue; Receive-Job $workerSession -ErrorAction SilentlyContinue | Out-Null; Remove-Job $workerSession -Force -ErrorAction SilentlyContinue }
  New-Baseline
  $jobs=1..2 | ForEach-Object { Start-Job -ArgumentList $migration,$database,$vars,$pg,$port -ScriptBlock { param($m,$db,$v,$bin,$p); $tmp=Join-Path $env:TEMP ('activate.'+[guid]::NewGuid()+'.sql'); $t=Get-Content (Join-Path $m '002_activate.sql') -Raw; $t=$t -replace "current_database\(\) <> 'postgres'","current_database() <> '$db'" -replace "current_database\(\)<>'postgres'","current_database()<>'$db'"; [IO.File]::WriteAllText($tmp,$t); try { & "$bin\psql.exe" -X -w -h 127.0.0.1 -p $p -U postgres -d $db -v ON_ERROR_STOP=1 @v -f $tmp 2>$null; "EXIT=$LASTEXITCODE" } finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue } } }
  $jobs | Wait-Job | Out-Null; $codes=@($jobs | ForEach-Object { $o=(Receive-Job $_|Out-String); [void]($o -match 'EXIT=(\d+)'); $Matches[1] }); $jobs | Remove-Job -Force
  if((@($codes|Where-Object {$_ -eq '0'}).Count) -ne 1 -or (@($codes|Where-Object {$_ -ne '0'}).Count) -ne 1){throw "concurrent activation fence failed: $($codes -join ',')"}
  Record-Pass 'concurrent_activation_single_winner'
  $generation1Before=Generation1Snapshot
  $verify=Invoke-Artifact '003_verify.sql' $vars; if($verify.ExitCode -ne 0 -or $verify.Output -notmatch 'ACTIVATION_VERIFY_OK'){throw 'activation verification failed'}
  if((Generation1Snapshot) -ne $generation1Before){throw 'independent verification changed Generation 1 history'}
  Record-Pass 'activation_verifier_and_generation1_history'
  $wrongVerifyAccount=@('-v','meddecode_expected_test_account=20000000-0000-4000-8000-000000000002'); $verify=Invoke-Artifact '003_verify.sql' $wrongVerifyAccount; if($verify.ExitCode -eq 0){throw 'verification accepted a different synthetic account'}
  Record-Pass 'wrong_verification_account_rejected'
  Assert-VerificationRejected {
    Psql "GRANT EXECUTE ON FUNCTION public.submit_automatic_prescription_analysis_job_v1(uuid,jsonb) TO anon; GRANT EXECUTE ON FUNCTION public.meddecode_scoped_authorize_next_automatic_job_v1(text) TO anon; ALTER FUNCTION public.meddecode_scoped_authorize_next_automatic_job_v1(text) OWNER TO scoped_cluster_admin; CREATE OR REPLACE FUNCTION public.meddecode_scoped_authorize_next_automatic_job_v1(p_worker_instance_id text) RETURNS TABLE(authorized boolean) LANGUAGE sql SECURITY INVOKER SET search_path=public AS 'SELECT false'" -User 'scoped_cluster_admin' | Out-Null
  } 'issuer_rpc_privileges_and_security'
  Assert-VerificationRejected { Psql "UPDATE public.meddecode_auto_authorized_jobs SET user_id='20000000-0000-4000-8000-000000000002' WHERE rollout_generation=1" | Out-Null } 'generation1_admission_audit_binding'
  New-ActivatedBaseline
  Psql "INSERT INTO public.ai_jobs(id,user_id,prescription_id,job_type,status) VALUES('40000000-0000-4000-8000-000000000098','$owner','30000000-0000-4000-8000-000000000003','prescription_analysis','queued'); INSERT INTO public.meddecode_auto_authorized_jobs(job_id,prescription_id,user_id) VALUES('40000000-0000-4000-8000-000000000098','30000000-0000-4000-8000-000000000003','$owner'); INSERT INTO public.meddecode_scoped_worker_scope(job_id,prescription_id,user_id,worker_login,worker_instance_id,enabled,expires_at) VALUES('40000000-0000-4000-8000-000000000098','30000000-0000-4000-8000-000000000003','$owner','meddecode_auto_worker_login','meddecode-auto-worker-001',true,clock_timestamp()+interval '10 minutes')" | Out-Null
  $generation1Before=Generation1Snapshot
  $disable=Invoke-Artifact '004_emergency_disable.sql'; if($disable.ExitCode -ne 0 -or $disable.Output -notmatch '"policy_enabled" : false'){throw 'emergency disable failed'}
  if((Generation1Snapshot) -ne $generation1Before){throw 'emergency disable changed Generation 1 history'}
  Record-Pass 'emergency_disable_preserves_generation1'
  Write-Output 'GENERATION_2_ACTIVATION_LOCAL_TEST_OK'
} catch {
  $testError=$_.Exception.Message
  Write-Output "TEST_FAIL:activation:$testError"
}

$priorErrorAction=$ErrorActionPreference
$ErrorActionPreference='Continue'
$ready=& "$pg\pg_isready.exe" -h 127.0.0.1 -p $port 2>$null
if($ready -match 'accepting connections') {
  & "$pg\psql.exe" -X -w -h 127.0.0.1 -p $port -U scoped_cluster_admin -d postgres -v ON_ERROR_STOP=1 -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$database' AND pid<>pg_backend_pid()" 2>&1 | ForEach-Object { Write-Output $_ }
  if($LASTEXITCODE -ne 0){$cleanupErrors += 'Could not terminate connections to the activation test database.'}
  & "$pg\dropdb.exe" -h 127.0.0.1 -p $port -U scoped_cluster_admin --if-exists $database 2>&1 | ForEach-Object { Write-Output $_ }
  if($LASTEXITCODE -ne 0){$cleanupErrors += 'Could not drop the activation test database.'}
  if($createdTestWorkerRole) {
    & "$pg\psql.exe" -X -w -h 127.0.0.1 -p $port -U scoped_cluster_admin -d postgres -v ON_ERROR_STOP=1 -c "DROP ROLE meddecode_auto_worker_login" 2>&1 | ForEach-Object { Write-Output $_ }
    if($LASTEXITCODE -ne 0){$cleanupErrors += 'Could not drop the activation test worker role.'}
  }
} else {
  $cleanupErrors += 'PostgreSQL was unavailable; activation test database and role cleanup could not be verified.'
}
Remove-Item Env:PGPASSFILE -ErrorAction SilentlyContinue
$ErrorActionPreference=$priorErrorAction
if($cleanupErrors.Count -gt 0){Write-Output "TEST_FAIL:cleanup:$($cleanupErrors -join ' ')"; $testError='cleanup failed'}
$failedCount=if($testError){1}else{0}
Write-Output "TEST_SUMMARY suite=activation passed=$($script:passedCases.Count) failed=$failedCount"
if($failedCount -gt 0){exit 1}
