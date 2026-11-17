[CmdletBinding()]
param()
# Authorized read-only hosted dump; isolated private PG17 restore. No workers.
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot 'scoped-worker-acl.ps1')
$bin='C:\Program Files\PostgreSQL\17\bin'
$env:PGSERVICEFILE=Join-Path $env:APPDATA 'postgresql\pg_service.conf'
$body=[regex]::Match((Get-Content -LiteralPath $env:PGSERVICEFILE -Raw),'(?ms)^\[meddecode_hosted_admin\]\s*\r?\n(?<body>.*?)(?=^\[|\z)').Groups['body'].Value
function ProfileField([string]$key){[regex]::Match($body,'(?m)^\s*'+[regex]::Escape($key)+'\s*=\s*(\S+)').Groups[1].Value}
$hostName=ProfileField 'host'; $login=ProfileField 'user'
if((ProfileField 'sslmode') -cne 'verify-full' -or (ProfileField 'dbname') -cne 'postgres' -or (ProfileField 'port') -ne '5432' -or
 -not (($hostName -ceq 'db.wyripeqruhvbksjfsvlr.supabase.co' -and $login -ceq 'postgres') -or ($hostName -match '\.pooler\.supabase\.com$' -and $login -ceq 'postgres.wyripeqruhvbksjfsvlr')) -or
 -not(Test-Path -LiteralPath (ProfileField 'sslrootcert') -PathType Leaf)){throw 'Hosted identity/TLS profile mismatch'}
