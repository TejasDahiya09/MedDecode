[CmdletBinding()]
param()
# Restore-only continuation: never opens a hosted connection or creates a dump.
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'scoped-worker-acl.ps1')
$dir='C:\Users\dahiy\MedDecode-Backups\exact-retry-013-20261116T060713Z'
$archive=Join-Path $dir 'meddecode-public-auth-current.dump'
$expected='C1DAF5E98F6B3E149C918833FA7158118C0B9DB9FDAA6935AC1E8230B7AA2B6D'
$bin='C:\Program Files\PostgreSQL\17\bin'
Assert-ScopedCredentialDacl $dir $true; Assert-ScopedCredentialDacl $archive $false
if((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -cne $expected -or (Get-Item -LiteralPath $archive).Length -ne 965172){throw 'Existing archive integrity mismatch'}
$inventory=@(& (Join-Path $bin 'pg_restore.exe') --list $archive)
if($LASTEXITCODE -ne 0){throw 'Existing dump inventory failed'}
$source=Get-Content -LiteralPath (Join-Path $dir 'source-verification.json') -Raw | ConvertFrom-Json
$query=[regex]::Match((Get-Content -LiteralPath (Join-Path $PSScriptRoot 'backup-exact-retry.ps1') -Raw),"(?s)\`$query=@'\r?\n(?<sql>.*?)\r?\n'@").Groups['sql'].Value
if(-not $query.StartsWith('SELECT jsonb_build_object(')){throw 'Aggregate verification query unavailable'}
$work=Join-Path $dir ('restore-proof-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ'))
New-Item -ItemType Directory -Path $work | Out-Null
Set-ScopedCredentialDirectoryDacl $work
$cluster=Join-Path $work 'data'; $pwfile=Join-Path $work 'private-password.tmp'; $port=55613
if(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue){throw 'Private restore port occupied'}
if($env:PGPASSWORD){throw 'Unexpected inherited password override'}
$secret=[guid]::NewGuid().ToString('N')+[guid]::NewGuid().ToString('N')
$secret | Set-Content -LiteralPath $pwfile -Encoding ASCII
$startProcess=$null
try {
 & (Join-Path $bin 'initdb.exe') -D $cluster -U postgres -A scram-sha-256 --encoding=UTF8 --locale=C "--pwfile=$pwfile" *> (Join-Path $work 'initdb.log')
 if($LASTEXITCODE -ne 0){throw 'Disposable PG17 initialization failed'}
 # pg_ctl/postgres must not be a synchronous PowerShell native pipeline.
 # Independent hidden process, explicit data-dir/PID/port ownership, readiness
 # polling and explicit shutdown avoid inherited pipe handles blocking the shell.
 $args='-D "{0}" -l "{1}" -o "-p {2} -h 127.0.0.1 -c max_connections=10" -w -t 15 start' -f $cluster,(Join-Path $work 'server.log'),$port
 $startProcess=Start-Process -FilePath (Join-Path $bin 'pg_ctl.exe') -ArgumentList $args -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $work 'start.out') -RedirectStandardError (Join-Path $work 'start.err')
 $ready=$false; $deadline=[DateTime]::UtcNow.AddSeconds(20)
 do {
   & (Join-Path $bin 'pg_isready.exe') -h 127.0.0.1 -p $port *> $null
   if($LASTEXITCODE -eq 0){$ready=$true;break}
   Start-Sleep -Milliseconds 200
 } while([DateTime]::UtcNow -lt $deadline)
 if(-not $ready){throw 'Disposable restore server readiness failed'}
 $pidData=Get-Content -LiteralPath (Join-Path $cluster 'postmaster.pid')
 if($pidData[1].Replace('/','\') -ine $cluster -or $pidData[3] -ne "$port"){throw 'Disposable server ownership mismatch'}
 $env:PGPASSWORD=$secret
 $local="host=127.0.0.1 port=$port dbname=postgres user=postgres sslmode=disable connect_timeout=5"
 $bootstrap="CREATE SCHEMA IF NOT EXISTS extensions;`n"
 foreach($role in $source.policy_roles){if($role -notmatch '^[a-zA-Z_][a-zA-Z0-9_]*$'){throw 'Unexpected policy role'};if($role -ne 'postgres' -and $role -notlike 'pg_*'){$bootstrap+='CREATE ROLE "'+$role+'" NOLOGIN NOINHERIT;'+"`n"}}
 foreach($ext in $source.extensions){if($ext.name -notin @('pgcrypto','uuid-ossp','pg_trgm','citext','unaccent') -or $ext.schema -notin @('public','extensions')){throw 'Unsupported recovery extension'};$bootstrap+='CREATE EXTENSION IF NOT EXISTS "'+$ext.name+'" WITH SCHEMA "'+$ext.schema+'";'+"`n"}
 $bootstrap | & (Join-Path $bin 'psql.exe') -X -w -q -v ON_ERROR_STOP=1 $local *> (Join-Path $work 'bootstrap.log')
 if($LASTEXITCODE -ne 0){throw 'Restore dependency bootstrap failed'}
 $inventory | Where-Object {$_ -notmatch '^\d+; \d+ \d+ SCHEMA - public '} | Set-Content -LiteralPath (Join-Path $work 'restore.list') -Encoding ASCII
 & (Join-Path $bin 'pg_restore.exe') --exit-on-error --single-transaction --no-owner --no-privileges "--use-list=$(Join-Path $work 'restore.list')" "--dbname=$local" $archive *> (Join-Path $work 'restore.log')
 if($LASTEXITCODE -ne 0){throw 'Archive restoration failed; preserve protected restore.log'}
 $restoredJson=@(("SET TIME ZONE 'UTC';`n"+$query) | & (Join-Path $bin 'psql.exe') -X -w -q -t -A -v ON_ERROR_STOP=1 $local)
 if($LASTEXITCODE -ne 0){throw 'Restore verification query failed'}
 $restored=($restoredJson -join '') | ConvertFrom-Json
 $restoredJson | Set-Content -LiteralPath (Join-Path $work 'restored.json') -Encoding UTF8
 foreach($part in @('counts','objects','digests','function_hashes')){if(($source.$part | ConvertTo-Json -Depth 20 -Compress) -cne ($restored.$part | ConvertTo-Json -Depth 20 -Compress)){throw "Source/restore mismatch: $part"}}
 $indexProof=@("SELECT jsonb_build_object('indexes',count(*),'invalid_indexes',count(*) FILTER(WHERE NOT i.indisvalid)) FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth');" | & (Join-Path $bin 'psql.exe') -X -w -q -t -A -v ON_ERROR_STOP=1 $local)
 if($LASTEXITCODE -ne 0){throw 'Restored index verification failed'}
 $indexes=($indexProof -join '') | ConvertFrom-Json
 if($indexes.invalid_indexes -ne 0){throw 'Restored invalid index detected'}
 $manifest=[ordered]@{utc=[DateTime]::UtcNow.ToString('o');project='wyripeqruhvbksjfsvlr';archive=$archive;sha256=$expected;bytes=965172;restore='PASS';counts=$restored.counts;objects=$restored.objects;indexes=$indexes;data_digests='MATCH';function_hashes='MATCH';owner_acl_replay='Not verified: restored with --no-owner --no-privileges';limitations='No global role/membership replay, full Supabase platform/configuration or S3 recovery';retention='Retain protected archive until explicit owner deletion approval'}
 $manifest | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $dir 'RECOVERY-MANIFEST.json') -Encoding UTF8
 'BACKUP_RESTORE_VERIFIED'; $restored.counts | ConvertTo-Json -Compress; $restored.objects | ConvertTo-Json -Compress; $indexes | ConvertTo-Json -Compress
} finally {
 Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
 if(Test-Path -LiteralPath (Join-Path $cluster 'postmaster.pid')){
   $pidData=Get-Content -LiteralPath (Join-Path $cluster 'postmaster.pid')
   if($pidData[1].Replace('/','\') -ine $cluster -or $pidData[3] -ne "$port"){throw 'Refusing to stop unidentified server'}
   $stopArgs='-D "{0}" -m fast -w -t 20 stop' -f $cluster
   $stop=Start-Process -FilePath (Join-Path $bin 'pg_ctl.exe') -ArgumentList $stopArgs -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $work 'stop.out') -RedirectStandardError (Join-Path $work 'stop.err')
   if(-not $stop.WaitForExit(25000)){throw 'Task-owned restore shutdown utility timed out'}
   # Windows PowerShell can expose a null ExitCode on a Start-Process handle.
   # Verify the owned server's actual state independently instead of treating
   # that missing property as a database shutdown failure.
   if(Test-Path -LiteralPath (Join-Path $cluster 'postmaster.pid')){throw 'Task-owned restore PID remains after shutdown'}
 }
 if(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue){throw 'Restore port remains occupied; preserve cluster'}
 if(Test-Path -LiteralPath $pwfile){Remove-Item -LiteralPath $pwfile -Force}
 if(Test-Path -LiteralPath $cluster){$resolved=(Resolve-Path -LiteralPath $cluster).Path;if($resolved -cne (Join-Path $work 'data')){throw 'Unsafe disposable cleanup path'};Remove-Item -LiteralPath $resolved -Recurse -Force}
 if($startProcess){$startProcess.Dispose()}
 'DISPOSABLE_RESTORE_CLUSTER_REMOVED'
}
