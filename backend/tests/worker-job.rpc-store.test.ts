import assert from "node:assert/strict";
import test from "node:test";

import { UnavailableWorkerJobStore, WorkerJobStoreUnavailableError } from
  "../src/repositories/worker-job.store.js";
import {
  RestrictedWorkerRpcTransport,
  RpcWorkerJobStore,
  WORKER_CLAIM_RPC,
  WORKER_HEARTBEAT_RPC,
  WorkerRpcFunctionRejectedError,
  WorkerRpcStoreError,
  type WorkerRpcCaller,
  type WorkerRpcResult
} from "../src/repositories/worker-job.rpc-store.js";

const NOW = Date.parse("2026-11-12T12:00:00.000Z");
const JOB_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "20000000-0000-4000-8000-000000000002";
const PRESCRIPTION_ID = "30000000-0000-4000-8000-000000000003";

const claimRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  job_id: JOB_ID,
  user_id: USER_ID,
  prescription_id: PRESCRIPTION_ID,
  attempt_count: 1,
  claim_generation: 4,
  lease_expires_at: new Date(NOW + 120_000).toISOString(),
  storage_provider: "aws_s3",
  storage_bucket: "private-test-bucket",
  object_key: "private/prescriptions/synthetic/source.pdf",
  file_type: "application/pdf",
  input_reference: { contract_version: "1.0" },
  ...overrides
});

class FakeCaller implements WorkerRpcCaller {
  readonly calls: Array<{ name: string; parameters: Readonly<Record<string, unknown>> }> = [];
  responses: WorkerRpcResult[] = [];
  failure: Error | null = null;

  async rpc(
    functionName: string,
    parameters: Readonly<Record<string, unknown>>
  ): Promise<WorkerRpcResult> {
    this.calls.push({ name: functionName, parameters: structuredClone(parameters) });
    if (this.failure) throw this.failure;
    return this.responses.shift() ?? { data: [], error: null };
  }
}

const setup = (): { caller: FakeCaller; store: RpcWorkerJobStore; transport: RestrictedWorkerRpcTransport } => {
  const caller = new FakeCaller();
  const transport = new RestrictedWorkerRpcTransport(caller);
  return { caller, transport, store: new RpcWorkerJobStore(transport, () => NOW) };
};

test("claim uses only the exact approved RPC and SQL parameter names", async () => {
  const { caller, store } = setup();
  caller.responses.push({ data: [claimRow()], error: null });
  const result = await store.claimNext("worker-test-001", 120);
  assert.equal(result?.jobId, JOB_ID);
  assert.deepEqual(caller.calls, [{
    name: WORKER_CLAIM_RPC,
    parameters: { p_worker_instance_id: "worker-test-001", p_lease_seconds: 120 }
  }]);
});

test("claim maps an empty RPC set to no queued job", async () => {
  const { caller, store } = setup();
  caller.responses.push({ data: [], error: null });
  assert.equal(await store.claimNext("worker-test-001", 120), null);
});

test("claim rejects malformed and expired responses", async () => {
  const malformed = setup();
  malformed.caller.responses.push({ data: [claimRow({ unexpected: true })], error: null });
  await assert.rejects(
    malformed.store.claimNext("worker-test-001", 120),
    (error: unknown) => error instanceof WorkerRpcStoreError &&
      error.category === "MALFORMED_RESPONSE"
  );

  const expired = setup();
  expired.caller.responses.push({
    data: [claimRow({ lease_expires_at: new Date(NOW).toISOString() })], error: null
  });
  await assert.rejects(
    expired.store.claimNext("worker-test-001", 120),
    (error: unknown) => error instanceof WorkerRpcStoreError &&
      error.category === "MALFORMED_RESPONSE"
  );
});

