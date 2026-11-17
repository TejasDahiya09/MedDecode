import assert from "node:assert/strict";
import test from "node:test";
import { assertWorkerDatabaseIdentity, automaticClaimGate, runWorkerLoop, scheduleWorkerRecovery, workerStartupConfig } from "../src/worker.js";

const config = {
  NODE_ENV: "production",
  PROCESSING_WORKER_ENABLED: "true", PROCESSING_WORKER_INSTANCE_ID: "worker-test-001",
  WORKER_RPC_MODE: "standard",
  WORKER_DATABASE_URL: "postgresql://restricted-worker:example@127.0.0.1:5433/test",
  WORKER_DATABASE_CA_FILE: "ca.pem", AWS_REGION: "test-region", AWS_S3_BUCKET: "test-bucket",
  WORKER_PYTHON_EXECUTABLE: "python", WORKER_INTELLIGENCE_DIRECTORY: "intelligence",
  WORKER_EASYOCR_MODEL_DIRECTORY: "models", WORKER_LOCAL_OFFICIAL_CATALOGUE: "true",
  PYTHON_INTELLIGENCE_URL: "http://127.0.0.1:8000", MEDDECODE_INTERNAL_TOKEN: "test-only-token-with-at-least-32-characters",
};

test('exact retry is disabled by default and requires complete scoped V3 single-execution configuration', () => {
  assert.equal(workerStartupConfig(config).exactRetry,undefined);
  const controlled={...config,WORKER_DATABASE_URL:'postgresql://meddecode_auto_worker_login:fake@db.wyripeqruhvbksjfsvlr.supabase.co:5432/postgres',
    WORKER_RPC_MODE:'scoped',WORKER_SINGLE_ATTEMPT:'true',WORKER_AUTOMATIC_AUTHORIZATION_ENABLED:'true',
    MEDDECODE_PRESCRIPTION_REVIEW_V3_ENABLED:'true',PROCESSING_WORKER_INSTANCE_ID:'meddecode-auto-worker-001',
    WORKER_EXACT_RETRY_PERMIT_ID:'60000000-0000-4000-8000-000000000001',WORKER_EXACT_RETRY_JOB_ID:'40000000-0000-4000-8000-000000000001',
    WORKER_EXACT_RETRY_PRESCRIPTION_ID:'30000000-0000-4000-8000-000000000001',WORKER_EXACT_RETRY_EXPECTED_GENERATION:'1'};
  assert.equal(workerStartupConfig(controlled).exactRetry?.expectedClaimGeneration,1);
  for(const key of ['WORKER_EXACT_RETRY_PERMIT_ID','WORKER_EXACT_RETRY_JOB_ID','WORKER_EXACT_RETRY_PRESCRIPTION_ID','WORKER_EXACT_RETRY_EXPECTED_GENERATION']) assert.throws(()=>workerStartupConfig({...controlled,[key]:undefined}));
  for(const replacement of [{WORKER_SINGLE_ATTEMPT:'false'},{WORKER_AUTOMATIC_AUTHORIZATION_ENABLED:'false'},
    {MEDDECODE_PRESCRIPTION_REVIEW_V3_ENABLED:'false'},{WORKER_EXACT_RETRY_EXPECTED_GENERATION:'0'},
    {WORKER_EXACT_RETRY_EXPECTED_GENERATION:'9007199254740991'}]) assert.throws(()=>workerStartupConfig({...controlled,...replacement}));
});
test("worker startup configuration is disabled by default and requires every dependency", () => {
  assert.throws(() => workerStartupConfig({}), /disabled/);
  assert.throws(() => workerStartupConfig({ ...config, AWS_S3_BUCKET: "" }), /AWS_S3_BUCKET/);
  assert.equal(workerStartupConfig(config).region, "test-region");
});
test("development workers require the separately authorized scoped RPC mode", () => {
  assert.throws(() => workerStartupConfig({ ...config, NODE_ENV: "development" }), /scoped RPCs/);
  assert.throws(() => workerStartupConfig({ ...config, WORKER_RPC_MODE: undefined }), /RPC mode/);
  assert.equal(workerStartupConfig({ ...config, NODE_ENV: "development", WORKER_RPC_MODE: "scoped" }).rpcMode, "scoped");
  assert.throws(() => workerStartupConfig({ ...config, WORKER_RPC_MODE: "unexpected" }));
});
test("controlled single attempt requires scoped RPCs and never restarts the claim loop", async () => {
  assert.throws(() => workerStartupConfig({ ...config, WORKER_SINGLE_ATTEMPT: "true" }), /scoped/);
  assert.throws(() => workerStartupConfig({ ...config, WORKER_RPC_MODE: "scoped", WORKER_SINGLE_ATTEMPT: "other" }));
  assert.equal(workerStartupConfig({ ...config, WORKER_RPC_MODE: "scoped", WORKER_SINGLE_ATTEMPT: "true" }).singleAttempt, true);
  assert.equal(workerStartupConfig(config).singleAttempt, false);
  let calls = 0;
  await runWorkerLoop({ async start() { calls += 1; } }, () => false, true);
  assert.equal(calls, 1);
  calls = 0;
  await runWorkerLoop({ async start() { calls += 1; } }, () => calls === 2, false);
  assert.equal(calls, 2);
});
test("automatic admission requires scoped mode and dedicated login verification", () => {
  const direct = { ...config, WORKER_DATABASE_URL: "postgresql://meddecode_auto_worker_login:fake@db.wyripeqruhvbksjfsvlr.supabase.co:5432/postgres" };
  assert.equal(workerStartupConfig({ ...direct, WORKER_RPC_MODE: "scoped", WORKER_AUTOMATIC_AUTHORIZATION_ENABLED: "true" }).automaticAuthorization, true);
  assert.throws(() => workerStartupConfig({ ...config, WORKER_AUTOMATIC_AUTHORIZATION_ENABLED: "true" }), /scoped mode/);
  assert.equal(workerStartupConfig({ ...direct, WORKER_RPC_MODE: "scoped", WORKER_SINGLE_ATTEMPT: "true", WORKER_AUTOMATIC_AUTHORIZATION_ENABLED: "true" }).singleAttempt, true);
  assert.throws(() => workerStartupConfig({ ...config, WORKER_RPC_MODE: "scoped", WORKER_AUTOMATIC_AUTHORIZATION_ENABLED: "true" }), /direct database connection/);
  assert.throws(() => workerStartupConfig({ ...direct, WORKER_DATABASE_URL: "postgresql://meddecode_auto_worker_login.wyripeqruhvbksjfsvlr:fake@x.pooler.supabase.com:5432/postgres", WORKER_RPC_MODE: "scoped", WORKER_AUTOMATIC_AUTHORIZATION_ENABLED: "true" }), /direct database connection/);
  const row = { role: "meddecode_scoped_worker", claim_rpc: true, heartbeat_rpc: true, complete_rpc: true,
    fail_rpc: true, recover_rpc: true, login_restricted: true, login_no_table_access: true, role_no_table_access: true,
    automatic_login: true, issuer_rpc: true };
  assert.doesNotThrow(() => assertWorkerDatabaseIdentity(row, "scoped", true));
  assert.throws(() => assertWorkerDatabaseIdentity({ ...row, automatic_login: false }, "scoped", true));
  assert.throws(() => assertWorkerDatabaseIdentity({ ...row, issuer_rpc: false }, "scoped", true));
  assert.throws(() => assertWorkerDatabaseIdentity(row, "scoped", true, true));
  assert.doesNotThrow(() => assertWorkerDatabaseIdentity({ ...row, no_competing_worker_sessions: true }, "scoped", true, true));
  assert.throws(() => assertWorkerDatabaseIdentity({ ...row, no_competing_worker_sessions: false }, "scoped", true, true));
});
test("controlled automatic gate never recovers expired jobs", async () => {
  let recoveries = 0;
  const recover = async () => { recoveries += 1; };
  assert.equal(await automaticClaimGate(async () => true, recover, true)(), true);
  assert.equal(await automaticClaimGate(async () => false, recover, true)(), false);
  await assert.rejects(automaticClaimGate(async () => { throw new Error("issuer outage"); }, recover, true)());
  assert.equal(recoveries, 0);
  assert.equal(await automaticClaimGate(async () => true, recover, false)(), true);
  assert.equal(recoveries, 1);
});
test("worker rejects privileged logins, TLS overrides and unsafe intelligence transport", () => {
  for (const databaseUrl of ["postgresql://postgres@example.invalid/db", "postgresql://service_role@example.invalid/db", "postgresql://worker@example.invalid/db?sslmode=disable"]) {
    assert.throws(() => workerStartupConfig({ ...config, WORKER_DATABASE_URL: databaseUrl }));
  }
  assert.throws(() => workerStartupConfig({ ...config, PYTHON_INTELLIGENCE_URL: "http://untrusted.invalid" }));
  assert.throws(() => workerStartupConfig({ ...config, MEDDECODE_INTERNAL_TOKEN: "short" }));
});
test("worker requires a private intelligence endpoint and token without Python database credentials", () => {
  assert.equal(workerStartupConfig({ ...config, MEDDECODE_CATALOGUE_ENV: "", WORKER_PYTHON_EXECUTABLE: "" }).intelligenceUrl, "http://127.0.0.1:8000");
  assert.throws(() => workerStartupConfig({ ...config, PYTHON_INTELLIGENCE_URL: "" }));
});
test("V3 startup requires explicit Python executable and intelligence directory", () => {
  assert.throws(() => workerStartupConfig({
    ...config, MEDDECODE_PRESCRIPTION_REVIEW_V3_ENABLED: "true", WORKER_PYTHON_EXECUTABLE: ""
  }), /WORKER_PYTHON_EXECUTABLE/);
  assert.throws(() => workerStartupConfig({
    ...config, MEDDECODE_PRESCRIPTION_REVIEW_V3_ENABLED: "true", WORKER_INTELLIGENCE_DIRECTORY: ""
  }), /WORKER_INTELLIGENCE_DIRECTORY/);
});
test("worker rejects missing RPC privileges and elevated database identities", () => {
  const row = { role: "meddecode_worker", claim_rpc: true, heartbeat_rpc: true, complete_rpc: true,
    fail_rpc: true, recover_rpc: true, login_restricted: true, login_no_table_access: true, role_no_table_access: true };
  assert.doesNotThrow(() => assertWorkerDatabaseIdentity(row));
  for (const key of ["login_restricted", "login_no_table_access", "role_no_table_access", "fail_rpc"]) {
    assert.throws(() => assertWorkerDatabaseIdentity({ ...row, [key]: false }));
  }
  assert.throws(() => assertWorkerDatabaseIdentity({ ...row, role: "postgres" }));
  assert.doesNotThrow(() => assertWorkerDatabaseIdentity({ ...row, role: "meddecode_scoped_worker" }, "scoped"));
  assert.throws(() => assertWorkerDatabaseIdentity(row, "scoped"));
});

test("recovery scheduler serializes sweeps and waits for shutdown", async () => {
  let calls = 0;
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const scheduler = scheduleWorkerRecovery(async () => { calls += 1; await gate; }, 60_000);
  const first = scheduler.tick();
  const second = scheduler.tick();
  assert.equal(calls, 1);
  let stopped = false;
  const shutdown = scheduler.stop().then(() => { stopped = true; });
  await Promise.resolve();
  assert.equal(stopped, false);
  finish();
  await Promise.all([first, second, shutdown]);
  await scheduler.tick();
  assert.equal(calls, 1);
});
