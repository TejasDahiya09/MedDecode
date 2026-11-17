[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$db = 'meddecode_worker_final_20261113'
$psql = 'C:\Program Files\PostgreSQL\17\bin\psql.exe'
$sourceFile = Join-Path $env:APPDATA 'postgresql\pgpass.conf'
$entries = @(Get-Content -LiteralPath $sourceFile | Where-Object { $_ -match '^127\.0\.0\.1:5433:postgres:postgres:' })
if ($entries.Count -ne 1) { throw 'Local PostgreSQL authentication is unavailable.' }
$tempFile = Join-Path ([IO.Path]::GetTempPath()) ('meddecode-test-' + [guid]::NewGuid().ToString('N'))
$oldPassFile = $env:PGPASSFILE
try {
  [IO.File]::WriteAllText($tempFile, '')
  $acl = [Security.AccessControl.FileSecurity]::new()
  $acl.SetAccessRuleProtection($true, $false)
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.WindowsIdentity]::GetCurrent().User, 'FullControl', 'Allow'))
  Set-Acl -LiteralPath $tempFile -AclObject $acl
  $entry = $entries[0] -replace '^127\.0\.0\.1:5433:postgres:postgres:', ('127.0.0.1:5433:' + $db + ':postgres:')
  [IO.File]::WriteAllText($tempFile, $entry + "`n", [Text.UTF8Encoding]::new($false))
  $env:PGPASSFILE = $tempFile
  $candidate = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\database\scoped-worker-isolation-review.sql'))
  $candidate = $candidate.Replace('\set ON_ERROR_STOP on', '').Replace('meddecode_scoped_worker_scope', 'meddecode_scoped_worker_scope')
  $candidate = $candidate.Replace("'meddecode_scoped_worker'", "'meddecode_worker'").Replace('meddecode_worker, meddecode_scoped_worker;', 'meddecode_worker;').Replace(' TO meddecode_scoped_worker;', ' TO meddecode_worker;')
  $candidate = [regex]::Replace($candidate, '(?m)^BEGIN;\s*', '', 1)
  $candidate = [regex]::Replace($candidate, '(?m)^COMMIT;\s*$', '', 1)
  $guard = @'
