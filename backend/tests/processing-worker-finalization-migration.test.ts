import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const root = join(process.cwd(), "database", "integration-migrations",
  "202611120003_processing_worker_finalization_recovery");
const source = (path: string) => readFile(join(root, path), "utf8");

test("finalization candidate is explicitly local-only and preserves prior migration boundaries", async () => {
  const readme = await source("README.md");
  const preflight = await source("001_preflight.sql");
  const up = await source("002_up.sql");
  assert.match(readme, /LOCAL INTEGRATION CANDIDATE ONLY/);
  assert.match(preflight, /submit_prescription_analysis_job_v1/);
  assert.match(preflight, /claim_next_prescription_analysis_job_v1/);
  assert.match(preflight, /unsupported required user_id column/);
  assert.match(preflight, /prescription intelligence persistence columns are incompatible/);
  assert.doesNotMatch(up, /CREATE OR REPLACE FUNCTION public\.submit_prescription_analysis_job_v1/);
  assert.doesNotMatch(up, /CREATE OR REPLACE FUNCTION public\.claim_next_prescription_analysis_job_v1/);
});

test("completion is fenced, ordered, structurally bounded, and transactional", async () => {
  const up = await source("002_up.sql");
  assert.match(up, /BEGIN;[\s\S]*COMMIT;/);
  assert.match(up, /complete_prescription_analysis_job_v1\([\s\S]*p_claim_generation bigint[\s\S]*p_result_json jsonb/);
  assert.match(up, /octet_length\(p_result_json::text\) > 2097152/);
  assert.match(up, /p_result_json->>'job_id' IS DISTINCT FROM p_job_id::text/);
  assert.match(up, /p_result_json->>'prescription_id' IS DISTINCT FROM p_prescription_id::text/);
  assert.match(up, /COALESCE\(p_result_json->>'status' NOT IN \('completed', 'completed_with_warnings'\), true\)/);
  assert.match(up, /SELECT j\.\* INTO v_job[\s\S]*FOR UPDATE/);
  assert.match(up, /SELECT p\.\* INTO v_prescription[\s\S]*FOR UPDATE/);
  assert.match(up, /v_job\.lease_owner IS DISTINCT FROM p_worker_instance_id/);
  assert.match(up, /v_job\.claim_generation IS DISTINCT FROM p_claim_generation/);
  assert.match(up, /v_job\.lease_expires_at <= v_now/);
  assert.ok(up.indexOf("INSERT INTO public.prescription_intelligence_results") <
    up.indexOf("UPDATE public.ai_jobs AS j SET status = 'completed'"));
  assert.match(up, /jsonb_path_exists\(p_result_json, '\$\.medicines\[\*\]\.alternatives\[\*\]'\)/);
});

test("completion supports only exact replay and rejects conflicting or partial persistence", async () => {
  const up = await source("002_up.sql");
  assert.match(up, /v_existing\.result_json = p_result_json/);
  assert.match(up, /'worker_instance_id', p_worker_instance_id/);
  assert.match(up, /'claim_generation', p_claim_generation/);
  assert.match(up, /conflicting or incomplete persisted result/);
  assert.match(up, /existing projections conflict/);
});

test("failure accepts only safe codes and models retry versus terminal outcome", async () => {
  const up = await source("002_up.sql");
  assert.match(up, /fail_prescription_analysis_job_v1/);
  assert.match(up, /'PRESCRIPTION_UNAVAILABLE', 'DOCUMENT_REFERENCE_FAILED'/);
  assert.match(up, /'INTELLIGENCE_TRANSPORT_FAILED', 'INTELLIGENCE_RESPONSE_INVALID'/);
  assert.match(up, /p_retry_at > v_now \+ interval '24 hours'/);
  assert.match(up, /p_retryable IS NULL/);
  assert.match(up, /p_failure_code IS NULL/);
  assert.match(up, /status = 'queued', available_at = p_retry_at/);
  assert.match(up, /status = 'failed'/);
  assert.match(up, /Do not fabricate an immutable intelligence-result row/);
  assert.doesNotMatch(up, /p_failure_message|p_error_message|p_ocr_text/i);
});

test("recovery locks only expired processing jobs and advances fencing", async () => {
  const up = await source("002_up.sql");
  assert.match(up, /recover_expired_prescription_analysis_jobs_v1\(p_limit integer DEFAULT 50\)/);
  assert.match(up, /j\.status = 'processing'[\s\S]*j\.lease_expires_at <= v_now/);
  assert.match(up, /FOR UPDATE SKIP LOCKED LIMIT p_limit/);
  assert.match(up, /claim_generation = j\.claim_generation \+ 1/);
  assert.match(up, /'LEASE_EXPIRED_MAX_ATTEMPTS'/);
  assert.match(up, /expired job has a persisted result/);
});

test("worker-only security definer grants are independently verified", async () => {
  const up = await source("002_up.sql");
  const verify = await source("003_verify.sql");
  for (const name of [
    "complete_prescription_analysis_job_v1",
    "fail_prescription_analysis_job_v1",
    "recover_expired_prescription_analysis_jobs_v1",
  ]) {
    assert.match(up, new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}[\\s\\S]*FROM PUBLIC, anon, authenticated`));
    assert.match(up, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}[\\s\\S]*TO meddecode_worker`));
  }
  assert.match(up, /REVOKE ALL ON TABLE public\.ai_jobs, public\.prescriptions, public\.prescription_intelligence_results/);
  assert.match(verify, /p\.prosecdef IS DISTINCT FROM true/);
  assert.match(verify, /has_function_privilege\('authenticated'/);
  assert.match(verify, /worker role has direct finalization table privileges/);
});

