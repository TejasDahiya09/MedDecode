# Fictional, local-only credential-store regression. No network or worker.
$ErrorActionPreference='Stop'
$root=Join-Path $env:TEMP ('meddecode-auto-credential-test-'+[guid]::NewGuid().ToString('N'))
$local=Join-Path $root 'local'; $roaming=Join-Path $root 'roaming'
$dir=Join-Path $local 'MedDecode\ScopedWorkerCredentials'; $pg=Join-Path $roaming 'postgresql'; $ca=Join-Path $root 'ca.pem'
$script=Join-Path (Split-Path -Parent $PSScriptRoot) 'scripts\automatic-worker-credentials.ps1'
try {
 New-Item -ItemType Directory -Path $local,$pg -Force | Out-Null
 $env:LOCALAPPDATA=$local; $env:APPDATA=$roaming
 foreach($k in @('PGHOST','PGHOSTADDR','PGOPTIONS','PGSSLMODE','PGUSER','PGDATABASE','PGPASSWORD')){Remove-Item "Env:$k" -ErrorAction SilentlyContinue}
 function Read-Host {param($Prompt,[switch]$AsSecureString); ConvertTo-SecureString 'FAKE_AUTO_PASSWORD' -AsPlainText -Force}
 & $script -Action Initialize
 $file=Join-Path $dir 'automatic-worker.xml'
 if([IO.File]::ReadAllText($file).Contains('FAKE_AUTO_PASSWORD')){throw 'DPAPI plaintext disclosure'}
 try {& $script -Action Initialize; throw 'overwrite permitted'} catch {if($_.Exception.Message -notmatch 'refusing to overwrite'){throw}}
 $items=@()
 foreach($pair in @(@('AWS_ACCESS_KEY_ID','FAKE_AWS_ID'),@('AWS_SECRET_ACCESS_KEY','FAKE_AWS_SECRET'),@('SCOPED_POSTGRES_PASSWORD','FAKE_OTHER_PASSWORD'),@('CATALOGUE_POSTGRES_PASSWORD','FAKE_CATALOGUE_PASSWORD'))){$items += [pscredential]::new($pair[0],(ConvertTo-SecureString $pair[1] -AsPlainText -Force))}
 $items | Export-Clixml -LiteralPath (Join-Path $dir 'credentials.xml')
 [IO.File]::WriteAllText($ca,'fictional CA for configuration-only test')
 $env:WORKER_DATABASE_CA_FILE=$ca
 @"
[meddecode_hosted_admin]
host=unit.pooler.supabase.com
port=5432
dbname=postgres
user=postgres.wyripeqruhvbksjfsvlr
sslmode=verify-full
sslrootcert=$ca
"@ | Set-Content (Join-Path $pg 'pg_service.conf')
 $env:PROCESSING_WORKER_ENABLED='true'; $env:WORKER_AUTOMATIC_AUTHORIZATION_ENABLED='true'
 & $script -Action Load
 $uri=[uri]$env:WORKER_DATABASE_URL
 if($uri.UserInfo -cne 'meddecode_auto_worker_login:FAKE_AUTO_PASSWORD' -or $uri.Host -cne 'db.wyripeqruhvbksjfsvlr.supabase.co' -or $uri.Port -ne 5432 -or $env:PROCESSING_WORKER_ENABLED -cne 'false' -or $env:WORKER_AUTOMATIC_AUTHORIZATION_ENABLED -cne 'false' -or $env:WORKER_RPC_MODE -cne 'scoped'){throw 'unsafe credential selection or flags'}
 if($env:WORKER_AWS_ACCESS_KEY_ID -cne 'FAKE_AWS_ID' -or $env:MEDDECODE_CATALOGUE_PASSWORD -cne 'FAKE_CATALOGUE_PASSWORD'){throw 'existing credentials not selected'}
 & $script -Action LoadDevelopment
 if($env:PROCESSING_WORKER_ENABLED -cne 'false' -or $env:MEDDECODE_START_CONTROLLED_WORKER -cne 'true' -or $env:WORKER_AUTOMATIC_AUTHORIZATION_ENABLED -cne 'true' -or $env:WORKER_SINGLE_ATTEMPT -cne 'true' -or $env:PRESCRIPTION_AUTO_SUBMIT_ENABLED -cne 'true' -or $env:VITE_PRESCRIPTION_AUTO_SUBMIT_ENABLED -cne 'true' -or $env:VITE_PRESCRIPTION_AUTO_SUBMIT_BACKEND_ENABLED -cne 'true'){throw 'development flags are incomplete or unsafe'}
 $repositoryRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
 if($env:WORKER_PYTHON_EXECUTABLE -cne (Join-Path $repositoryRoot 'intelligence\.venv\Scripts\python.exe') -or $env:WORKER_INTELLIGENCE_DIRECTORY -cne (Join-Path $repositoryRoot 'intelligence') -or -not (Test-Path -LiteralPath $env:WORKER_PYTHON_EXECUTABLE -PathType Leaf) -or -not (Test-Path -LiteralPath $env:WORKER_INTELLIGENCE_DIRECTORY -PathType Container)){throw 'V3 worker Python paths are incomplete or invalid'}
 & $script -Action Remove
 if((Test-Path $file) -or -not (Test-Path (Join-Path $dir 'credentials.xml'))){throw 'removal affected the wrong store'}
 'AUTO_DPAPI_INITIALIZE_LOAD_REMOVE_OK'
} finally {
 if(Test-Path -LiteralPath $root){$resolved=(Resolve-Path -LiteralPath $root).Path; $allowed=[IO.Path]::GetFullPath($env:TEMP).TrimEnd([IO.Path]::DirectorySeparatorChar)+[IO.Path]::DirectorySeparatorChar+'meddecode-auto-credential-test-'; if(-not $resolved.StartsWith($allowed,[StringComparison]::OrdinalIgnoreCase)){throw 'Unsafe test cleanup target'}; Remove-Item -LiteralPath $resolved -Recurse -Force}
}
