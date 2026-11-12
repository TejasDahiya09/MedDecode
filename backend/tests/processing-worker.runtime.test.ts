import assert from "node:assert/strict";
import test from "node:test";

import type { WorkerJobStore } from "../src/repositories/worker-job.store.js";
import {
  parseWorkerRuntimeConfig,
  ProcessingWorkerRuntime
} from "../src/services/processing-worker.runtime.js";
import type {
  WorkerHeartbeat,
  WorkerJobClaim,
  WorkerRuntimeConfig
} from "../src/types/worker-jobs.js";

const NOW = Date.parse("2026-11-12T12:00:00.000Z");
const claim = (overrides: Partial<WorkerJobClaim> = {}): WorkerJobClaim => ({
  jobId: "10000000-0000-4000-8000-000000000001",
  userId: "20000000-0000-4000-8000-000000000002",
  prescriptionId: "30000000-0000-4000-8000-000000000003",
  attemptCount: 1,
  claimGeneration: 1,
  leaseExpiresAt: new Date(NOW + 120_000).toISOString(),
  storageProvider: "aws_s3",
  storageBucket: "private-test-bucket",
  objectKey: "private/prescriptions/synthetic/source.pdf",
  fileType: "application/pdf",
  inputReference: null,
  ...overrides
});

const config = (overrides: Partial<WorkerRuntimeConfig> = {}): WorkerRuntimeConfig => ({
  enabled: true,
  workerInstanceId: "worker-test-001",
  leaseSeconds: 120,
  heartbeatIntervalMs: 30_000,
  pollIntervalMs: 5_000,
  retryInitialMs: 100,
  retryMaximumMs: 400,
  ...overrides
});

class FakeWorkerStore implements WorkerJobStore {
  claims: Array<WorkerJobClaim | null | Error> = [];
  claimCalls = 0;
  heartbeatCalls: Array<Parameters<WorkerJobStore["heartbeat"]>[0]> = [];
  heartbeatResult: WorkerHeartbeat | Error = {
    jobId: claim().jobId,
    claimGeneration: 1,
    leaseExpiresAt: new Date(NOW + 240_000).toISOString()
  };
  onHeartbeat?: () => void;

  async claimNext(): Promise<WorkerJobClaim | null> {
    this.claimCalls += 1;
    const value = this.claims.shift() ?? null;
    if (value instanceof Error) throw value;
    return value;
  }

  async heartbeat(input: Parameters<WorkerJobStore["heartbeat"]>[0]): Promise<WorkerHeartbeat> {
    this.heartbeatCalls.push(input);
    this.onHeartbeat?.();
    if (this.heartbeatResult instanceof Error) throw this.heartbeatResult;
    return this.heartbeatResult;
  }
}

const deferred = (): { promise: Promise<void>; resolve: () => void } => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

test("claims one fake job and invokes only the injected handler", async () => {
  const store = new FakeWorkerStore();
  const owned = claim();
  store.claims.push(owned);
  const handled: WorkerJobClaim[] = [];
  const runtime = new ProcessingWorkerRuntime(config(), {
    store, now: () => NOW,
    handler: async (value) => { handled.push(value); }
  });
  await runtime.start();
  assert.deepEqual(handled, [owned]);
  assert.equal(store.claimCalls, 1);
  assert.equal(store.heartbeatCalls.length, 0);
});

test("polls safely when no queued job exists", async () => {
  const store = new FakeWorkerStore();
  let runtime!: ProcessingWorkerRuntime;
  const waits: number[] = [];
  runtime = new ProcessingWorkerRuntime(config(), {
    store, handler: async () => undefined,
    wait: async (delay) => { waits.push(delay); void runtime.stop(); }
  });
  await runtime.start();
  assert.deepEqual(waits, [5_000]);
  assert.equal(store.claimCalls, 1);
});

test("retries claim-store failures with bounded exponential backoff", async () => {
  const store = new FakeWorkerStore();
  store.claims.push(new Error("private provider detail"), new Error("again"), new Error("again"));
  const delays: number[] = [];
  let runtime!: ProcessingWorkerRuntime;
  runtime = new ProcessingWorkerRuntime(config(), {
    store, handler: async () => undefined,
    wait: async (delay) => {
      delays.push(delay);
      if (delays.length === 3) void runtime.stop();
    }
  });
  await runtime.start();
  assert.deepEqual(delays, [100, 200, 400]);
});

