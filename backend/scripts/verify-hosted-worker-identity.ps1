[CmdletBinding()]
param()
# Read-only identity and privilege check. No RPC is invoked and no worker starts.
$ErrorActionPreference = 'Stop'
$serviceFile = Join-Path $env:APPDATA 'postgresql\pg_service.conf'
$section = [regex]::Match((Get-Content -LiteralPath $serviceFile -Raw),
  '(?ms)^\[meddecode_hosted_admin\]\s*\r?\n(?<body>.*?)(?=^\[|\z)').Groups['body'].Value
$hostName = [regex]::Match($section, '(?m)^\s*host\s*=\s*(\S+)').Groups[1].Value
$login = [regex]::Match($section, '(?m)^\s*user\s*=\s*(\S+)').Groups[1].Value
if ($section -notmatch '(?m)^\s*sslmode\s*=\s*verify-full\s*$' -or
    $section -notmatch '(?m)^\s*dbname\s*=\s*postgres\s*$' -or
    $section -notmatch '(?m)^\s*port\s*=\s*5432\s*$' -or
    $hostName -notmatch '\.pooler\.supabase\.com$' -or
    $login -cne 'postgres.wyripeqruhvbksjfsvlr' -or
    $section -match '(?m)^\s*(hostaddr|password|options)\s*=') {
  throw 'The existing hosted service is not the reviewed session-pooler configuration.'
}
if ($env:PGHOST -or $env:PGHOSTADDR -or $env:PGOPTIONS -or $env:PGSSLMODE -or $env:PGUSER -or $env:PGDATABASE) {
  throw 'Unexpected PostgreSQL environment override; clear it before this check.'
}
$psql = 'C:\Program Files\PostgreSQL\17\bin\psql.exe'
$oldServiceFile = $env:PGSERVICEFILE
try {
  $env:PGSERVICEFILE = $serviceFile
  $sql = @'
BEGIN READ ONLY;
SET LOCAL ROLE meddecode_worker;
DO $check$
DECLARE f oid;
BEGIN
  IF session_user <> 'meddecode_worker_login' OR current_user <> 'meddecode_worker' THEN
    RAISE EXCEPTION 'restricted login or assumed role mismatch';
  END IF;
  FOREACH f IN ARRAY ARRAY[
    to_regprocedure('public.claim_next_prescription_analysis_job_v1(text,integer)')::oid,
    to_regprocedure('public.heartbeat_prescription_analysis_job_v1(uuid,text,bigint,integer)')::oid,
    to_regprocedure('public.complete_prescription_analysis_job_v1(uuid,uuid,text,bigint,jsonb)')::oid,
    to_regprocedure('public.fail_prescription_analysis_job_v1(uuid,uuid,text,bigint,text,boolean,text,timestamp with time zone)')::oid,
    to_regprocedure('public.recover_expired_prescription_analysis_jobs_v1(integer)')::oid
  ] LOOP
    IF f IS NULL OR NOT has_function_privilege(current_user, f, 'EXECUTE') THEN
      RAISE EXCEPTION 'required worker RPC permission missing';
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    CROSS JOIN (VALUES('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) v(priv)
    WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m') AND
      (has_table_privilege(current_user,c.oid,v.priv) OR
       (v.priv IN ('SELECT','INSERT','UPDATE','REFERENCES') AND has_any_column_privilege(current_user,c.oid,v.priv)))
  ) THEN RAISE EXCEPTION 'worker has unexpected direct public-table access'; END IF;
END
$check$;
ROLLBACK;
SELECT 'RESTRICTED_WORKER_IDENTITY_OK' AS marker;
'@
  # -W forces an interactive hidden password prompt; no password enters argv,
  # the repository, or the SQL. The supplied user selects this project tenant.
  $sql | & $psql -X -W -v ON_ERROR_STOP=1 -d 'service=meddecode_hosted_admin user=meddecode_worker_login.wyripeqruhvbksjfsvlr'
  if ($LASTEXITCODE -ne 0) { throw 'Restricted worker identity check failed. Do not start the worker.' }
} finally {
  $env:PGSERVICEFILE = $oldServiceFile
}
