import assert from "node:assert/strict";
import test from "node:test";

import type { WorkerJobFinalizationStore } from "../src/repositories/worker-job-finalization.store.js";
import {
  createRealPrescriptionWorkerHandler,
  RealPrescriptionProcessor,
  RealPrescriptionWorkerError,
  WorkerStageError,
} from "../src/services/real-prescription-worker.handler.js";
import { WorkerDocumentReadError, type WorkerDocumentReader } from "../src/services/worker-document.reader.js";
import type { IntelligenceClient } from "../src/services/intelligence-client.js";
import type { IntelligenceSuccessV1 } from "../src/types/intelligence-contract-v1.js";
import type { WorkerJobClaim } from "../src/types/worker-jobs.js";
import { ConfirmedReviewIntelligenceError } from "../src/services/confirmed-review-intelligence.client.js";
import { IntelligenceHttpError } from '../src/services/http-python-intelligence.client.js';
import { PrescriptionReviewWorkerRpcError } from '../src/repositories/prescription-review-worker.rpc-store.js';

const jobId = "10000000-0000-4000-8000-000000000001";
const prescriptionId = "20000000-0000-4000-8000-000000000002";
const claim: WorkerJobClaim = {
  jobId, prescriptionId, userId: "30000000-0000-4000-8000-000000000003", attemptCount: 1,
  claimGeneration: 2, leaseExpiresAt: "2026-11-12T12:05:00.000Z", storageProvider: "aws_s3",
  storageBucket: "test-private-bucket", objectKey: `private/prescriptions/${prescriptionId}/source.pdf`,
  fileType: "application/pdf", inputReference: null,
};
const success: IntelligenceSuccessV1 = {
  schema_version: "1.0", job_id: jobId, prescription_id: prescriptionId, status: "completed_with_warnings",
  prescription: { prescription_date: null, doctor: { name: null, registration_number: null }, facility: { name: null, address: null, phone: null } },
  patient: { name: null, age: null, gender: null }, medicines: [], recommendations: [], warnings: [], processing_metadata: { overall_confidence: null },
};

test('HTTP failure diagnostics retain status and stage after terminal failure without leaking payloads', async () => {
  const events: unknown[] = []; let failed = 0;
  const handler = createRealPrescriptionWorkerHandler({
    workerInstanceId: 'worker-test-001', allowRetry: false, logger: e => events.push(e),
    processor: new RealPrescriptionProcessor({ download: async () => ({ path: 'private-path', sizeBytes: 1, cleanup: async () => {} }) },
      () => ({ analyze: async () => { throw new IntelligenceHttpError(503, 'HTTP'); } })),
    finalization: { completeOwned: async () => { throw new Error('unexpected'); }, failOwned: async input => {
      failed++; assert.equal(input.failure.retryable, false); assert.equal(input.retryAt, null);
      return { jobId, prescriptionId, jobStatus: 'failed', prescriptionStatus: 'failed', retryEligible: false, terminal: true, availableAt: null };
    } },
  });
  await handler(claim, new AbortController().signal);
  assert.equal(failed, 1);
  assert.deepEqual(events, [{ level: 'error', event: 'worker_handler_failed', jobId, claimGeneration: 2,
    stage: 'python_http', category: 'INTELLIGENCE_TRANSPORT_FAILED', httpStatus: 503 }]);
  assert.doesNotMatch(JSON.stringify(events), /private-path|source\.pdf|credentials/);
});

test('review initialization failure reaches the runtime with sanitized RPC diagnostics', async () => {
  let writes = 0;
  const unexpected = async (): Promise<never> => { writes++; throw new Error('unexpected'); };
  const handler = createRealPrescriptionWorkerHandler({ workerInstanceId: 'worker-test-001',
    processor: new RealPrescriptionProcessor({ download: async () => ({ path: 'private-path', sizeBytes: 1, cleanup: async () => {} }) },
      () => ({ analyze: async () => success })),
    finalization: { completeOwned: unexpected, failOwned: unexpected },
    review: { store: {
      initializeFromOcr: async () => { throw new PrescriptionReviewWorkerRpcError('INVALID', 'meddecode_initialize_prescription_review_v1', '22P02'); },
      completeInitialReview: unexpected, loadConfirmed: unexpected, finalizeConfirmed: unexpected, failConfirmed: unexpected,
    }, intelligence: { analyzeConfirmed: unexpected } },
  });
  await assert.rejects(handler(claim, new AbortController().signal), error => error instanceof WorkerStageError &&
    error.stage === 'review_initialization' && error.rpcName === 'meddecode_initialize_prescription_review_v1' && error.sqlstate === '22P02');
  assert.equal(writes, 0);
});

