[CmdletBinding()]
param([Parameter(Mandatory=$true)][ValidateSet('Initialize','Load','LoadDevelopment','Verify','Remove')][string]$Action)
# Separate user-bound DPAPI store; no remote credential or worker is created.
$ErrorActionPreference='Stop'
if($env:OS -ne 'Windows_NT'){throw 'Windows DPAPI is required.'}
. (Join-Path $PSScriptRoot 'scoped-worker-acl.ps1')
$directory=Join-Path $env:LOCALAPPDATA 'MedDecode\ScopedWorkerCredentials'
$path=Join-Path $directory 'automatic-worker.xml'
if($Action -eq 'Remove'){
  if(-not (Test-Path -LiteralPath $path -PathType Leaf)){'AUTO_CREDENTIAL_ABSENT'; return}
  Assert-ScopedCredentialDacl $directory $true; Assert-ScopedCredentialDacl $path $false
  Remove-Item -LiteralPath $path -Force; 'AUTO_CREDENTIAL_REMOVED'; return
}
if($Action -eq 'Initialize'){
  if(Test-Path -LiteralPath $path){throw 'Automatic worker store already exists; refusing to overwrite.'}
  if(-not (Test-Path -LiteralPath $directory)){
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    if(@(Get-ChildItem -LiteralPath $directory -Force).Count -ne 0){throw 'Credential directory is not empty.'}
    Set-ScopedCredentialDirectoryDacl $directory
  }
  Assert-ScopedCredentialDacl $directory $true
  $secret=Read-Host 'Dedicated automatic worker PostgreSQL password (hidden)' -AsSecureString
  if(-not $secret -or $secret.Length -eq 0){throw 'No password supplied.'}
  $created=$false
  try {
    $credential=[pscredential]::new('AUTO_POSTGRES_PASSWORD',$secret)
    $stream=[IO.File]::Open($path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    $created=$true; $stream.Close(); Assert-ScopedCredentialDacl $path $false
    $credential | Export-Clixml -LiteralPath $path -Force
    Assert-ScopedCredentialDacl $path $false
    $check=@(Import-Clixml -LiteralPath $path)
    if($check.Count -ne 1 -or $check[0] -isnot [pscredential] -or $check[0].UserName -cne 'AUTO_POSTGRES_PASSWORD' -or $check[0].Password.Length -eq 0){throw 'Stored credential verification failed.'}
    'AUTO_CREDENTIAL_STORE_CREATED'
  } catch { if($created){Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue}; throw 'Automatic credential storage failed.' }
  finally { $secret.Dispose(); foreach($c in @($check)){if($c -is [pscredential]){$c.Password.Dispose()}} }
  return
}
if($Action -in @('Load','LoadDevelopment')){
  # Loading a secret never enables the worker by itself. LoadDevelopment only
  # prepares the explicit, guarded launcher settings after every credential
  # and ACL check below has succeeded.
  $env:PROCESSING_WORKER_ENABLED='false'
  $env:WORKER_AUTOMATIC_AUTHORIZATION_ENABLED='false'
  $env:MEDDECODE_START_CONTROLLED_WORKER='false'
}
foreach($key in @('PGHOST','PGHOSTADDR','PGOPTIONS','PGSSLMODE','PGUSER','PGDATABASE','PGPASSWORD','PGSSLROOTCERT','PGSERVICE')){if([Environment]::GetEnvironmentVariable($key,'Process')){throw 'Unexpected PostgreSQL environment override.'}}
$ca=if($env:WORKER_DATABASE_CA_FILE){$env:WORKER_DATABASE_CA_FILE}else{'C:\Users\dahiy\MedDecode-secrets\supabase-ca.crt'}
if(-not (Test-Path -LiteralPath $ca -PathType Leaf)){throw 'Worker TLS CA certificate is unavailable.'}
Assert-ScopedCredentialDacl $directory $true; Assert-ScopedCredentialDacl $path $false
$auto=@(Import-Clixml -LiteralPath $path)
if($auto.Count -ne 1 -or $auto[0] -isnot [pscredential] -or $auto[0].UserName -cne 'AUTO_POSTGRES_PASSWORD' -or $auto[0].Password.Length -eq 0){throw 'Automatic worker credential store is invalid.'}
$existing=@()
try {
  $password=$auto[0].GetNetworkCredential().Password
  if($Action -eq 'Verify'){
    $env:PGPASSWORD=$password; $env:PGSSLROOTCERT=$ca
    $sql=@'
BEGIN READ ONLY;
SET LOCAL ROLE meddecode_scoped_worker;
DO $check$
DECLARE f oid;
BEGIN
 IF session_user<>'meddecode_auto_worker_login' OR current_user<>'meddecode_scoped_worker'
 OR pg_has_role(session_user,'meddecode_worker','MEMBER')
 OR has_function_privilege(current_user,'public.claim_next_prescription_analysis_job_v1(text,integer)','EXECUTE')
 OR has_function_privilege(current_user,'public.recover_expired_prescription_analysis_jobs_v1(integer)','EXECUTE')
 OR NOT coalesce(has_function_privilege(current_user,to_regprocedure('public.meddecode_scoped_authorize_next_automatic_job_v1(text)'),'EXECUTE'),false)
 OR EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) x(priv) WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f') AND (has_table_privilege(current_user,c.oid,x.priv) OR has_table_privilege(session_user,c.oid,x.priv) OR (x.priv IN ('SELECT','INSERT','UPDATE','REFERENCES') AND (has_any_column_privilege(current_user,c.oid,x.priv) OR has_any_column_privilege(session_user,c.oid,x.priv)))))
 THEN RAISE EXCEPTION 'automatic worker identity check failed'; END IF;
 FOREACH f IN ARRAY ARRAY[to_regprocedure('public.meddecode_scoped_claim_next_prescription_analysis_job_v1(text,integer)')::oid, to_regprocedure('public.meddecode_scoped_heartbeat_prescription_analysis_job_v1(uuid,text,bigint,integer)')::oid, to_regprocedure('public.meddecode_scoped_complete_prescription_analysis_job_v1(uuid,uuid,text,bigint,jsonb)')::oid, to_regprocedure('public.meddecode_scoped_fail_prescription_analysis_job_v1(uuid,uuid,text,bigint,text,boolean,text,timestamptz)')::oid, to_regprocedure('public.meddecode_scoped_recover_expired_prescription_analysis_jobs_v1(integer)')::oid] LOOP
   IF f IS NULL OR NOT has_function_privilege(current_user,f,'EXECUTE') THEN RAISE EXCEPTION 'scoped worker RPC unavailable'; END IF;
 END LOOP;
END $check$;
ROLLBACK;
SELECT 'AUTO_WORKER_IDENTITY_OK';
'@
    try { $sql | & 'C:\Program Files\PostgreSQL\17\bin\psql.exe' -X -w -q -t -A -v ON_ERROR_STOP=1 'host=db.wyripeqruhvbksjfsvlr.supabase.co port=5432 dbname=postgres user=meddecode_auto_worker_login sslmode=verify-full connect_timeout=10' 2>$null
      if($LASTEXITCODE -ne 0){throw 'Automatic worker identity verification failed.'}
    } finally { Remove-Item Env:PGPASSWORD,Env:PGSSLROOTCERT -ErrorAction SilentlyContinue }
    return
  }
  $existingPath=Join-Path $directory 'credentials.xml'
  Assert-ScopedCredentialDacl $existingPath $false
  $existing=@(Import-Clixml -LiteralPath $existingPath)
  foreach($name in @('AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','CATALOGUE_POSTGRES_PASSWORD')){if(@($existing | Where-Object {$_ -is [pscredential] -and $_.UserName -ceq $name}).Count -ne 1){throw 'Existing worker AWS or catalogue credentials are unavailable.'}}
  if(@($existing | Where-Object {$_ -is [pscredential] -and $_.UserName -ceq 'AWS_SESSION_TOKEN'}).Count -gt 1){throw 'AWS session token entries are invalid.'}
  $env:WORKER_DATABASE_URL='postgresql://meddecode_auto_worker_login:'+ [uri]::EscapeDataString($password)+'@db.wyripeqruhvbksjfsvlr.supabase.co:5432/postgres'
  $env:WORKER_DATABASE_CA_FILE=$ca
  foreach($name in @('AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY')){
    $workerName='WORKER_'+$name
    [Environment]::SetEnvironmentVariable($workerName,(@($existing | Where-Object UserName -CEQ $name)[0].GetNetworkCredential().Password),'Process')
  }
  $token=@($existing | Where-Object UserName -CEQ 'AWS_SESSION_TOKEN')
  if($token.Count){$env:WORKER_AWS_SESSION_TOKEN=$token[0].GetNetworkCredential().Password}else{Remove-Item Env:WORKER_AWS_SESSION_TOKEN -ErrorAction SilentlyContinue}
  $env:MEDDECODE_CATALOGUE_PASSWORD=@($existing | Where-Object UserName -CEQ 'CATALOGUE_POSTGRES_PASSWORD')[0].GetNetworkCredential().Password
  # Catalogue host and reader identity belong to the independent Python service;
  # do not overwrite its direct-connection configuration with the pooler.
  $env:WORKER_RPC_MODE='scoped'; $env:WORKER_SINGLE_ATTEMPT='false'; $env:WORKER_AUTOMATIC_AUTHORIZATION_ENABLED='false'; $env:PROCESSING_WORKER_INSTANCE_ID='meddecode-auto-worker-001'; $env:PROCESSING_WORKER_ENABLED='false'
  if($Action -eq 'LoadDevelopment'){
    $repositoryRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
    $pythonExecutable=Join-Path $repositoryRoot 'intelligence\.venv\Scripts\python.exe'
    $intelligenceDirectory=Join-Path $repositoryRoot 'intelligence'
    if(-not (Test-Path -LiteralPath $pythonExecutable -PathType Leaf) -or -not (Test-Path -LiteralPath $intelligenceDirectory -PathType Container)){throw 'Controlled worker Python runtime is unavailable.'}
    $env:WORKER_PYTHON_EXECUTABLE=$pythonExecutable
    $env:WORKER_INTELLIGENCE_DIRECTORY=$intelligenceDirectory
    $env:PRESCRIPTION_AUTO_SUBMIT_ENABLED='true'
    $env:VITE_PRESCRIPTION_AUTO_SUBMIT_ENABLED='true'
    $env:VITE_PRESCRIPTION_AUTO_SUBMIT_BACKEND_ENABLED='true'
    $env:WORKER_SINGLE_ATTEMPT='true'
    $env:WORKER_AUTOMATIC_AUTHORIZATION_ENABLED='true'
    $env:MEDDECODE_START_CONTROLLED_WORKER='true'
    'AUTO_WORKER_DEVELOPMENT_CONFIGURATION_READY'
  } else {
    'AUTO_WORKER_CREDENTIALS_LOADED_WORKER_DISABLED'
  }
} finally { Remove-Variable password -ErrorAction SilentlyContinue; foreach($c in @($auto+$existing)){if($c -is [pscredential]){$c.Password.Dispose()}} }
