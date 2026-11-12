import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const migrationRoot = join(
  process.cwd(),
  "database",
  "integration-migrations",
  "202611120001_processing_job_submission",
);

async function source(relativePath: string): Promise<string> {
  return readFile(join(migrationRoot, relativePath), "utf8");
}

test("job submission migration enforces authenticated ownership and atomic reuse", async () => {
  const sql = await source("002_up.sql");
  assert.match(sql, /SECURITY DEFINER/);
  assert.match(sql, /SET search_path = ''/);
  assert.match(sql, /AS \$function\$\n#variable_conflict use_column\nDECLARE/);
  assert.match(sql, /v_user_id uuid := auth\.uid\(\)/);
  assert.match(sql, /p\.user_id = v_user_id[\s\S]*FOR UPDATE/);
  assert.match(sql, /prescription_intelligence_results/);
  assert.match(sql, /CREATE UNIQUE INDEX ai_jobs_one_active_prescription_analysis_uq/);
  assert.match(sql, /ON CONFLICT \(prescription_id, job_type\)/);
  assert.doesNotMatch(sql, /ON CONFLICT\s+DO NOTHING/);
  assert.match(sql, /RETURN QUERY SELECT v_job\.id, v_job\.prescription_id, v_job\.status, false/);
  assert.match(sql, /REVOKE INSERT ON TABLE public\.ai_jobs FROM authenticated/);
});

test("submission migration keeps the four-state job model and exact analysis request", async () => {
  const sql = await source("002_up.sql");
  assert.match(sql, /j\.status IN \('queued', 'processing'\)/);
  assert.doesNotMatch(sql, /completed_with_warnings[\s\S]*ai_jobs/);
  for (const pair of [
    "'extract_prescription', true",
    "'match_medicines', true",
    "'find_alternatives', false",
    "'generate_recommendations', true",
  ]) {
    assert.ok(sql.includes(pair));
  }
});

test("status function is owner scoped, invoker security, and returns no fabricated progress", async () => {
  const sql = await source("002_up.sql");
  assert.match(sql, /get_prescription_analysis_status_v1/);
  assert.match(sql, /SECURITY INVOKER/);
  assert.match(sql, /p\.user_id = auth\.uid\(\)/);
  assert.match(sql, /candidate\.user_id = auth\.uid\(\)/);
  assert.doesNotMatch(sql, /progress|percentage|ocr_text/i);
});

test("migration grants exclude PUBLIC and anon and verification checks direct insert denial", async () => {
  const up = await source("002_up.sql");
  const verify = await source("003_verify.sql");
  assert.match(up, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon/);
  assert.match(up, /GRANT EXECUTE ON FUNCTION[\s\S]*TO authenticated/);
  assert.match(verify, /acl\.grantee = 0/);
  assert.match(verify, /has_table_privilege\('authenticated', 'public\.ai_jobs', 'INSERT'\)/);
});

test("migration fails closed on catalog drift before commit and tests rollback", async () => {
  const up = await source("002_up.sql");
  const verify = await source("003_verify.sql");
  const runner = await source(join("test", "run-local.ps1"));
  const assertionsStart = up.indexOf("DO $deployment_assertions$");
  const commit = up.lastIndexOf("COMMIT;");

  assert.ok(assertionsStart >= 0 && assertionsStart < commit);
  for (const expression of [
    /indisvalid/,
    /indisready/,
    /pg_get_expr/,
    /to_regprocedure\('public\.submit_prescription_analysis_job_v1\(uuid,jsonb\)'\)/,
    /to_regprocedure\('public\.get_prescription_analysis_status_v1\(uuid\)'\)/,
    /has_function_privilege\('anon'/,
    /has_function_privilege\('authenticated'/,
    /has_any_column_privilege\('authenticated', 'public\.ai_jobs', 'INSERT'\)/,
    /authenticated SELECT privileges required by the status RPC are missing/,
  ]) {
    assert.match(up.slice(assertionsStart, commit), expression);
    assert.match(verify, expression);
  }
  assert.match(runner, /Invoke-ExpectedPsqlFailure/);
  assert.match(runner, /REVOKE SELECT ON TABLE public\.ai_jobs FROM authenticated/);
  assert.match(runner, /Post-failure verification found migration state was not rolled back/);
});

test("preflight rejects historical integrity anomalies without repairing them", async () => {
  const sql = await source("001_preflight.sql");
  assert.match(sql, /v_duplicate_active/);
  assert.match(sql, /j\.user_id IS DISTINCT FROM p\.user_id/);
  assert.match(sql, /j\.prescription_id IS DISTINCT FROM r\.prescription_id/);
  assert.doesNotMatch(sql, /\bUPDATE\b|\bDELETE\b|\bINSERT\b/);
});

test("local harness is loopback-only and covers rollback, concurrency, and migration replay", async () => {
  const runner = await source(join("test", "run-local.ps1"));
  const bootstrap = await source(join("test", "00_bootstrap.sql"));
  const behavior = await source(join("test", "10_behavior.sql"));
  const concurrent = await source(join("test", "20_concurrent_submit.sql"));
  const concurrencyVerify = await source(join("test", "30_concurrency_verify.sql"));
  assert.match(runner, /localhost/);
  assert.match(runner, /127\.0\.0\.1/);
  assert.match(runner, /::1/);
  assert.match(runner, /Port -ne 5433/);
  assert.match(runner, /meddecode_job_test/);
  assert.match(runner, /UserInfo\.Contains\(':\'\)/);
  assert.match(runner, /PostgreSQL\\17\\bin\\psql\.exe/);
  assert.match(runner, /Read-Host 'Local PostgreSQL password' -AsSecureString/);
  assert.match(runner, /PGPASSFILE/);
  assert.match(runner, /postgresql\\pgpass\.conf/);
  assert.match(runner, /-and -not \$hasPgpass/);
  assert.match(runner, /ZeroFreeBSTR/);
  assert.match(runner, /Remove-Item Env:PGPASSWORD/);
  assert.equal((runner.match(/002_up\.sql/g) ?? []).length, 4);
  assert.match(runner, /System\.Diagnostics\.ProcessStartInfo/);
  assert.match(runner, /System\.Diagnostics\.Process/);
  assert.match(runner, /WaitForExit\(\)/);
  assert.match(runner, /HasExited/);
  assert.match(runner, /\.ExitCode/);
  assert.match(runner, /RedirectStandardOutput/);
  assert.match(runner, /RedirectStandardError/);
  assert.match(runner, /SUBMISSION_RESULT/);
  assert.match(runner, /Concurrent submissions returned different job IDs/);
  assert.match(runner, /exactly one created and one reused result/);
  assert.match(runner, /Concurrent session \$\(\$process\.SessionId\) exit code/);
  assert.match(runner, /Get-SanitizedDiagnostic/);
  assert.match(runner, /Get-ConcurrencyFailureKind/);
  assert.match(runner, /Remove-Item -LiteralPath \$concurrencyOutputDirectory -Recurse -Force/);
  assert.match(concurrent, /session_id must be provided/);
  for (const sql of [bootstrap, behavior, concurrent, concurrencyVerify]) {
    assert.doesNotMatch(sql, /\\error\b/);
  }
  assert.match(concurrent, /RAISE EXCEPTION 'session_id must be provided/);
  assert.match(concurrent, /processing_job_concurrency_probe/);
  assert.match(concurrent, /pg_backend_pid\(\)/);
  assert.match(concurrent, /pg_sleep\(1\)/);
  assert.match(concurrent, /job_id, created/);
  assert.match(concurrent, /\\gset submission_/);
  assert.match(concurrencyVerify, /count\(DISTINCT backend_pid\)/);
  assert.match(concurrencyVerify, /did not demonstrate two overlapping PostgreSQL sessions/);
  assert.match(concurrencyVerify, /count\(DISTINCT job_id\)/);
  assert.match(concurrencyVerify, /one created and one reused result/);
  assert.match(behavior, /ROLLBACK/);
  assert.match(behavior, /missing-authentication submission unexpectedly succeeded/);
});

test("recovery is operator-gated, definition-bound, data-preserving, and independently verified", async () => {
  const recovery = await source("004_recovery.sql");
  const verify = await source("005_recovery_verify.sql");
  const recoveryTest = await source("test/40_recovery.sql");
  const recoveryRefusalTest = await source("test/35_recovery_refuses_jobs.sql");
  const bootstrap = await source("test/00_bootstrap.sql");
  const runner = await source("test/run-local.ps1");
  const readme = await source("README.md");

  assert.match(recovery, /meddecode_recovery_approved/);
  assert.match(recovery, /captured ai_jobs baseline must be the independently verified zero/);
  assert.match(recovery, /result_identity_fingerprint/);
  assert.match(recovery, /prescription_status_fingerprint/);
  assert.match(recovery, /LOCK TABLE public\.prescriptions,[\s\S]*SHARE ROW EXCLUSIVE/);
  assert.match(recovery, /v_source_hash IS DISTINCT FROM 'f79ebc543f5128eea5e653d8cd9e1d6d'/);
  assert.match(recovery, /v_source_hash IS DISTINCT FROM '303abe8ae15afd81d7a75c574eb93132'/);
  assert.match(recovery, /DROP FUNCTION public\.submit_prescription_analysis_job_v1\(uuid, jsonb\) RESTRICT/);
  assert.match(recovery, /DROP FUNCTION public\.get_prescription_analysis_status_v1\(uuid\) RESTRICT/);
  assert.match(recovery, /DROP INDEX public\.ai_jobs_one_active_prescription_analysis_uq RESTRICT/);
  assert.match(recovery, /GRANT INSERT ON TABLE public\.ai_jobs TO authenticated/);
  assert.doesNotMatch(recovery, /\bDELETE\b|\bTRUNCATE\b|\bUPDATE\s+public\./);
  assert.match(verify, /migration-owned objects remain/);
  assert.match(verify, /acl\.grantee = 0[\s\S]*acl\.privilege_type = 'INSERT'/);
  assert.match(recoveryTest, /\\ir \.\.\/004_recovery\.sql/);
  assert.match(recoveryTest, /\\ir \.\.\/005_recovery_verify\.sql/);
  assert.match(recoveryRefusalTest, /\\set baseline_ai_jobs_count 0/);
  assert.match(recoveryRefusalTest, /\\ir \.\.\/004_recovery\.sql/);
  assert.match(bootstrap, /CREATE POLICY ai_jobs_insert_own[\s\S]*WITH CHECK \(user_id = auth\.uid\(\)\)/);
  assert.match(bootstrap, /GRANT INSERT ON public\.ai_jobs TO authenticated/);
  assert.match(runner, /recoveryScripts/);
  assert.match(runner, /40_recovery\.sql/);
  assert.match(runner, /35_recovery_refuses_jobs\.sql/);
  assert.match(readme, /Stop without recovery if any job exists/);
  assert.match(readme, /never be scheduled or[\s\S]*application startup/);
});
