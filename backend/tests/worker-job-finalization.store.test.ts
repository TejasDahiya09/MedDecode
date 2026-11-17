import assert from "node:assert/strict";
import test from "node:test";

import {
  UnavailableWorkerJobFinalizationStore,
  WorkerJobFinalizationError,
} from "../src/repositories/worker-job-finalization.store.js";
import type {
  WorkerJobCompletionCommand,
  WorkerJobFailureCommand,
} from "../src/types/worker-jobs.js";
import { InMemoryWorkerJobFinalizationStore } from "./support/in-memory-worker-job-finalization-store.js";

const NOW = Date.parse("2026-11-12T12:00:00.000Z");
const JOB_ID = "10000000-0000-4000-8000-000000000001";
const PRESCRIPTION_ID = "20000000-0000-4000-8000-000000000002";
const USER_ID = "30000000-0000-4000-8000-000000000003";
const WORKER = "worker-test-001";

function result(): WorkerJobCompletionCommand["result"] {
  return {
    schema_version: "1.0", job_id: JOB_ID, prescription_id: PRESCRIPTION_ID, status: "completed",
    prescription: { prescription_date: null, doctor: { name: null, registration_number: null }, facility: { name: null, address: null, phone: null } },
    patient: { name: null, age: null, gender: null }, medicines: [], recommendations: [], warnings: [],
    processing_metadata: { overall_confidence: null },
  };
}

function completion(overrides: Partial<WorkerJobCompletionCommand> = {}): WorkerJobCompletionCommand {
  return { jobId: JOB_ID, prescriptionId: PRESCRIPTION_ID, workerInstanceId: WORKER, claimGeneration: 3,
    result: result(), finalizedAt: new Date(NOW).toISOString(), ...overrides };
}

function failure(overrides: Partial<WorkerJobFailureCommand> = {}): WorkerJobFailureCommand {
  return { jobId: JOB_ID, prescriptionId: PRESCRIPTION_ID, workerInstanceId: WORKER, claimGeneration: 3,
    failure: { code: "INTELLIGENCE_TRANSPORT_FAILED", retryable: true },
    occurredAt: new Date(NOW).toISOString(), retryAt: new Date(NOW + 60_000).toISOString(), ...overrides };
}

function store(overrides: Partial<ConstructorParameters<typeof InMemoryWorkerJobFinalizationStore>[0]> = {}) {
  return new InMemoryWorkerJobFinalizationStore({
    jobId: JOB_ID, prescriptionId: PRESCRIPTION_ID, userId: USER_ID, workerInstanceId: WORKER,
    claimGeneration: 3, leaseExpiresAt: new Date(NOW + 120_000).toISOString(), attemptCount: 1,
    maxAttempts: 3, status: "processing", prescriptionStatus: "processing", ...overrides,
  }, () => NOW);
}

test("finalizes a valid Contract v1 success under the matching fence", async () => {
  const target = store();
  const outcome = await target.completeOwned(completion());
  assert.deepEqual(outcome, { jobId: JOB_ID, prescriptionId: PRESCRIPTION_ID, jobStatus: "completed", prescriptionStatus: "completed", replayed: false });
  assert.equal(target.snapshot().completion?.result.status, "completed");
});

test("accepts only identical completion replay and rejects a conflicting completion", async () => {
  const target = store();
  await target.completeOwned(completion());
  assert.equal((await target.completeOwned(completion())).replayed, true);
  const changed = completion();
  changed.result.processing_metadata.overall_confidence = 0.7;
  await assert.rejects(target.completeOwned(changed), (error: unknown) =>
    error instanceof WorkerJobFinalizationError && error.category === "CONFLICTING_FINALIZATION");
});

test("records a retryable failure with a bounded retry schedule", async () => {
  const target = store();
  const outcome = await target.failOwned(failure());
  assert.deepEqual(outcome, { jobId: JOB_ID, prescriptionId: PRESCRIPTION_ID, jobStatus: "queued", prescriptionStatus: "queued", retryEligible: true, terminal: false, availableAt: new Date(NOW + 60_000).toISOString() });
  assert.equal(target.snapshot().status, "queued");
});

test("records terminal failures for non-retryable and exhausted jobs", async () => {
  const nonRetryable = await store().failOwned(failure({ failure: { code: "INTELLIGENCE_REJECTED", retryable: false, contractCode: "PROCESSING_FAILED" }, retryAt: null }));
  assert.equal(nonRetryable.terminal, true);
  const exhausted = await store({ attemptCount: 3, maxAttempts: 3 }).failOwned(failure());
  assert.equal(exhausted.terminal, true);
  assert.equal(exhausted.retryEligible, false);
});

test("rejects stale generation, wrong worker, expired lease, and correlation mismatch", async () => {
  const mismatched = completion({ prescriptionId: USER_ID });
  mismatched.result.prescription_id = USER_ID;
  for (const [target, input, category] of [
    [store(), completion({ claimGeneration: 4 }), "STALE_CLAIM"],
    [store(), completion({ workerInstanceId: "worker-other-001" }), "WRONG_WORKER"],
    [store({ leaseExpiresAt: new Date(NOW).toISOString() }), completion(), "LEASE_EXPIRED"],
    [store(), mismatched, "CORRELATION_MISMATCH"],
  ] as const) {
    await assert.rejects(target.completeOwned(input), (error: unknown) =>
      error instanceof WorkerJobFinalizationError && error.category === category);
  }
});

test("rejects malformed IDs, invalid results, and unsafe retry commands", async () => {
  const malformed = completion({ jobId: "not-a-uuid" });
  await assert.rejects(store().completeOwned(malformed), WorkerJobFinalizationError);
  const invalid = completion();
  invalid.result.job_id = USER_ID;
  await assert.rejects(store().completeOwned(invalid), (error: unknown) =>
    error instanceof WorkerJobFinalizationError && error.category === "INVALID_RESULT");
  await assert.rejects(store().failOwned(failure({ retryAt: null })), (error: unknown) =>
    error instanceof WorkerJobFinalizationError && error.category === "INVALID_COMMAND");
});

test("finalization failures never expose result, document, or provider details", async () => {
  const unsafe = completion();
  unsafe.result.patient.name = "Synthetic private patient";
  unsafe.result.medicines.push({ unexpected: "private S3 source.pdf secret token" });
  await assert.rejects(store().completeOwned(unsafe), (error: unknown) => {
    assert.ok(error instanceof WorkerJobFinalizationError);
    assert.equal(error.message, "Worker finalization failed safely.");
    assert.doesNotMatch(String(error), /patient|source\.pdf|secret|token/i);
    return true;
  });
});

test("the finalization store is unavailable by default", async () => {
  const unavailable = new UnavailableWorkerJobFinalizationStore();
  await assert.rejects(unavailable.completeOwned(), (error: unknown) =>
    error instanceof WorkerJobFinalizationError && error.category === "UNAVAILABLE");
  await assert.rejects(unavailable.failOwned(), (error: unknown) =>
    error instanceof WorkerJobFinalizationError && error.category === "UNAVAILABLE");
});