BEGIN;
DO $guard$ BEGIN
  IF current_database() <> 'meddecode_worker_final_20261113' OR current_user <> 'postgres'
     OR host(inet_server_addr()) <> '127.0.0.1' OR inet_server_port() <> 5433
     OR current_setting('server_version_num')::integer / 10000 <> 17
     OR to_regclass('public.meddecode_scoped_worker_scope') IS NOT NULL
     OR to_regprocedure('public.meddecode_scoped_claim_next_prescription_analysis_job_v1(text,integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'isolated target guard failed';
  END IF;
END $guard$;
'@
  $checks = @'
SET LOCAL ROLE anon;
DO $anon$ BEGIN
  BEGIN PERFORM * FROM public.meddecode_scoped_worker_scope; RAISE EXCEPTION 'anonymous scope access succeeded'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM * FROM public.meddecode_scoped_claim_next_prescription_analysis_job_v1('synthetic-worker-001',120); RAISE EXCEPTION 'anonymous claim succeeded'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $anon$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $authenticated$ BEGIN
  BEGIN PERFORM * FROM public.meddecode_scoped_worker_scope; RAISE EXCEPTION 'authenticated scope access succeeded'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM * FROM public.meddecode_scoped_claim_next_prescription_analysis_job_v1('synthetic-worker-001',120); RAISE EXCEPTION 'authenticated claim succeeded'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $authenticated$;
RESET ROLE;
SET LOCAL ROLE meddecode_worker;
DO $check$ BEGIN
  IF EXISTS (SELECT 1 FROM public.meddecode_scoped_claim_next_prescription_analysis_job_v1('synthetic-worker-001',120)) THEN RAISE EXCEPTION 'empty scope claimed a job'; END IF;
  IF EXISTS (SELECT 1 FROM public.meddecode_scoped_recover_expired_prescription_analysis_jobs_v1(10)) THEN RAISE EXCEPTION 'empty scope recovered a job'; END IF;
  BEGIN
    PERFORM public.meddecode_scoped_heartbeat_prescription_analysis_job_v1('10000000-0000-4000-8000-000000000001','synthetic-worker-001',1,120);
    RAISE EXCEPTION 'empty scope heartbeat succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $check$;
RESET ROLE;
DO $fixture_guard$ BEGIN
  IF EXISTS (SELECT 1 FROM public.users WHERE id='f1000000-0000-4000-8000-000000000001') OR
     EXISTS (SELECT 1 FROM public.ai_jobs WHERE id IN ('f3000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000002')) THEN
    RAISE EXCEPTION 'synthetic test identities already exist';
  END IF;
END $fixture_guard$;
INSERT INTO public.users(id) VALUES ('f1000000-0000-4000-8000-000000000001');
INSERT INTO public.prescriptions(id,user_id,storage_provider,storage_bucket,object_key,file_type,status) VALUES
 ('f2000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','aws_s3','synthetic-only','private/prescriptions/f2000000-0000-4000-8000-000000000001/source.pdf','application/pdf','queued'),
 ('f2000000-0000-4000-8000-000000000002','f1000000-0000-4000-8000-000000000001','aws_s3','synthetic-only','private/prescriptions/f2000000-0000-4000-8000-000000000002/source.pdf','application/pdf','queued');
INSERT INTO public.ai_jobs(id,user_id,prescription_id,job_type,status) VALUES
 ('f3000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','prescription_analysis','queued'),
 ('f3000000-0000-4000-8000-000000000002','f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000002','prescription_analysis','queued');
INSERT INTO public.meddecode_scoped_worker_scope(job_id,prescription_id,user_id,worker_instance_id,enabled,expires_at)
 VALUES ('f3000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','synthetic-worker-001',true,clock_timestamp()+interval '5 minutes');
SET LOCAL ROLE meddecode_worker;
DO $scoped$ DECLARE claimed record; BEGIN
  SELECT * INTO claimed FROM public.meddecode_scoped_claim_next_prescription_analysis_job_v1('synthetic-worker-001',120);
  IF claimed.job_id IS DISTINCT FROM 'f3000000-0000-4000-8000-000000000001'::uuid THEN RAISE EXCEPTION 'scoped claim returned the wrong job'; END IF;
  PERFORM public.meddecode_scoped_heartbeat_prescription_analysis_job_v1(claimed.job_id,'synthetic-worker-001',claimed.claim_generation,120);
  BEGIN
    PERFORM public.meddecode_scoped_heartbeat_prescription_analysis_job_v1(claimed.job_id,'synthetic-worker-001',claimed.claim_generation-1,120);
    RAISE EXCEPTION 'stale heartbeat succeeded';
  EXCEPTION WHEN invalid_parameter_value OR object_not_in_prerequisite_state THEN NULL; END;
END $scoped$;
RESET ROLE;
UPDATE public.meddecode_scoped_worker_scope SET enabled=false WHERE job_id='f3000000-0000-4000-8000-000000000001';
SET LOCAL ROLE meddecode_worker;
DO $revoked$ BEGIN
  BEGIN
    PERFORM public.meddecode_scoped_heartbeat_prescription_analysis_job_v1('f3000000-0000-4000-8000-000000000001','synthetic-worker-001',1,120);
    RAISE EXCEPTION 'revoked scope heartbeat succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF EXISTS (SELECT 1 FROM public.meddecode_scoped_recover_expired_prescription_analysis_jobs_v1(10)) THEN RAISE EXCEPTION 'revoked scope recovery succeeded'; END IF;
END $revoked$;
RESET ROLE;
UPDATE public.meddecode_scoped_worker_scope SET enabled=true, expires_at=clock_timestamp()-interval '1 second' WHERE job_id='f3000000-0000-4000-8000-000000000001';
SET LOCAL ROLE meddecode_worker;
DO $expired_scope$ BEGIN
  BEGIN
    PERFORM public.meddecode_scoped_heartbeat_prescription_analysis_job_v1('f3000000-0000-4000-8000-000000000001','synthetic-worker-001',1,120);
    RAISE EXCEPTION 'expired scope heartbeat succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $expired_scope$;
RESET ROLE;
UPDATE public.meddecode_scoped_worker_scope SET expires_at=clock_timestamp()+interval '5 minutes' WHERE job_id='f3000000-0000-4000-8000-000000000001';
UPDATE public.ai_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id='f3000000-0000-4000-8000-000000000001';
SET LOCAL ROLE meddecode_worker;
DO $recover$ DECLARE recovered record; claimed record; BEGIN
  SELECT * INTO recovered FROM public.meddecode_scoped_recover_expired_prescription_analysis_jobs_v1(10);
  IF recovered.job_id IS DISTINCT FROM 'f3000000-0000-4000-8000-000000000001'::uuid OR recovered.job_status <> 'queued' THEN RAISE EXCEPTION 'scoped recovery failed'; END IF;
  SELECT * INTO claimed FROM public.meddecode_scoped_claim_next_prescription_analysis_job_v1('synthetic-worker-001',120);
  IF claimed.job_id IS DISTINCT FROM 'f3000000-0000-4000-8000-000000000001'::uuid THEN RAISE EXCEPTION 'reclaim failed'; END IF;
  PERFORM public.meddecode_scoped_fail_prescription_analysis_job_v1(claimed.job_id,'f2000000-0000-4000-8000-000000000001','synthetic-worker-001',claimed.claim_generation,'DOCUMENT_REFERENCE_FAILED',false,NULL,NULL);
END $recover$;
RESET ROLE;
DO $verify$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.ai_jobs WHERE id='f3000000-0000-4000-8000-000000000001' AND status='failed') OR
     NOT EXISTS (SELECT 1 FROM public.ai_jobs WHERE id='f3000000-0000-4000-8000-000000000002' AND status='queued') THEN
    RAISE EXCEPTION 'scope isolation or terminal failure failed';
  END IF;
