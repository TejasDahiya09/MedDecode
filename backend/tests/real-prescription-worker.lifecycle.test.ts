import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { Readable } from "node:stream";
import test from "node:test";

import type { WorkerJobStore } from "../src/repositories/worker-job.store.js";
import { createS3WorkerDocumentReader, WorkerDocumentReadError } from "../src/services/worker-document.reader.js";
import {
  createRealPrescriptionWorkerHandler,
  RealPrescriptionProcessor,
} from "../src/services/real-prescription-worker.handler.js";
import { ProcessingWorkerRuntime, type WorkerRuntimeDependencies } from "../src/services/processing-worker.runtime.js";
import type { IntelligenceClient } from "../src/services/intelligence-client.js";
import type { IntelligenceSuccessV1 } from "../src/types/intelligence-contract-v1.js";
import type { WorkerHeartbeat, WorkerJobClaim } from "../src/types/worker-jobs.js";
import { InMemoryWorkerJobFinalizationStore } from "./support/in-memory-worker-job-finalization-store.js";

const NOW = Date.parse("2026-11-12T12:00:00.000Z");
const jobId = "10000000-0000-4000-8000-000000000041";
const prescriptionId = "20000000-0000-4000-8000-000000000042";
const workerId = "worker-local-lifecycle-001";
const fixturePath = "C:\\Users\\dahiy\\MedDecode-Test-Fixtures\\synthetic-prescription-001.pdf";

const claim = (): WorkerJobClaim => ({
  jobId, prescriptionId, userId: "30000000-0000-4000-8000-000000000043", attemptCount: 1,
  claimGeneration: 1, leaseExpiresAt: new Date(NOW + 120_000).toISOString(),
  storageProvider: "aws_s3", storageBucket: "fixture-private-bucket",
  objectKey: `private/prescriptions/${prescriptionId}/source.pdf`, fileType: "application/pdf", inputReference: null,
});
const result = (): IntelligenceSuccessV1 => ({
  schema_version: "1.0", job_id: jobId, prescription_id: prescriptionId, status: "completed_with_warnings",
  prescription: { prescription_date: null, doctor: { name: null, registration_number: null }, facility: { name: null, address: null, phone: null } },
  patient: { name: null, age: null, gender: null },
  medicines: [{ sequence_number: 1, extraction: { raw_text: "Examplemed 10 mg", medicine_name: "Examplemed", frequency: { type: "unknown" }, duration: { value: null, unit: null }, quantity: { value: null, unit: null } }, confidence: {}, medicine_match: { status: "matched", confidence: 1, medicine_external_id: null, brand_name: "Examplemed", dosage_form: "tablet", ingredients: [] }, derived: { units_per_day: null, estimated_total_units: null }, alternatives: [] }],
  recommendations: [], warnings: [{ code: "DEVELOPMENT_FIXTURE_INJECTED_OCR", severity: "info", message: "Local lifecycle fixture used injected OCR; no genuine OCR was performed.", related_medicine_sequence_number: null }], processing_metadata: { overall_confidence: null },
});

class OneClaimStore implements WorkerJobStore {
  private available = true;
  async claimNext(): Promise<WorkerJobClaim | null> { if (!this.available) return null; this.available = false; return claim(); }
  async heartbeat(): Promise<WorkerHeartbeat> { return { jobId, claimGeneration: 1, leaseExpiresAt: new Date(NOW + 180_000).toISOString() }; }
}

function finalization(maxAttempts = 2) {
  return new InMemoryWorkerJobFinalizationStore({ jobId, prescriptionId, userId: claim().userId,
    workerInstanceId: workerId, claimGeneration: 1, leaseExpiresAt: claim().leaseExpiresAt,
    attemptCount: 1, maxAttempts, status: "processing", prescriptionStatus: "processing" }, () => NOW);
}

function fixtureReader() {
  const bytes = readFileSync(fixturePath);
  assert.equal(bytes.subarray(0, 5).toString("ascii"), "%PDF-");
  return createS3WorkerDocumentReader({ region: "local-test", bucket: "fixture-private-bucket", client: {
    send: async () => ({ Body: Readable.from([bytes]) }),
  } });
}

function runtime(handler: WorkerRuntimeDependencies["handler"]) {
  return new ProcessingWorkerRuntime({ enabled: true, workerInstanceId: workerId, leaseSeconds: 120,
    heartbeatIntervalMs: 30_000, pollIntervalMs: 5_000, retryInitialMs: 10, retryMaximumMs: 10 },
  { store: new OneClaimStore(), handler, now: () => NOW });
}

test("runs the injected local lifecycle from claimed fictional S3 object through validated fixture output and fenced completion", async () => {
  const finalized = finalization();
  let stagedPath: string | undefined;
  const processor = new RealPrescriptionProcessor(fixtureReader(), path => {
    stagedPath = path;
    const client: IntelligenceClient = { analyze: async request => {
      assert.equal(existsSync(path), true);
      assert.equal(request.job_id, jobId); assert.equal(request.prescription_id, prescriptionId);
      return result();
    } };
    return client;
  });
  await runtime(createRealPrescriptionWorkerHandler({ processor, finalization: finalized, workerInstanceId: workerId, now: () => new Date(NOW) })).start();
  const snapshot = finalized.snapshot();
  assert.equal(snapshot.status, "completed");
  assert.equal(snapshot.prescriptionStatus, "completed_with_warnings");
  assert.equal(snapshot.completion?.result.warnings[0]?.code, "DEVELOPMENT_FIXTURE_INJECTED_OCR");
  assert.equal(existsSync(stagedPath ?? ""), false);
});

test("records a controlled document-retrieval failure through the same fenced failure contract", async () => {
  const finalized = finalization();
  const processor = new RealPrescriptionProcessor({ download: async () => { throw new WorkerDocumentReadError("UNAVAILABLE"); } }, () => ({ analyze: async () => result() }));
  await runtime(createRealPrescriptionWorkerHandler({ processor, finalization: finalized, workerInstanceId: workerId, now: () => new Date(NOW), retryDelayMs: 60_000 })).start();
  const snapshot = finalized.snapshot();
  assert.equal(snapshot.status, "queued");
  assert.equal(snapshot.prescriptionStatus, "queued");
  assert.equal(snapshot.failure?.code, "DOCUMENT_REFERENCE_FAILED");
  assert.equal(snapshot.availableAt, new Date(NOW + 60_000).toISOString());
  assert.doesNotMatch(JSON.stringify(snapshot), /S3 failure|source\.pdf/i);
});