test("stages an exact claimed private object, passes only its temporary path to Python, validates, and cleans it", async () => {
  let cleaned = 0; let pythonPath: string | undefined; let receivedJob: string | undefined;
  const reader: WorkerDocumentReader = { download: async received => {
    assert.equal(received.objectKey, claim.objectKey);
    return { path: "C:\\safe-temp\\source.pdf", sizeBytes: 123, cleanup: async () => { cleaned++; } };
  } };
  const processor = new RealPrescriptionProcessor(reader, path => {
    pythonPath = path;
    const client: IntelligenceClient = { analyze: async request => { receivedJob = request.job_id; return success; } };
    return client;
  });
  const result = await processor.process(claim, new AbortController().signal);
  assert.equal(result.status, "completed_with_warnings");
  assert.equal(pythonPath, "C:\\safe-temp\\source.pdf");
  assert.equal(receivedJob, jobId); assert.equal(cleaned, 1);
});

test("never produces a success result from a document or Python failure and still cleans staged data", async () => {
  const readFailure = new RealPrescriptionProcessor({
    download: async () => { throw new WorkerDocumentReadError("TOO_LARGE"); },
  }, () => ({ analyze: async () => success }));
  await assert.rejects(readFailure.process(claim, new AbortController().signal), (error: unknown) =>
    error instanceof RealPrescriptionWorkerError && error.code === "DOCUMENT_REFERENCE_FAILED");

  let cleaned = 0;
  const pythonFailure = new RealPrescriptionProcessor({
    download: async () => ({ path: "C:\\safe-temp\\source.pdf", sizeBytes: 1, cleanup: async () => { cleaned++; } }),
  }, () => ({ analyze: async () => { throw new Error("private OCR detail"); } }));
  await assert.rejects(pythonFailure.process(claim, new AbortController().signal), (error: unknown) =>
    error instanceof RealPrescriptionWorkerError && error.code === "INTELLIGENCE_TRANSPORT_FAILED");
  assert.equal(cleaned, 1);
});

test("keeps completion behind the injected fenced finalization contract", async () => {
  const finalizations: unknown[] = [];
  const finalization: WorkerJobFinalizationStore = {
    completeOwned: async input => { finalizations.push(input); return { jobId, prescriptionId, jobStatus: "completed", prescriptionStatus: "completed_with_warnings", replayed: false }; },
    failOwned: async () => { throw new Error("not used"); },
  };
  const handler = createRealPrescriptionWorkerHandler({
    processor: new RealPrescriptionProcessor({ download: async () => ({ path: "C:\\safe-temp\\source.pdf", sizeBytes: 1, cleanup: async () => undefined }) }, () => ({ analyze: async () => success })),
    finalization, workerInstanceId: "worker-test-001", now: () => new Date("2026-11-12T12:01:00.000Z"),
  });
  await handler(claim, new AbortController().signal);
  assert.deepEqual(finalizations, [{ jobId, prescriptionId, workerInstanceId: "worker-test-001", claimGeneration: 2, result: success, finalizedAt: "2026-11-12T12:01:00.000Z" }]);
});

test("lease loss during Python execution cannot write completion or failure", async () => {
  const controller = new AbortController();
  let cleaned = 0; let writes = 0;
  const processor = new RealPrescriptionProcessor({
    download: async () => ({ path: "C:\\safe-temp\\source.pdf", sizeBytes: 1, cleanup: async () => { cleaned++; } }),
  }, () => ({ analyze: async () => { controller.abort(); return success; } }));
  const finalization: WorkerJobFinalizationStore = {
    completeOwned: async () => { writes++; throw new Error("unexpected"); },
    failOwned: async () => { writes++; throw new Error("unexpected"); },
  };
  const handler = createRealPrescriptionWorkerHandler({ processor, finalization, workerInstanceId: "worker-test-001" });
  await assert.rejects(handler(claim, controller.signal));
  assert.equal(writes, 0);
  assert.equal(cleaned, 1);
});