END $verify$;
INSERT INTO public.prescriptions(id,user_id,storage_provider,storage_bucket,object_key,file_type,status)
 VALUES ('f2000000-0000-4000-8000-000000000003','f1000000-0000-4000-8000-000000000001','aws_s3','synthetic-only','private/prescriptions/f2000000-0000-4000-8000-000000000003/source.pdf','application/pdf','queued');
INSERT INTO public.ai_jobs(id,user_id,prescription_id,job_type,status)
 VALUES ('f3000000-0000-4000-8000-000000000003','f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000003','prescription_analysis','queued');
INSERT INTO public.meddecode_scoped_worker_scope(job_id,prescription_id,user_id,worker_instance_id,enabled,expires_at)
 VALUES ('f3000000-0000-4000-8000-000000000003','f2000000-0000-4000-8000-000000000003','f1000000-0000-4000-8000-000000000001','synthetic-worker-001',true,clock_timestamp()+interval '5 minutes');
SET LOCAL ROLE meddecode_worker;
DO $completion$
DECLARE claimed record; payload jsonb; first_result record; second_result record;
BEGIN
  SELECT * INTO claimed FROM public.meddecode_scoped_claim_next_prescription_analysis_job_v1('synthetic-worker-001',120);
  IF claimed.job_id IS DISTINCT FROM 'f3000000-0000-4000-8000-000000000003'::uuid THEN RAISE EXCEPTION 'completion fixture claim failed'; END IF;
  payload := jsonb_build_object('schema_version','1.0','job_id',claimed.job_id::text,'prescription_id',claimed.prescription_id::text,
    'status','completed','prescription','{}'::jsonb,'patient','{}'::jsonb,'medicines','[]'::jsonb,
    'recommendations','[]'::jsonb,'warnings','[]'::jsonb,'processing_metadata','{}'::jsonb);
  BEGIN
    PERFORM public.meddecode_scoped_complete_prescription_analysis_job_v1(claimed.job_id,claimed.prescription_id,'other-worker-001',claimed.claim_generation,payload);
    RAISE EXCEPTION 'foreign worker completion succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  SELECT * INTO first_result FROM public.meddecode_scoped_complete_prescription_analysis_job_v1(claimed.job_id,claimed.prescription_id,'synthetic-worker-001',claimed.claim_generation,payload);
  SELECT * INTO second_result FROM public.meddecode_scoped_complete_prescription_analysis_job_v1(claimed.job_id,claimed.prescription_id,'synthetic-worker-001',claimed.claim_generation,payload);
  IF first_result.replayed OR NOT second_result.replayed THEN RAISE EXCEPTION 'completion replay behavior failed'; END IF;
END $completion$;
RESET ROLE;
DO $completion_verify$ BEGIN
  IF (SELECT count(*) FROM public.prescription_intelligence_results WHERE prescription_id='f2000000-0000-4000-8000-000000000003') <> 1 OR
     NOT EXISTS (SELECT 1 FROM public.ai_jobs WHERE id='f3000000-0000-4000-8000-000000000003' AND status='completed') OR
     NOT EXISTS (SELECT 1 FROM public.ai_jobs WHERE id='f3000000-0000-4000-8000-000000000002' AND status='queued') THEN
    RAISE EXCEPTION 'atomic completion or unscoped isolation failed';
  END IF;
END $completion_verify$;
ROLLBACK;
SELECT CASE WHEN to_regclass('public.meddecode_scoped_worker_scope') IS NULL AND
  to_regprocedure('public.meddecode_scoped_claim_next_prescription_analysis_job_v1(text,integer)') IS NULL
  THEN 'SCOPED_ROLLBACK_OK' ELSE 'SCOPED_ROLLBACK_FAILED' END;
'@
  ($guard + "`n" + $candidate + "`n" + $checks) | & $psql -X -w -qAt -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5433 -U postgres -d $db
  if ($LASTEXITCODE -ne 0) { throw 'Scoped rollback test failed.' }
} finally {
  $env:PGPASSFILE = $oldPassFile
  if (Test-Path -LiteralPath $tempFile) { Remove-Item -LiteralPath $tempFile -Force }
}
