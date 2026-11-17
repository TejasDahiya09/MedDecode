import assert from "node:assert/strict";
import test from "node:test";
import { WorkerPriorAttemptError } from "../src/repositories/worker-job.store.js";
import { RestrictedWorkerRpcTransport, RpcWorkerJobStore } from "../src/repositories/worker-job.rpc-store.js";
import { ProcessingWorkerRuntime } from "../src/services/processing-worker.runtime.js";

test("the prior-attempt response propagates through the store and stops the worker", async () => {
  let calls = 0;
  const store = new RpcWorkerJobStore(new RestrictedWorkerRpcTransport({
    async rpc() { calls += 1; return { data: null, error: { code: "MD_PRIOR_ATTEMPT" } }; },
  }));
  await assert.rejects(store.claimNext("worker-test-001", 120), WorkerPriorAttemptError);
  calls = 0;
  const events: string[] = [];
  const runtime = new ProcessingWorkerRuntime({ enabled: true, workerInstanceId: "worker-test-001", leaseSeconds: 120,
    heartbeatIntervalMs: 30_000, pollIntervalMs: 5_000, retryInitialMs: 10, retryMaximumMs: 100 }, {
    store, beforeClaim: async () => true, exitOnEmptyClaim: true,
    handler: async () => { throw new Error("prior attempt must not process"); },
    logger: event => events.push(event.event),
  });
  await runtime.start();
  assert.equal(calls, 1);
  assert.deepEqual(events, ["worker_prior_attempt_refused"]);
});