test("JPEG and PNG claims preserve MIME type through the Python boundary", async () => {
  for (const fileType of ["image/jpeg", "image/png"] as const) {
    let invoked = false; let cleaned = false;
    const processor = new RealPrescriptionProcessor({ download: async () => ({ path: "local", sizeBytes: 1, cleanup: async () => { cleaned = true; } }) },
      () => ({ analyze: async request => { invoked = true; assert.equal(request.document.file_type, fileType); return success; } }));
    await processor.process({ ...claim, fileType }, new AbortController().signal);
    assert.equal(invoked, true); assert.equal(cleaned, true);
  }
});

test("structured retryable Python failure keeps only safe contract code and schedules retry", async () => {
  let failure: Parameters<WorkerJobFinalizationStore["failOwned"]>[0] | undefined;
  const finalization: WorkerJobFinalizationStore = {
    completeOwned: async () => { throw new Error("unexpected"); },
    failOwned: async value => { failure = value; return { jobId, prescriptionId, jobStatus: "queued", prescriptionStatus: "queued", retryEligible: true, terminal: false, availableAt: value.retryAt }; },
  };
  const processor = new RealPrescriptionProcessor({ download: async () => ({ path: "local.pdf", sizeBytes: 1, cleanup: async () => undefined }) },
    () => ({ analyze: async () => ({ schema_version: "1.0", job_id: jobId, prescription_id: prescriptionId,
      status: "failed", error: { code: "PROCESSING_FAILED", message: "sensitive diagnostic", retryable: true } }) }));
  const handler = createRealPrescriptionWorkerHandler({ processor, finalization, workerInstanceId: "worker-test-001", now: () => new Date("2026-11-12T12:00:00Z") });
  await handler(claim, new AbortController().signal);
  assert.deepEqual(failure?.failure, { code: "INTELLIGENCE_REJECTED", contractCode: "PROCESSING_FAILED", retryable: true });
  assert.equal(failure?.retryAt, "2026-11-12T12:01:00.000Z");
  assert.doesNotMatch(JSON.stringify(failure), /sensitive diagnostic/);
});

test("controlled processing failures are terminal even when Python requests a retry", async () => {
  const failures: Parameters<WorkerJobFinalizationStore["failOwned"]>[0][] = [];
  const finalization: WorkerJobFinalizationStore = {
    completeOwned: async () => { throw new Error("unexpected completion"); },
    failOwned: async value => { failures.push(value); return { jobId, prescriptionId, jobStatus: "failed", prescriptionStatus: "failed", retryEligible: false, terminal: true, availableAt: null }; },
  };
  const cases: RealPrescriptionProcessor[] = [
    new RealPrescriptionProcessor({ download: async () => { throw new WorkerDocumentReadError("UNAVAILABLE"); } }, () => ({ analyze: async () => success })),
    new RealPrescriptionProcessor({ download: async () => ({ path: "local", sizeBytes: 1, cleanup: async () => undefined }) }, () => ({ analyze: async () => { throw new Error("python unavailable"); } })),
    new RealPrescriptionProcessor({ download: async () => ({ path: "local", sizeBytes: 1, cleanup: async () => undefined }) }, () => ({ analyze: async () => ({ invalid: true } as unknown as IntelligenceSuccessV1) })),
    new RealPrescriptionProcessor({ download: async () => ({ path: "local", sizeBytes: 1, cleanup: async () => undefined }) }, () => ({ analyze: async () => ({ schema_version: "1.0", job_id: jobId, prescription_id: prescriptionId, status: "failed", error: { code: "PROCESSING_FAILED", message: "private", retryable: true } }) })),
  ];
  for (const processor of cases) {
    await createRealPrescriptionWorkerHandler({ processor, finalization, workerInstanceId: "worker-test-001", allowRetry: false })(claim, new AbortController().signal);
  }
  assert.equal(failures.length, cases.length);
  for (const failure of failures) { assert.equal(failure.failure.retryable, false); assert.equal(failure.retryAt, null); }
});