foreach($key in @('PGHOST','PGHOSTADDR','PGUSER','PGDATABASE','PGPASSWORD','PGOPTIONS','PGSSLMODE')){if([Environment]::GetEnvironmentVariable($key,'Process')){throw 'Unexpected libpq override'}}
$dir=Join-Path 'C:\Users\dahiy\MedDecode-Backups' ('exact-retry-013-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ'))
if(Test-Path -LiteralPath $dir){throw 'Backup directory already exists'}
New-Item -ItemType Directory -Path $dir | Out-Null
Set-ScopedCredentialDirectoryDacl $dir
$archive=Join-Path $dir 'meddecode-public-auth-current.dump'
$query=@'
SELECT jsonb_build_object(
 'version',current_setting('server_version'),
 'counts',jsonb_build_object(
  'prescriptions',(SELECT count(*) FROM public.prescriptions),
  'jobs',(SELECT count(*) FROM public.ai_jobs),
  'results',(SELECT count(*) FROM public.prescription_intelligence_results),
  'reviews',(SELECT count(*) FROM public.prescription_review_revisions),
  'evidence',(SELECT count(*) FROM public.prescription_ocr_evidence_sets),
  'admissions',(SELECT count(*) FROM public.meddecode_auto_authorized_jobs),
  'scopes',(SELECT count(*) FROM public.meddecode_scoped_worker_scope),
  'cabinet',(SELECT count(*) FROM public.medicine_cabinet),
  'reminders',(SELECT count(*) FROM public.medication_reminders),
  'dose_logs',(SELECT count(*) FROM public.medication_dose_logs),
  'auth_users',(SELECT count(*) FROM auth.users)),
 'objects',jsonb_build_object(
  'indexes',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth') AND c.relkind IN ('i','I')),
  'tables',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth') AND c.relkind IN ('r','p')),
  'sequences',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth') AND c.relkind='S'),
  'relations',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth') AND c.relkind IN ('r','p','S','v','m','i','I')),
  'functions',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','auth')),
  'policies',(SELECT count(*) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth')),
  'constraints',(SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname IN ('public','auth'))),
 'digests',jsonb_build_object(
  'prescriptions',(SELECT md5(string_agg(to_jsonb(t)::text,',' ORDER BY id)) FROM public.prescriptions t),
  'jobs',(SELECT md5(string_agg(to_jsonb(t)::text,',' ORDER BY id)) FROM public.ai_jobs t),
  'results',(SELECT md5(string_agg(to_jsonb(t)::text,',' ORDER BY id)) FROM public.prescription_intelligence_results t),
  'reviews',(SELECT md5(string_agg(to_jsonb(t)::text,',' ORDER BY id)) FROM public.prescription_review_revisions t),
  'admissions',(SELECT md5(string_agg(to_jsonb(t)::text,',' ORDER BY job_id)) FROM public.meddecode_auto_authorized_jobs t),
  'policy',(SELECT md5(string_agg(to_jsonb(t)::text,',')) FROM public.meddecode_auto_worker_policy t),
  'scopes',(SELECT md5(string_agg(to_jsonb(t)::text,',' ORDER BY job_id)) FROM public.meddecode_scoped_worker_scope t),
  'generation_1_history',(SELECT md5(string_agg(to_jsonb(t)::text,',' ORDER BY job_id)) FROM public.meddecode_auto_authorized_jobs t WHERE rollout_generation=1),
  'allowlist',(SELECT md5(string_agg(to_jsonb(t)::text,',' ORDER BY user_id)) FROM public.meddecode_auto_test_account t)),
 'generation',(SELECT jsonb_build_object('current',current_rollout_generation,'enabled',enabled,'generation_1_admissions',(SELECT count(*) FROM public.meddecode_auto_authorized_jobs WHERE rollout_generation=1),'generation_2_admissions',(SELECT count(*) FROM public.meddecode_auto_authorized_jobs WHERE rollout_generation=2)) FROM public.meddecode_auto_worker_policy WHERE singleton),
 'migrations',jsonb_build_object('migration_010',to_regprocedure('public.meddecode_complete_initial_review_job_v1(uuid,uuid,text,integer,bigint)') IS NOT NULL,'migration_013',to_regprocedure('public.meddecode_recover_claim_exact_job_v1(uuid,uuid,uuid,text,integer)') IS NOT NULL),
 'index_hashes',(SELECT jsonb_object_agg(schemaname||'.'||indexname,encode(sha256(convert_to(indexdef,'UTF8')),'hex')) FROM pg_indexes WHERE schemaname IN ('public','auth')),
 'function_hashes',(SELECT jsonb_object_agg(p.oid::regprocedure::text,encode(sha256(convert_to(replace(p.prosrc,E'\r',''),'UTF8')),'hex')) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','auth')),
 'policy_roles',(SELECT jsonb_agg(DISTINCT r.rolname) FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN unnest(p.polroles) x(oid) JOIN pg_roles r ON r.oid=x.oid WHERE n.nspname IN ('public','auth')),
 'extensions',(SELECT jsonb_agg(jsonb_build_object('name',e.extname,'schema',n.nspname)) FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname IN ('pgcrypto','uuid-ossp','pg_trgm','citext','unaccent'))
 )::text;
'@
# Same exported snapshot for aggregate evidence and pg_dump table contents.
$info=New-Object Diagnostics.ProcessStartInfo
$info.FileName=Join-Path $bin 'psql.exe'; $info.Arguments='-X -w -q -t -A -v ON_ERROR_STOP=1 "service=meddecode_hosted_admin"'
$info.UseShellExecute=$false; $info.CreateNoWindow=$true
$info.RedirectStandardInput=$true; $info.RedirectStandardOutput=$true; $info.RedirectStandardError=$true
$exporter=New-Object Diagnostics.Process; $exporter.StartInfo=$info
$started=$false
try {
 & (Join-Path $bin 'psql.exe') -X -w 'service=meddecode_hosted_admin' -c '\conninfo'
 if($LASTEXITCODE -ne 0){throw 'Hosted TLS connection check failed'}
 [void]$exporter.Start(); $started=$true; $stderr=$exporter.StandardError.ReadToEndAsync()
 $exporter.StandardInput.WriteLine("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL statement_timeout='30s'; SET LOCAL lock_timeout='2s'; SET LOCAL TIME ZONE 'UTC';")
 $exporter.StandardInput.WriteLine("DO `$identity`$ BEGIN IF current_database()<>'postgres' OR session_user<>'postgres' THEN RAISE EXCEPTION 'identity mismatch'; END IF; END `$identity`$;")
 $exporter.StandardInput.WriteLine("SELECT 'SNAPSHOT:'||pg_export_snapshot();")
 $line=$exporter.StandardOutput.ReadLine()
 if($line -notmatch '^SNAPSHOT:([0-9A-Fa-f]+-[0-9A-Fa-f]+-\d+)$'){throw 'Snapshot export failed'}
 $snapshot=$Matches[1]
 $exporter.StandardInput.WriteLine($query)
 $sourceJson=$exporter.StandardOutput.ReadLine()
 if(-not $sourceJson -or -not $sourceJson.StartsWith('{')){throw 'Source aggregate evidence failed'}
 $source=$sourceJson | ConvertFrom-Json
 $sourceJson | Set-Content -LiteralPath (Join-Path $dir 'source-verification.json') -Encoding UTF8
 & (Join-Path $bin 'pg_dump.exe') '--dbname=service=meddecode_hosted_admin' --format=custom --schema=public --schema=auth "--snapshot=$snapshot" --lock-wait-timeout=5s "--file=$archive"
 if($LASTEXITCODE -ne 0){throw 'Hosted backup export failed'}
 $exporter.StandardInput.WriteLine('ROLLBACK;'); $exporter.StandardInput.WriteLine('\q'); $exporter.StandardInput.Close(); $exporter.WaitForExit()
 if($exporter.ExitCode -ne 0){throw 'Snapshot session failed'}
 $inventory=@(& (Join-Path $bin 'pg_restore.exe') --list $archive)
 if($LASTEXITCODE -ne 0){throw 'Backup inventory validation failed'}
 $inventory | Set-Content -LiteralPath (Join-Path $dir 'inventory.list') -Encoding UTF8
 $hash=(Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash
 $bytes=(Get-Item -LiteralPath $archive).Length
 $exportManifest=[ordered]@{utc=[DateTime]::UtcNow.ToString('o');project='wyripeqruhvbksjfsvlr';database='postgres';archive=$archive;bytes=$bytes;sha256=$hash;export='PASS';restore='PENDING';counts=$source.counts;generation=$source.generation;retention='Retain protected archive until owner explicitly authorizes deletion; no automatic expiry'}
 $exportManifest | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $dir 'EXPORT-MANIFEST.json') -Encoding UTF8
 # Use the independently managed, restore-tested process runner.
 & (Join-Path $PSScriptRoot 'verify-exact-retry-backup.ps1') -BackupDirectory $dir -ExpectedSha256 $hash -ExpectedBytes $bytes
 if(-not $?){throw 'Fresh backup restore verification failed'}
 $evidence=Get-ChildItem -LiteralPath $dir -Directory -Filter 'restore-verification-*' | Sort-Object Name -Descending | Select-Object -First 1
 $receipt=Get-Content -LiteralPath (Join-Path $evidence.FullName 'RESTORE-VERIFIED.json') -Raw | ConvertFrom-Json
 if($receipt.restore -cne 'PASS' -or $receipt.sha256 -cne $hash){throw 'Restore receipt mismatch'}
 $manifest=[ordered]@{backup_utc=$exportManifest.utc;restore_utc=$receipt.utc;project='wyripeqruhvbksjfsvlr';database='postgres';archive=$archive;bytes=$bytes;sha256=$hash;restore='PASS';counts=$receipt.counts;objects=$receipt.objects;generation=$receipt.generation;migrations=$receipt.migrations;data_digests='MATCH';function_hashes='MATCH';index_hashes='MATCH';cleanup='PRIVATE_CLUSTER_STOPPED_AND_REMOVED';limitations=$receipt.limitations;retention=$exportManifest.retention}
 $manifest | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $dir 'RECOVERY-MANIFEST.json') -Encoding UTF8
 'FRESH_CURRENT_SCHEMA_BACKUP_VERIFIED'; "BACKUP_DIRECTORY:$dir"; "BACKUP_SHA256:$hash"; "BACKUP_BYTES:$bytes"
} finally {
 if($started -and -not $exporter.HasExited){try{$exporter.StandardInput.WriteLine('ROLLBACK;');$exporter.StandardInput.WriteLine('\q');$exporter.StandardInput.Close();$exporter.WaitForExit()}catch{}}
 $exporter.Dispose()
}