test("heartbeats an owned claim while its injected handler is running", async () => {
  const store = new FakeWorkerStore();
  store.claims.push(claim());
  const handling = deferred();
  store.onHeartbeat = handling.resolve;
  const runtime = new ProcessingWorkerRuntime(config(), {
    store, now: () => NOW, wait: async () => undefined,
    handler: async () => handling.promise
  });
  await runtime.start();
  assert.equal(store.heartbeatCalls.length, 1);
  assert.equal(store.heartbeatCalls[0]?.claimGeneration, 1);
  assert.equal(store.heartbeatCalls[0]?.workerInstanceId, "worker-test-001");
});

test("aborts the handler and logs safely when heartbeat fails", async () => {
  const store = new FakeWorkerStore();
  store.claims.push(claim());
  store.heartbeatResult = new Error("database secret detail");
  const events: unknown[] = [];
  const runtime = new ProcessingWorkerRuntime(config(), {
    store, now: () => NOW, wait: async () => undefined,
    logger: (event) => events.push(event),
    handler: async (_claim, signal) => new Promise<void>((resolve) =>
      signal.addEventListener("abort", () => resolve(), { once: true }))
  });
  await runtime.start();
  assert.equal(store.heartbeatCalls.length, 1);
  assert.match(JSON.stringify(events), /worker_heartbeat_failed/);
  assert.doesNotMatch(JSON.stringify(events), /database secret|private-test-bucket|source\.pdf/);
});

test("rejects a stale heartbeat generation", async () => {
  const store = new FakeWorkerStore();
  store.claims.push(claim());
  store.heartbeatResult = { ...store.heartbeatResult as WorkerHeartbeat, claimGeneration: 2 };
  const events: unknown[] = [];
  const runtime = new ProcessingWorkerRuntime(config(), {
    store, now: () => NOW, wait: async () => undefined,
    logger: (event) => events.push(event),
    handler: async (_claim, signal) => new Promise<void>((resolve) =>
      signal.addEventListener("abort", () => resolve(), { once: true }))
  });
  await runtime.start();
  assert.match(JSON.stringify(events), /worker_claim_lost/);
});

test("rejects an expired lease before sending a heartbeat", async () => {
  const store = new FakeWorkerStore();
  store.claims.push(claim({ leaseExpiresAt: new Date(NOW + 1).toISOString() }));
  let now = NOW;
  const runtime = new ProcessingWorkerRuntime(config(), {
    store, now: () => now,
    wait: async () => { now += 2; },
    handler: async (_claim, signal) => new Promise<void>((resolve) =>
      signal.addEventListener("abort", () => resolve(), { once: true }))
  });
  await runtime.start();
  assert.equal(store.heartbeatCalls.length, 0);
});

test("graceful shutdown aborts an idle wait", async () => {
  const store = new FakeWorkerStore();
  const runtime = new ProcessingWorkerRuntime(config(), {
    store, handler: async () => undefined
  });
  const running = runtime.start();
  await new Promise<void>((resolve) => setImmediate(resolve));
  await runtime.stop();
  await running;
  assert.equal(store.claimCalls, 1);
});

test("start is idempotent and does not create duplicate worker loops", async () => {
  const store = new FakeWorkerStore();
  store.claims.push(claim());
  const handling = deferred();
  const runtime = new ProcessingWorkerRuntime(config(), {
    store, handler: async () => handling.promise
  });
  const first = runtime.start();
  const second = runtime.start();
  assert.equal(first, second);
  handling.resolve();
  await first;
  assert.equal(store.claimCalls, 1);
});

test("configuration is disabled by default and validates lease timing", () => {
  const defaults = parseWorkerRuntimeConfig({});
  assert.equal(defaults.enabled, false);
  assert.equal(defaults.workerInstanceId, "");
  assert.throws(() => parseWorkerRuntimeConfig({ PROCESSING_WORKER_ENABLED: "true" }),
    /INSTANCE_ID/);
  assert.throws(() => parseWorkerRuntimeConfig({
    PROCESSING_WORKER_ENABLED: "true",
    PROCESSING_WORKER_INSTANCE_ID: "worker-test-001",
    PROCESSING_WORKER_LEASE_SECONDS: "30",
    PROCESSING_WORKER_HEARTBEAT_INTERVAL_MS: "30000"
  }), /shorter than the lease/);
});