test("initial V3 processing initializes the draft then completes only the initial review job", async () => {
  const order: string[] = [];
  const finalization: WorkerJobFinalizationStore = {
    completeOwned: async () => { throw new Error("legacy result completion must not run"); },
    failOwned: async () => { throw new Error("unexpected"); },
  };
  const handler = createRealPrescriptionWorkerHandler({
    processor: new RealPrescriptionProcessor({ download: async () => ({ path: "local", sizeBytes: 1, cleanup: async () => undefined }) }, () => ({ analyze: async () => success })),
    finalization, workerInstanceId: "worker-test-001",
    review: {
      store: {
        async initializeFromOcr() { order.push("initialize"); return {} as never; },
        async completeInitialReview() { order.push("complete-initial-review"); },
        async loadConfirmed() { throw new Error("unexpected"); },
        async finalizeConfirmed() { throw new Error("unexpected"); },
        async failConfirmed() { throw new Error("unexpected"); },
      },
      intelligence: { async analyzeConfirmed() { throw new Error("unexpected"); } },
    },
  });
  await handler(claim, new AbortController().signal);
  assert.deepEqual(order, ["initialize", "complete-initial-review"]);
});

test("confirmed revision jobs skip OCR and use only revision-bound finalization", async () => {
  let documentReads = 0; let legacyWrites = 0; let finalized = 0;
  const reviewClaim: WorkerJobClaim = { ...claim, inputReference: {
    processing_mode: "confirmed_review",
    review_revision_id: "40000000-0000-4000-8000-000000000004",
    review_input_fingerprint: "a".repeat(64),
  } };
  const handler = createRealPrescriptionWorkerHandler({
    processor: new RealPrescriptionProcessor({ download: async () => { documentReads++; throw new Error("unexpected"); } }, () => ({ analyze: async () => success })),
    finalization: {
      completeOwned: async () => { legacyWrites++; throw new Error("unexpected"); },
      failOwned: async () => { legacyWrites++; throw new Error("unexpected"); },
    },
    workerInstanceId: "worker-test-001",
    review: {
      store: {
        async initializeFromOcr() { throw new Error("unexpected"); },
        async completeInitialReview() { throw new Error("unexpected"); },
        async loadConfirmed(input) { assert.equal(input.binding.inputFingerprint, "a".repeat(64)); return {} as never; },
        async finalizeConfirmed(input) { assert.equal(input.binding.revisionId, "40000000-0000-4000-8000-000000000004"); finalized++; },
        async failConfirmed() { throw new Error("unexpected"); },
      },
      intelligence: { async analyzeConfirmed() { return success; } },
    },
  });
  await handler(reviewClaim, new AbortController().signal);
  assert.equal(documentReads, 0); assert.equal(legacyWrites, 0); assert.equal(finalized, 1);
});

test("a confirmed revision failure uses the fenced revision failure path and never legacy prescription failure", async () => {
  let legacyWrites = 0; let failed = 0;
  const reviewClaim: WorkerJobClaim = { ...claim, inputReference: {
    processing_mode: "confirmed_review",
    review_revision_id: "40000000-0000-4000-8000-000000000004",
    review_input_fingerprint: "b".repeat(64),
  } };
  const handler = createRealPrescriptionWorkerHandler({
    processor: new RealPrescriptionProcessor({ download: async () => { throw new Error("unexpected"); } }, () => ({ analyze: async () => success })),
    finalization: {
      completeOwned: async () => { legacyWrites++; throw new Error("unexpected"); },
      failOwned: async () => { legacyWrites++; throw new Error("unexpected"); },
    },
    workerInstanceId: "worker-test-001",
    review: {
      store: {
        async initializeFromOcr() { throw new Error("unexpected"); },
        async completeInitialReview() { throw new Error("unexpected"); },
        async loadConfirmed() { return {} as never; },
        async finalizeConfirmed() { throw new Error("unexpected"); },
        async failConfirmed(input) {
          assert.equal(input.binding.revisionId, "40000000-0000-4000-8000-000000000004");
          assert.equal(input.failureCode, "INTELLIGENCE_REJECTED");
          failed++;
        },
      },
      intelligence: { async analyzeConfirmed() { throw new ConfirmedReviewIntelligenceError("PROCESSING_FAILED"); } },
    },
  });
  await handler(reviewClaim, new AbortController().signal);
  assert.equal(failed, 1);
  assert.equal(legacyWrites, 0);
});
