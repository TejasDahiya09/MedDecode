import assert from "node:assert/strict";
import test from "node:test";

import {
  RestrictedWorkerFinalizationRpcTransport,
  RpcWorkerJobFinalizationStore,
  WORKER_COMPLETE_RPC,
  WORKER_FAIL_RPC,
  WORKER_RECOVER_EXPIRED_RPC,
  WorkerFinalizationRpcFunctionRejectedError,
  type WorkerFinalizationRpcCaller,
  type WorkerFinalizationRpcResult,
} from "../src/repositories/worker-job-finalization.rpc-store.js";
import { WorkerJobFinalizationError } from "../src/repositories/worker-job-finalization.store.js";
import type { WorkerJobCompletionCommand, WorkerJobFailureCommand } from "../src/types/worker-jobs.js";

const JOB_ID = "10000000-0000-4000-8000-000000000001";
const PRESCRIPTION_ID = "20000000-0000-4000-8000-000000000002";
const WORKER = "worker-test-001";
const RETRY_AT = "2026-11-12T12:01:00.000Z";

class FakeCaller implements WorkerFinalizationRpcCaller {
  readonly calls: Array<{ name: string; parameters: Readonly<Record<string, unknown>> }> = [];
  responses: WorkerFinalizationRpcResult[] = [];
  failure: Error | null = null;

  async rpc(name: string, parameters: Readonly<Record<string, unknown>>): Promise<WorkerFinalizationRpcResult> {
    this.calls.push({ name, parameters: structuredClone(parameters) });
    if (this.failure) throw this.failure;
    return this.responses.shift() ?? { data: [], error: null };
  }
}

function result(status: "completed" | "completed_with_warnings" = "completed"): WorkerJobCompletionCommand["result"] {
  return {
    schema_version: "1.0", job_id: JOB_ID, prescription_id: PRESCRIPTION_ID, status,
    prescription: { prescription_date: null, doctor: { name: null, registration_number: null }, facility: { name: null, address: null, phone: null } },
    patient: { name: null, age: null, gender: null }, medicines: [], recommendations: [], warnings: [],
    processing_metadata: { overall_confidence: null },
  };
}

function completion(): WorkerJobCompletionCommand {
  return { jobId: JOB_ID, prescriptionId: PRESCRIPTION_ID, workerInstanceId: WORKER, claimGeneration: 2,
    result: result("completed_with_warnings"), finalizedAt: "2026-11-12T12:00:00.000Z" };
}

function failure(retryable = true): WorkerJobFailureCommand {
  return { jobId: JOB_ID, prescriptionId: PRESCRIPTION_ID, workerInstanceId: WORKER, claimGeneration: 2,
    failure: { code: "INTELLIGENCE_TRANSPORT_FAILED", retryable },
    occurredAt: "2026-11-12T12:00:00.000Z", retryAt: retryable ? RETRY_AT : null };
}

function setup(): { caller: FakeCaller; store: RpcWorkerJobFinalizationStore; transport: RestrictedWorkerFinalizationRpcTransport } {
  const caller = new FakeCaller();
  const transport = new RestrictedWorkerFinalizationRpcTransport(caller);
  return { caller, transport, store: new RpcWorkerJobFinalizationStore(transport) };
}

test("completion validates Contract v1 before using the exact fenced RPC", async () => {
  const { caller, store } = setup();
  caller.responses.push({ data: [{ job_id: JOB_ID, prescription_id: PRESCRIPTION_ID, result_status: "completed_with_warnings", replayed: false }], error: null });
  const input = completion();
  const outcome = await store.completeOwned(input);
  assert.deepEqual(outcome, { jobId: JOB_ID, prescriptionId: PRESCRIPTION_ID, jobStatus: "completed", prescriptionStatus: "completed_with_warnings", replayed: false });
  assert.deepEqual(caller.calls, [{ name: WORKER_COMPLETE_RPC, parameters: {
    p_job_id: JOB_ID, p_prescription_id: PRESCRIPTION_ID, p_worker_instance_id: WORKER,
    p_claim_generation: 2, p_result_json: input.result,
  } }]);
});