test("future destructive harness is explicit, loopback-only, and reaches every runtime scenario", async () => {
  const runner = await source("test/run-local.ps1");
  const fixture = await source("test/00_completion_fixture.sql");
  const behavior = await source("test/10_behavior.sql");
  const failureRecovery = await source("test/20_fencing_and_recovery.sql");
  const concurrencyFixture = await source("test/30_prepare_completion_recovery_concurrency.sql");
  const recoverySession = await source("test/40_concurrent_recovery.sql");
  const completionSession = await source("test/41_concurrent_stale_completion.sql");
  const concurrencyVerify = await source("test/50_completion_recovery_concurrency_verify.sql");
  assert.match(runner, /ApproveDisposableReset/);
  assert.match(runner, /Assert-ApprovedWorkerTestTarget/);
  assert.match(runner, /127\.0\.0\.1/);
  assert.match(runner, /meddecode_job_test/);
  assert.match(runner, /00_identity_preflight\.sql/);
  assert.match(runner, /01_reset_inventory\.sql/);
  for (const name of [
    "10_behavior.sql", "20_fencing_and_recovery.sql",
    "30_prepare_completion_recovery_concurrency.sql",
    "40_concurrent_recovery.sql", "41_concurrent_stale_completion.sql",
    "50_completion_recovery_concurrency_verify.sql",
  ]) assert.match(runner, new RegExp(name.replaceAll(".", "\\.")));
  assert.match(runner, /Start-Process -FilePath \$PsqlPath/);
  assert.match(runner, /Wait-Process/);
  assert.match(runner, /ExitCode -ne 0/);
  assert.match(fixture, /DISPOSABLE LOCAL TEST FIXTURE ONLY/);
  assert.match(fixture, /ALTER COLUMN user_id DROP NOT NULL/);
  assert.match(fixture, /ADD COLUMN prescription_date date/);
  assert.match(behavior, /completion_atomicity_assertion/);
  assert.match(behavior, /psql deliberately does\s+-- not interpolate variables inside SQL string literals/);
  const completionCall = behavior.indexOf(
    "SELECT * FROM public.complete_prescription_analysis_job_v1("
  );
  const roleReset = behavior.indexOf("RESET ROLE;", completionCall);
  const completionAssertion = behavior.indexOf("completion_atomicity_assertion");
  assert.ok(completionCall >= 0 && roleReset > completionCall);
  assert.ok(roleReset < completionAssertion);
  assert.match(failureRecovery, /NULL retryable flag unexpectedly accepted/);
  assert.match(failureRecovery, /unsafe failure code unexpectedly accepted/);
  assert.match(failureRecovery, /wrong worker unexpectedly finalized/);
  assert.match(failureRecovery, /stale generation unexpectedly finalized/);
  assert.match(failureRecovery, /expired lease unexpectedly finalized/);
  assert.match(failureRecovery, /recovery_batch_limit_assertion/);
  assert.match(failureRecovery, /failure_and_recovery_assertion/);
  assert.match(concurrencyFixture, /processing_finalization_concurrency_probe/);
  assert.match(recoverySession, /pg_advisory_lock\(72003001\)/);
  assert.match(recoverySession, /recover_expired_prescription_analysis_jobs_v1/);
  assert.match(completionSession, /pg_try_advisory_lock\(72003001\)/);
  assert.match(completionSession, /object_not_in_prerequisite_state/);
  assert.match(concurrencyVerify, /two overlapping sessions/);
  assert.doesNotMatch(failureRecovery, /fixture_job_id/);
});
