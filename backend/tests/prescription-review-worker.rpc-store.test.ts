import assert from "node:assert/strict";
import test from "node:test";

import { RpcPrescriptionReviewWorkerStore, REVIEW_COMPLETE_INITIAL_RPC } from "../src/repositories/prescription-review-worker.rpc-store.js";

const claim = {
  jobId: "10000000-0000-4000-8000-000000000001",
  prescriptionId: "20000000-0000-4000-8000-000000000002",
  userId: "30000000-0000-4000-8000-000000000003",
  attemptCount: 1,
  claimGeneration: 4,
  leaseExpiresAt: "2026-11-16T12:10:00.000Z",
  storageProvider: "aws_s3",
  storageBucket: "private",
  objectKey: "private/source.pdf",
  fileType: "application/pdf",
  inputReference: null,
} as const;

test("initial review completion uses only the exact fenced RPC parameters", async () => {
  const calls: { name: string; parameters: Readonly<Record<string, unknown>> }[] = [];
  const store = new RpcPrescriptionReviewWorkerStore({
    async rpc(name, parameters) { calls.push({ name, parameters }); return { data: [{ job_id: claim.jobId,
      prescription_id: claim.prescriptionId, job_status: "completed", review_state: 'draft' }], error: null }; },
  });
  await store.completeInitialReview({ claim, workerInstanceId: "meddecode-auto-worker-001" });
  assert.deepEqual(calls, [{
    name: REVIEW_COMPLETE_INITIAL_RPC,
    parameters: {
      p_job_id: claim.jobId,
      p_prescription_id: claim.prescriptionId,
      p_worker_instance_id: "meddecode-auto-worker-001",
      p_attempt_count: 1,
      p_claim_generation: 4,
    },
  }]);
});

test('initial completion rejects missing or malformed table responses instead of reporting success', async () => {
  for (const data of [null, [], {}, [null], [{ job_status: 'completed' }], [{ job_id: claim.jobId,
    prescription_id: claim.prescriptionId, job_status: 'failed', review_state: 'draft' }]]) {
    const store = new RpcPrescriptionReviewWorkerStore({ async rpc() { return { data, error: null }; } });
    await assert.rejects(store.completeInitialReview({ claim, workerInstanceId: 'meddecode-auto-worker-001' }), /failed safely/);
  }
});

test("initial review completion maps stale and unauthorized database failures safely", async () => {
  const stale = new RpcPrescriptionReviewWorkerStore({ async rpc() { return { data: null, error: { message: "review_stale" } }; } });
  await assert.rejects(stale.completeInitialReview({ claim, workerInstanceId: "meddecode-auto-worker-001" }), /failed safely/);
  const unauthorized = new RpcPrescriptionReviewWorkerStore({ async rpc() { return { data: null, error: { code: "42501" } }; } });
  await assert.rejects(unauthorized.completeInitialReview({ claim, workerInstanceId: "meddecode-auto-worker-001" }), /failed safely/);
});
