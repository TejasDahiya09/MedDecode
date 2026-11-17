[CmdletBinding()]
param([ValidateRange(1,300)][int]$TimeoutSeconds = 240)
# Read-only barrier. Never launches a worker or terminates a database session.
$ErrorActionPreference = 'Stop'
$serviceFile = Join-Path $env:APPDATA 'postgresql\pg_service.conf'
$section = [regex]::Match([IO.File]::ReadAllText($serviceFile), '(?ms)^\[meddecode_hosted_admin\]\s*\r?\n(?<body>.*?)(?=^\[|\z)').Groups['body'].Value
if ($section -notmatch '(?m)^\s*sslmode\s*=\s*verify-full\s*$' -or
    $section -notmatch '(?m)^\s*dbname\s*=\s*postgres\s*$' -or
    $section -notmatch '(?m)^\s*port\s*=\s*5432\s*$' -or
    $section -notmatch '(?m)^\s*user\s*=\s*postgres\.wyripeqruhvbksjfsvlr\s*$' -or
    $section -notmatch '(?m)^\s*host\s*=\s*[^\s]+\.pooler\.supabase\.com\s*$' -or
    $section -match '(?m)^\s*(hostaddr|password|options)\s*=') { throw 'Hosted service configuration mismatch.' }
foreach ($name in @('PGHOST','PGHOSTADDR','PGOPTIONS','PGSSLMODE','PGUSER','PGDATABASE')) {
  if ([Environment]::GetEnvironmentVariable($name, 'Process')) { throw 'Unexpected PostgreSQL connection override.' }
}
$oldServiceFile = $env:PGSERVICEFILE
$env:PGSERVICEFILE = $serviceFile
$query = @'
BEGIN READ ONLY;
SELECT
  (current_database()='postgres' AND current_user='postgres' AND session_user='postgres')::int,
  (SELECT count(*) FROM pg_stat_activity WHERE usename IN ('meddecode_scoped_worker_login','meddecode_worker_login')),
  (EXISTS(SELECT FROM public.meddecode_scoped_worker_scope s JOIN public.ai_jobs j ON j.id=s.job_id AND j.user_id=s.user_id AND j.prescription_id=s.prescription_id
    JOIN public.prescriptions p ON p.id=j.prescription_id AND p.user_id=j.user_id JOIN auth.users u ON u.id=p.user_id
    WHERE s.job_id='32e120ce-38bc-431b-b11f-0953c5b1b7e3' AND s.prescription_id='9cde1d1a-e036-4c07-9f5f-cc8ec06930af'
      AND s.worker_login='meddecode_scoped_worker_login' AND s.worker_instance_id='meddecode-synthetic-32e120ce' AND s.enabled
      AND s.expires_at>clock_timestamp()+interval '11 minutes' AND j.status='queued' AND j.attempt_count=0 AND j.claim_generation=0 AND j.lease_owner IS NULL
      AND p.status='queued' AND lower(u.email)='dahiyatejas35@gmail.com' AND p.storage_provider='aws_s3'
      AND p.storage_bucket='meddecode-prescriptions-dev-226945380522-ap-south-1-an'
      AND p.object_key='private/prescriptions/9cde1d1a-e036-4c07-9f5f-cc8ec06930af/source.pdf'
      AND p.file_type='application/pdf' AND p.file_size_bytes=1230
      AND NOT EXISTS(SELECT FROM public.prescription_intelligence_results r WHERE r.job_id=j.id OR r.prescription_id=p.id))
    AND (SELECT count(*) FROM public.meddecode_scoped_worker_scope)=1)::int,
  (EXISTS(SELECT FROM public.ai_jobs j WHERE j.id='6eb659b6-b743-42c5-81c3-c7c5d108464e' AND j.prescription_id='79dac9bf-4ea2-4949-acfa-caea7c301040' AND j.status='queued' AND j.attempt_count=0 AND j.claim_generation=0 AND j.lease_owner IS NULL AND NOT EXISTS(SELECT FROM public.prescription_intelligence_results r WHERE r.job_id=j.id)))::int,
  (SELECT count(*) FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE a.usename IN ('meddecode_scoped_worker_login','meddecode_worker_login'));
ROLLBACK;
'@
try {
  $clock = [Diagnostics.Stopwatch]::StartNew()
  do {
    $out = $query | & 'C:\Program Files\PostgreSQL\17\bin\psql.exe' -X -w -qAt -F '|' -v ON_ERROR_STOP=1 -d 'service=meddecode_hosted_admin'
    if ($LASTEXITCODE -ne 0 -or @($out).Count -ne 1 -or $out -notmatch '^([01])\|(\d+)\|([01])\|([01])\|(\d+)$') { throw 'Barrier query failed.' }
    $identity = $Matches[1]; $sessions = [int]$Matches[2]; $target = $Matches[3]; $unrelated = $Matches[4]; $locks = [int]$Matches[5]
    if ($identity -cne '1' -or $target -cne '1' -or $unrelated -cne '1') { throw 'Scope or job preconditions changed.' }
    # Application names and previously observed PIDs are never exemptions.
    if ($sessions -eq 0 -and $locks -eq 0) { 'SCOPED_ZERO_SESSION_BARRIER_OK'; return }
    Start-Sleep -Seconds 3
  } while ($clock.Elapsed.TotalSeconds -lt $TimeoutSeconds)
  throw 'Worker-login sessions or locks did not close naturally before the deadline.'
} finally { $env:PGSERVICEFILE = $oldServiceFile }
