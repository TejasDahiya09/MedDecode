import assert from "node:assert/strict";
import test from "node:test";

import type { WorkerJobFinalizationStore } from "../src/repositories/worker-job-finalization.store.js";
import {
  createRealPrescriptionWorkerHandler,
  RealPrescriptionProcessor,
  RealPrescriptionWorkerError,
} from "../src/services/real-prescription-worker.handler.js";
import { WorkerDocumentReadError, type WorkerDocumentReader } from "../src/services/worker-document.reader.js";
import type { IntelligenceClient } from "../src/services/intelligence-client.js";
import type { IntelligenceSuccessV1 } from "../src/types/intelligence-contract-v1.js";
import type { WorkerJobClaim } from "../src/types/worker-jobs.js";

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
