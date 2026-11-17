[CmdletBinding()]
param(
 [string]$BackupDirectory='C:\Users\dahiy\MedDecode-Backups\exact-retry-013-20261116T060713Z',
 [string]$ExpectedSha256='C1DAF5E98F6B3E149C918833FA7158118C0B9DB9FDAA6935AC1E8230B7AA2B6D',
 [long]$ExpectedBytes=965172
)
# Restores ONLY the existing authorized archive. No hosted connection or dump.
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'scoped-worker-acl.ps1')
$bin='C:\Program Files\PostgreSQL\17\bin'
$backup=[IO.Path]::GetFullPath($BackupDirectory)
if(-not $backup.StartsWith('C:\Users\dahiy\MedDecode-Backups\',[StringComparison]::OrdinalIgnoreCase) -or $ExpectedSha256 -notmatch '^[0-9A-Fa-f]{64}$' -or $ExpectedBytes -le 0){throw 'Invalid restore input boundary'}
$archive=Join-Path $backup 'meddecode-public-auth-current.dump'
$expected=$ExpectedSha256.ToUpperInvariant()
Assert-ScopedCredentialDacl $backup $true; Assert-ScopedCredentialDacl $archive $false
if((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -cne $expected -or (Get-Item -LiteralPath $archive).Length -ne $ExpectedBytes){throw 'Backup integrity failed'}
$source=Get-Content -LiteralPath (Join-Path $backup 'source-verification.json') -Raw | ConvertFrom-Json
$query=[regex]::Match((Get-Content -LiteralPath (Join-Path $PSScriptRoot 'backup-exact-retry.ps1') -Raw),"(?s)\`$query=@'\r?\n(.*?)\r?\n'@").Groups[1].Value
if(-not $query.StartsWith('SELECT jsonb_build_object(')){throw 'Read-only verification query missing'}
$dir=Join-Path $backup ('restore-verification-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ'))
New-Item -ItemType Directory -Path $dir | Out-Null; Set-ScopedCredentialDirectoryDacl $dir
$data=Join-Path $dir 'cluster'; $pwfile=Join-Path $dir 'temporary-password.txt'; $port=55614
if(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue){throw 'Disposable restore port occupied'}
function QuoteArg([string]$value){if($value.Contains('"')){throw 'Unsupported native argument'}; '"'+$value+'"'}
function Run([string]$exe,[string[]]$arguments,[string]$name,[string]$inputText='',[int]$timeout=120000){
 $i=New-Object Diagnostics.ProcessStartInfo
 $i.FileName=Join-Path $bin $exe; $i.Arguments=($arguments | ForEach-Object {QuoteArg $_}) -join ' '
 $i.UseShellExecute=$false; $i.CreateNoWindow=$true; $i.RedirectStandardInput=$true; $i.RedirectStandardOutput=$true; $i.RedirectStandardError=$true
 $p=New-Object Diagnostics.Process; $p.StartInfo=$i
 try{
  [void]$p.Start(); $out=$p.StandardOutput.ReadToEndAsync(); $err=$p.StandardError.ReadToEndAsync()
  if($inputText){$p.StandardInput.WriteLine($inputText)}; $p.StandardInput.Close()
  if(-not $p.WaitForExit($timeout)){throw "Owned local utility timed out: $name"}
  $out.Result | Set-Content -LiteralPath (Join-Path $dir ($name+'.stdout.log')) -Encoding UTF8
  $err.Result | Set-Content -LiteralPath (Join-Path $dir ($name+'.stderr.log')) -Encoding UTF8
  if($p.ExitCode -ne 0){throw "Local verification utility failed: $name (exit $($p.ExitCode)); protected log retained"}
  return $out.Result
 }finally{$p.Dispose()}
}
$starter=$null; $started=$false; $oldPassword=$env:PGPASSWORD
try{
 $list=Run 'pg_restore.exe' @('--list',$archive) 'inventory'
 if($list -notmatch 'Dumped from database version: 17\.'){throw 'Unexpected archive database version'}
 ($list -split '\r?\n' | Where-Object {$_ -notmatch '^\d+; \d+ \d+ SCHEMA - public '}) | Set-Content -LiteralPath (Join-Path $dir 'restore.list') -Encoding ASCII
 $secret=[guid]::NewGuid().ToString('N')+[guid]::NewGuid().ToString('N')
 $secret | Set-Content -LiteralPath $pwfile -Encoding ASCII
 [void](Run 'initdb.exe' @('-D',$data,'-U','postgres','-A','scram-sha-256','--encoding=UTF8','--locale=C',"--pwfile=$pwfile") 'initdb')
 # A separately launched hidden process owns server startup. Never put pg_ctl
 # start in a synchronous PowerShell native pipeline or wait on inherited pipes.
 $startArgs='-D "{0}" -l "{1}" -o "-p {2} -h 127.0.0.1 -c max_connections=10" -w -t 30 start' -f $data,(Join-Path $dir 'postgres.log'),$port
 $starter=Start-Process -FilePath (Join-Path $bin 'pg_ctl.exe') -ArgumentList $startArgs -WindowStyle Hidden -PassThru
 $started=$true; $deadline=[DateTime]::UtcNow.AddSeconds(35); $ready=$false
 do{
  if(Test-Path -LiteralPath (Join-Path $data 'postmaster.pid')){
   $pidLines=Get-Content -LiteralPath (Join-Path $data 'postmaster.pid')
   if($pidLines.Count -ge 8 -and $pidLines[1].Replace('/','\') -ieq $data -and $pidLines[3] -eq "$port" -and $pidLines[7].Trim() -eq 'ready'){$ready=$true;break}
  }
  Start-Sleep -Milliseconds 200
 }while([DateTime]::UtcNow -lt $deadline)
 if(-not $ready){throw 'Independent private PostgreSQL startup failed'}
 $env:PGPASSWORD=$secret
 $local="host=127.0.0.1 port=$port dbname=postgres user=postgres sslmode=disable connect_timeout=5"
 $identity=Run 'psql.exe' @('-X','-w','-q','-t','-A','-v','ON_ERROR_STOP=1',$local) 'identity' "SELECT current_setting('server_version_num')::int/10000,current_setting('port'),current_setting('listen_addresses');"
 if($identity.Trim() -cne "17|$port|127.0.0.1"){throw 'Private restore identity mismatch'}
 $bootstrap="CREATE SCHEMA IF NOT EXISTS extensions;`n"
 foreach($role in $source.policy_roles){if($role -notmatch '^[a-zA-Z_][a-zA-Z0-9_]*$'){throw 'Unexpected role identifier'}; if($role -ne 'postgres' -and $role -notlike 'pg_*'){$bootstrap+='CREATE ROLE "'+$role+'" NOLOGIN NOINHERIT;'+"`n"}}
 foreach($ext in $source.extensions){if($ext.schema -notin @('public','extensions') -or $ext.name -notin @('pgcrypto','uuid-ossp','pg_trgm','citext','unaccent')){throw 'Unsupported extension dependency'};$bootstrap+='CREATE EXTENSION IF NOT EXISTS "'+$ext.name+'" WITH SCHEMA "'+$ext.schema+'";'+"`n"}
 [void](Run 'psql.exe' @('-X','-w','-q','-v','ON_ERROR_STOP=1',$local) 'bootstrap' $bootstrap)
 [void](Run 'pg_restore.exe' @('--exit-on-error','--single-transaction','--no-owner','--no-privileges',"--use-list=$(Join-Path $dir 'restore.list')","--dbname=$local",$archive) 'restore')
 $json=Run 'psql.exe' @('-X','-w','-q','-t','-A','-v','ON_ERROR_STOP=1',$local) 'verification' ("SET TIME ZONE 'UTC';`n"+$query)
 $restored=$json.Trim() | ConvertFrom-Json
 foreach($part in @('counts','objects','digests','function_hashes','generation','migrations','index_hashes')){
  if($null -eq $source.$part){continue}
  foreach($field in $source.$part.PSObject.Properties){
   if(($field.Value | ConvertTo-Json -Depth 20 -Compress) -cne ($restored.$part.($field.Name) | ConvertTo-Json -Depth 20 -Compress)){throw "Source/restore mismatch: $part.$($field.Name)"}
  }
  if($part -in @('function_hashes','index_hashes') -and @($source.$part.PSObject.Properties).Count -ne @($restored.$part.PSObject.Properties).Count){throw "Unexpected restored $part count"}
 }
 if((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -cne $expected){throw 'Archive changed during restore verification'}
 $record=[ordered]@{utc=[DateTime]::UtcNow.ToString('o');archive=$archive;bytes=$ExpectedBytes;sha256=$expected;restore='PASS';source_version=$source.version;restore_version=$restored.version;counts=$restored.counts;objects=$restored.objects;generation=$restored.generation;migrations=$restored.migrations;data_digests='MATCH';function_hashes='MATCH';index_hashes='MATCH_IF_IN_SOURCE_MANIFEST';limitations='No original owner/ACL replay, global roles, Supabase platform configuration or S3 object recovery. Archive retains ACL definitions; local policy roles are NOLOGIN placeholders.'}
 $record | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $dir 'RESTORE-VERIFIED.json') -Encoding UTF8
 'BACKUP_RESTORE_VERIFIED'; "EVIDENCE_DIRECTORY:$dir"; $restored.counts | ConvertTo-Json -Compress; $restored.objects | ConvertTo-Json -Compress; $restored.generation | ConvertTo-Json -Compress; $restored.migrations | ConvertTo-Json -Compress
}finally{
 $env:PGPASSWORD=$oldPassword; $stopped=$false
 if($started -and (Test-Path -LiteralPath (Join-Path $data 'postmaster.pid'))){
  $pidLines=Get-Content -LiteralPath (Join-Path $data 'postmaster.pid')
  if($pidLines[1].Replace('/','\') -ine $data -or $pidLines[3] -ne "$port"){throw 'Refusing cleanup: private cluster ownership mismatch'}
  $stopArgs='-D "{0}" -m fast -w -t 30 stop' -f $data
  $stopper=Start-Process -FilePath (Join-Path $bin 'pg_ctl.exe') -ArgumentList $stopArgs -WindowStyle Hidden -PassThru
  if(-not $stopper.WaitForExit(35000) -or $stopper.ExitCode -ne 0){throw 'Task-owned private cluster did not stop; data retained'}
  $stopper.Dispose()
 }
 if(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue){throw 'Private port remains active; preserving cluster'}
 if($starter){[void]$starter.WaitForExit(5000);$starter.Dispose()}
 if(Test-Path -LiteralPath $pwfile){Remove-Item -LiteralPath $pwfile -Force}
 if(Test-Path -LiteralPath $data){$resolved=(Resolve-Path -LiteralPath $data).Path; if($resolved -cne (Join-Path $dir 'cluster')){throw 'Unsafe owned-cluster cleanup target'};Remove-Item -LiteralPath $resolved -Recurse -Force}
 'OWNED_RESTORE_RESOURCES_CLEANED'
}