test("heartbeat uses the exact RPC parameters and validates correlation", async () => {
  const { caller, store } = setup();
  caller.responses.push({ data: [{
    job_id: JOB_ID,
    claim_generation: 4,
    lease_expires_at: new Date(NOW + 240_000).toISOString()
  }], error: null });
  const result = await store.heartbeat({
    jobId: JOB_ID,
    workerInstanceId: "worker-test-001",
    claimGeneration: 4,
    extendSeconds: 120
  });
  assert.equal(result.claimGeneration, 4);
  assert.deepEqual(caller.calls, [{
    name: WORKER_HEARTBEAT_RPC,
    parameters: {
      p_job_id: JOB_ID,
      p_worker_instance_id: "worker-test-001",
      p_claim_generation: 4,
      p_extend_seconds: 120
    }
  }]);
});

test("heartbeat rejects stale generation, wrong job and expired lease", async () => {
  for (const row of [
    { job_id: JOB_ID, claim_generation: 5, lease_expires_at: new Date(NOW + 1_000).toISOString() },
    { job_id: USER_ID, claim_generation: 4, lease_expires_at: new Date(NOW + 1_000).toISOString() },
    { job_id: JOB_ID, claim_generation: 4, lease_expires_at: new Date(NOW).toISOString() }
  ]) {
    const { caller, store } = setup();
    caller.responses.push({ data: [row], error: null });
    await assert.rejects(store.heartbeat({
      jobId: JOB_ID, workerInstanceId: "worker-test-001",
      claimGeneration: 4, extendSeconds: 120
    }), (error: unknown) => error instanceof WorkerRpcStoreError &&
      error.category === "MALFORMED_RESPONSE");
  }
});

test("restricted transport rejects every unexpected function name", async () => {
  const { caller, transport } = setup();
  await assert.rejects(
    transport.call("arbitrary_function" as typeof WORKER_CLAIM_RPC, {}),
    WorkerRpcFunctionRejectedError
  );
  assert.equal(caller.calls.length, 0);
});

test("provider authorization and stale-claim errors map to safe categories", async () => {
  const unauthorized = setup();
  unauthorized.caller.responses.push({
    data: null, error: { code: "42501", message: "private SQL detail" }
  });
  await assert.rejects(unauthorized.store.claimNext("worker-test-001", 120),
    (error: unknown) => error instanceof WorkerRpcStoreError && error.category === "UNAUTHORIZED");

  const stale = setup();
  stale.caller.responses.push({
    data: null, error: { code: "55000", message: "stale or expired worker claim" }
  });
  await assert.rejects(stale.store.heartbeat({
    jobId: JOB_ID, workerInstanceId: "worker-test-001", claimGeneration: 4, extendSeconds: 120
  }), (error: unknown) => error instanceof WorkerRpcStoreError && error.category === "STALE_CLAIM");
});

test("transport failures are sanitized without credential or storage leakage", async () => {
  const { caller, store } = setup();
  caller.failure = new Error(
    "password=secret token=private bucket=private-test-bucket object=source.pdf"
  );
  await assert.rejects(store.claimNext("worker-test-001", 120), (error: unknown) => {
    assert.ok(error instanceof WorkerRpcStoreError);
    assert.equal(error.category, "UNAVAILABLE");
    assert.equal(error.message, "Worker database operation failed safely.");
    assert.doesNotMatch(String(error), /secret|token|bucket|source\.pdf/);
    return true;
  });
});

test("invalid caller inputs fail before any RPC transport call", async () => {
  const { caller, store } = setup();
  await assert.rejects(store.claimNext("short", 120), WorkerRpcStoreError);
  await assert.rejects(store.heartbeat({
    jobId: "not-a-uuid", workerInstanceId: "worker-test-001",
    claimGeneration: 4, extendSeconds: 120
  }), WorkerRpcStoreError);
  assert.equal(caller.calls.length, 0);
});

test("constructing the adapter performs no automatic connection or execution", () => {
  const { caller } = setup();
  assert.equal(caller.calls.length, 0);
});

test("the production-safe worker store remains unavailable by default", async () => {
  const store = new UnavailableWorkerJobStore();
  await assert.rejects(store.claimNext(), WorkerJobStoreUnavailableError);
  await assert.rejects(store.heartbeat(), WorkerJobStoreUnavailableError);
});
