import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const root = join(process.cwd(), "database", "integration-migrations",
  "202611120002_processing_worker_claim_heartbeat");
const source = (path: string) => readFile(join(root, path), "utf8");

test("worker claim is atomic, leased, and fenced", async () => {
  const sql = await source("002_up.sql");
  assert.match(sql, /FOR UPDATE OF j SKIP LOCKED/);
  assert.match(sql, /attempt_count = j\.attempt_count \+ 1/);
  assert.match(sql, /claim_generation = j\.claim_generation \+ 1/);
  assert.match(sql, /lease_expires_at = clock_timestamp\(\) \+ make_interval/);
  assert.match(sql, /job_type <> 'prescription_analysis'/);
});

test("heartbeat rejects stale, expired, or differently owned claims", async () => {
  const sql = await source("002_up.sql");
  assert.match(sql, /j\.lease_owner = p_worker_instance_id/);
  assert.match(sql, /j\.claim_generation = p_claim_generation/);
  assert.match(sql, /j\.lease_expires_at > clock_timestamp\(\)/);
  assert.match(sql, /stale or expired worker claim/);
});

test("worker authorization excludes application roles and direct writes", async () => {
  const up = await source("002_up.sql");
  const verify = await source("003_verify.sql");
  assert.match(up, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.match(up, /REVOKE CREATE ON SCHEMA public FROM meddecode_worker/);
  assert.match(up, /GRANT USAGE ON SCHEMA public TO meddecode_worker/);
  assert.match(up, /REVOKE ALL ON TABLE public\.ai_jobs FROM meddecode_worker/);
  assert.match(verify, /has_function_privilege\('authenticated'/);
  assert.match(verify, /has_schema_privilege\('meddecode_worker', 'public', 'USAGE'\)/);
  assert.match(verify, /worker role has direct table privileges/);
});

test("local harness is hard-locked and uses overlapping claim sessions", async () => {
  const runner = await source("test/run-local.ps1");
  const safety = await source("test/harness-safety.psm1");
  const concurrent = await source("test/20_concurrent_claim.sql");
  const verify = await source("test/30_concurrency_verify.sql");
  assert.match(safety, /Host -cne '127\.0\.0\.1'/);
  assert.match(runner, /ApproveDisposableReset/);
  assert.match(safety, /Port -ne 5433/);
  assert.match(safety, /meddecode_job_test/);
  assert.match(runner, /PostgreSQL\\17\\bin\\psql\.exe/);
  assert.match(runner, /1\.\.2/);
  assert.match(concurrent, /pg_sleep\(1\)/);
  assert.match(concurrent, /claim_next_prescription_analysis_job_v1/);
  assert.match(verify, /two overlapping sessions/);
  assert.doesNotMatch(concurrent, /\\error\b/);
});

test("concurrency probe is recorded outside the restricted worker role", async () => {
  const runner = await source("test/run-local.ps1");
  const concurrent = await source("test/20_concurrent_claim.sql");
  const up = await source("002_up.sql");
  const probeInsert = concurrent.indexOf("INSERT INTO public.processing_job_concurrency_probe");
  const workerRole = concurrent.indexOf("SET LOCAL ROLE meddecode_worker");
  const claimRpc = concurrent.indexOf("claim_next_prescription_analysis_job_v1");
  const sleep = concurrent.indexOf("SELECT pg_sleep(1)");
  const resetRole = concurrent.indexOf("RESET ROLE");
  const probeUpdate = concurrent.indexOf("UPDATE public.processing_job_concurrency_probe");

  assert.ok(probeInsert >= 0 && probeInsert < workerRole);
  assert.ok(workerRole < claimRpc && claimRpc < sleep && sleep < resetRole);
  assert.ok(resetRole < probeUpdate);
  assert.match(up, /FOR UPDATE OF j SKIP LOCKED/);
  assert.match(runner, /1\.\.2/);
  assert.match(runner, /Start-Process/);
});

test("destructive reset is preceded by identity and inventory guards", async () => {
  const runner = await source("test/run-local.ps1");
  const identity = await source("test/00_identity_preflight.sql");
  const inventory = await source("test/01_reset_inventory.sql");
  const bootstrapPosition = runner.indexOf("test\\00_bootstrap.sql");
  assert.ok(runner.indexOf("00_identity_preflight.sql") < bootstrapPosition);
  assert.ok(runner.indexOf("01_reset_inventory.sql") < bootstrapPosition);
  assert.match(identity, /current_database\(\).*meddecode_job_test/s);
  assert.match(identity, /inet_server_addr\(\).*127\.0\.0\.1/s);
  assert.match(identity, /inet_server_port\(\).*5433/s);
  assert.match(identity, /server_version_num.*10000 <> 17/s);
  assert.match(inventory, /other sessions are connected/);
  assert.match(inventory, /unexpected user schemas/);
  assert.match(inventory, /extension depends on public or auth/);
  assert.match(inventory, /unexpected relations/);
  assert.match(inventory, /unexpected functions/);
  assert.match(inventory, /unexpected constraints/);
  assert.match(inventory, /unexpected RLS policies/);
  assert.match(inventory, /unexpected triggers/);
  assert.match(inventory, /unexpected user-defined types/);
  assert.match(inventory, /required pre-created cluster roles are missing/);
  assert.match(inventory, /unexpected prescription rows/);
  assert.match(inventory, /unexpected job rows/);
});

test("worker fixture never creates or alters cluster roles", async () => {
  const roleGuard = await source("test/00_worker_role.sql");
  assert.doesNotMatch(roleGuard, /\bCREATE\s+ROLE\b/i);
  assert.doesNotMatch(roleGuard, /\bALTER\s+ROLE\b/i);
  assert.doesNotMatch(roleGuard, /\bDROP\s+ROLE\b/i);
  assert.match(roleGuard, /role creation requires separate approval/);
  assert.match(roleGuard, /unsafe attributes/);
});

test("worker behavior reuses inherited users and owns only its distinct prescription fixture", async () => {
  const behavior = await source("test/10_behavior.sql");
  const inheritedBootstrap = await readFile(join(
    process.cwd(), "database", "integration-migrations",
    "202611120001_processing_job_submission", "test", "00_bootstrap.sql"
  ), "utf8");
  assert.doesNotMatch(behavior, /INSERT\s+INTO\s+public\.users/i);
  assert.match(behavior, /INSERT\s+INTO\s+public\.prescriptions/i);
  assert.match(behavior, /20000000-0000-4000-8000-000000000001/);
  assert.doesNotMatch(inheritedBootstrap, /20000000-0000-4000-8000-000000000001/);
  assert.equal((behavior.match(/INSERT\s+INTO\s+public\.prescriptions/gi) ?? []).length, 1);
  assert.doesNotMatch(behavior, /INSERT\s+INTO\s+public\.ai_jobs/i);
  assert.doesNotMatch(behavior, /INSERT\s+INTO\s+public\.prescription_intelligence_results/i);
  assert.match(behavior, /label_is_not_authorization/);
  assert.match(behavior, /current_setting\('worker_test\.claim_generation'\)/);
  const doBodies = [...behavior.matchAll(/DO \$([a-z_]+)\$([\s\S]*?)\$\1\$/gi)]
    .map((match) => match[2] ?? "");
  assert.ok(doBodies.every((body) => !/:'claim_[^']+'/i.test(body)));
});

test("migration preserves Milestone 2C RPCs and omits finalization", async () => {
  const preflight = await source("001_preflight.sql");
  const up = await source("002_up.sql");
  assert.match(preflight, /submit_prescription_analysis_job_v1/);
  assert.match(preflight, /get_prescription_analysis_status_v1/);
  assert.doesNotMatch(up, /CREATE OR REPLACE FUNCTION public\.submit_prescription_analysis_job_v1/);
  assert.doesNotMatch(up, /finalize|prescription_intelligence_results/i);
});