test("completion rejects invalid Contract v1 input without an RPC call", async () => {
  const { caller, store } = setup();
  const input = completion();
  input.result.prescription_id = "30000000-0000-4000-8000-000000000003";
  await assert.rejects(store.completeOwned(input), (error: unknown) =>
    error instanceof WorkerJobFinalizationError && error.category === "INVALID_RESULT");
  assert.equal(caller.calls.length, 0);
});

test("failure maps retryable and terminal responses using the exact RPC parameters", async () => {
  const retry = setup();
  retry.caller.responses.push({ data: [{ job_id: JOB_ID, prescription_id: PRESCRIPTION_ID, job_status: "queued", retry_eligible: true, terminal: false, available_at: RETRY_AT }], error: null });
  assert.equal((await retry.store.failOwned(failure())).jobStatus, "queued");
  assert.deepEqual(retry.caller.calls[0], { name: WORKER_FAIL_RPC, parameters: {
    p_job_id: JOB_ID, p_prescription_id: PRESCRIPTION_ID, p_worker_instance_id: WORKER,
    p_claim_generation: 2, p_failure_code: "INTELLIGENCE_TRANSPORT_FAILED", p_retryable: true,
    p_contract_code: null, p_retry_at: RETRY_AT,
  } });

  const terminal = setup();
  terminal.caller.responses.push({ data: [{ job_id: JOB_ID, prescription_id: PRESCRIPTION_ID, job_status: "failed", retry_eligible: false, terminal: true, available_at: null }], error: null });
  assert.equal((await terminal.store.failOwned(failure(false))).terminal, true);
});

test("recovery only accepts the bounded recovery RPC and coherent output rows", async () => {
  const { caller, store } = setup();
  caller.responses.push({ data: [
    { job_id: JOB_ID, prescription_id: PRESCRIPTION_ID, job_status: "queued", terminal: false },
    { job_id: "30000000-0000-4000-8000-000000000003", prescription_id: "40000000-0000-4000-8000-000000000004", job_status: "failed", terminal: true },
  ], error: null });
  assert.equal((await store.recoverExpired(2)).length, 2);
  assert.deepEqual(caller.calls, [{ name: WORKER_RECOVER_EXPIRED_RPC, parameters: { p_limit: 2 } }]);
  await assert.rejects(store.recoverExpired(101), WorkerJobFinalizationError);
});

test("stale, malformed, and transport responses fail safely without provider leakage", async () => {
  const stale = setup();
  stale.caller.responses.push({ data: null, error: { code: "55000", message: "stale or expired worker claim" } });
  await assert.rejects(stale.store.completeOwned(completion()), (error: unknown) =>
    error instanceof WorkerJobFinalizationError && error.category === "STALE_CLAIM");

  const staleFinalization = setup();
  staleFinalization.caller.responses.push({ data: null, error: { code: "55000", message: "stale finalization" } });
  await assert.rejects(staleFinalization.store.completeOwned(completion()), (error: unknown) =>
    error instanceof WorkerJobFinalizationError && error.category === "STALE_CLAIM");

  const malformed = setup();
  malformed.caller.responses.push({ data: [{ job_id: JOB_ID, prescription_id: PRESCRIPTION_ID, result_status: "completed", replayed: false, leak: "private" }], error: null });
  await assert.rejects(malformed.store.completeOwned(completion()), (error: unknown) =>
    error instanceof WorkerJobFinalizationError && error.category === "UNAVAILABLE");

  const unavailable = setup();
  unavailable.caller.failure = new Error("password=secret token=private");
  await assert.rejects(unavailable.store.failOwned(failure()), (error: unknown) => {
    assert.ok(error instanceof WorkerJobFinalizationError);
    assert.equal(error.category, "UNAVAILABLE");
    assert.doesNotMatch(String(error), /password|secret|token/i);
    return true;
  });
});

test("transport rejects arbitrary functions and construction performs no execution", async () => {
  const { caller, transport, store } = setup();
  assert.equal(caller.calls.length, 0);
  await assert.rejects(
    transport.call("update_ai_jobs_directly" as typeof WORKER_COMPLETE_RPC, {}),
    WorkerFinalizationRpcFunctionRejectedError
  );
  assert.equal(caller.calls.length, 0);
  assert.ok(store);
});
