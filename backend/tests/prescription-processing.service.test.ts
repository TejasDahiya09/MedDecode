import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import type { IntelligenceClient } from "../src/services/intelligence-client.js";
import { syntheticDocumentReferenceProvider } from "../src/services/document-reference.provider.js";
import {
  PrescriptionProcessingError,
  PrescriptionProcessingService,
} from "../src/services/prescription-processing.service.js";
import type {
  IntelligenceFailureV1,
  IntelligenceResponseV1,
  IntelligenceSuccessV1,
} from "../src/types/intelligence-contract-v1.js";
import type { OwnedProcessablePrescription, RequestedAnalysis } from "../src/types/intelligence-jobs.js";
import {
  InMemoryIntelligenceJobRepository,
  InMemoryIntelligenceResultPersistence,
  InMemoryPrescriptionOwnershipRepository,
} from "./support/in-memory-intelligence-adapters.js";

const userId = "10000000-0000-4000-8000-000000000001";
const otherUserId = "10000000-0000-4000-8000-000000000002";
const prescriptionId = "20000000-0000-4000-8000-000000000001";
const secondPrescriptionId = "20000000-0000-4000-8000-000000000002";
const jobIds = [
  "30000000-0000-4000-8000-000000000001",
  "30000000-0000-4000-8000-000000000002",
  "30000000-0000-4000-8000-000000000003",
];
const requestedAnalysis: RequestedAnalysis = {
  extract_prescription: true,
  match_medicines: true,
  find_alternatives: false,
  generate_recommendations: true,
};
const prescription = (id = prescriptionId, owner = userId): OwnedProcessablePrescription => ({
  id,
  userId: owner,
  fileType: "application/pdf",
  storageProvider: "aws_s3",
  storageBucket: "synthetic-private-bucket",
  objectKey: `private/prescriptions/${id}/source.pdf`,
});

const success = (jobId: string, targetPrescriptionId: string, status: "completed" | "completed_with_warnings" = "completed"): IntelligenceSuccessV1 => ({
  schema_version: "1.0",
  job_id: jobId,
  prescription_id: targetPrescriptionId,
  status,
  prescription: {
    prescription_date: null,
    doctor: { name: null, registration_number: null },
    facility: { name: null, address: null, phone: null },
  },
  patient: { name: null, age: null, gender: null },
  medicines: [],
  recommendations: [],
  warnings: status === "completed_with_warnings"
    ? [{ code: "SYNTHETIC_WARNING", severity: "low", message: "Synthetic warning.", related_medicine_sequence_number: null }]
    : [],
  processing_metadata: { overall_confidence: null },
});

const failed = (jobId: string, targetPrescriptionId: string): IntelligenceFailureV1 => ({
  schema_version: "1.0",
  job_id: jobId,
  prescription_id: targetPrescriptionId,
  status: "failed",
  error: { code: "PROCESSING_FAILED", message: "Synthetic safe failure.", retryable: false },
});

const medicine = (alternatives: readonly Record<string, unknown>[] = []): IntelligenceSuccessV1["medicines"][number] => ({
  sequence_number: 1,
  extraction: {
    raw_text: "synthetic",
    medicine_name: null,
    medicine_name_normalized: null,
    strength: { value: null, unit: null },
    dosage_form: null,
    frequency: { type: "as_needed", times_per_day: null },
    timing: null,
    duration: { value: null, unit: null },
    quantity: { value: null, unit: null },
    instructions: null,
  },
  confidence: { extraction: null },
  medicine_match: {
    status: "unmatched",
    confidence: null,
    medicine_external_id: null,
    brand_name: null,
    dosage_form: null,
    ingredients: [],
  },
  derived: { units_per_day: null, estimated_total_units: null },
  alternatives,
});

class FakeIntelligenceClient implements IntelligenceClient {
  calls = 0;
  constructor(private readonly handler: IntelligenceClient["analyze"]) {}
  async analyze(request: Parameters<IntelligenceClient["analyze"]>[0]) {
    this.calls += 1;
    return this.handler(request);
  }
}

function harness(options: {
  records?: readonly OwnedProcessablePrescription[];
  client?: FakeIntelligenceClient;
} = {}) {
  let uuidIndex = 0;
  let clockTick = 0;
  const now = () => `2026-11-11T00:00:0${clockTick++}.000Z`;
  const ownership = new InMemoryPrescriptionOwnershipRepository(options.records ?? [prescription(), prescription(secondPrescriptionId)]);
  const jobs = new InMemoryIntelligenceJobRepository({ now, uuid: () => jobIds[uuidIndex++]! });
  const results = new InMemoryIntelligenceResultPersistence(now);
  const client = options.client ?? new FakeIntelligenceClient(async (request) => success(request.job_id, request.prescription_id));
  const service = new PrescriptionProcessingService({
    prescriptions: ownership,
    jobs,
    documents: syntheticDocumentReferenceProvider,
    intelligence: client,
    results,
  });
  return { service, ownership, jobs, results, client };
}

async function submit(service: PrescriptionProcessingService, id = prescriptionId) {
  return service.submitProcessingRequest({ identity: { userId }, prescriptionId: id, requestedAnalysis });
}

test("submission requires verified identity and a valid prescription UUID", async () => {
  const { service } = harness();
  await assert.rejects(
    () => service.submitProcessingRequest({ identity: undefined, prescriptionId, requestedAnalysis }),
    (error: unknown) => error instanceof PrescriptionProcessingError && error.code === "AUTHENTICATION_REQUIRED",
  );
  await assert.rejects(
    () => service.submitProcessingRequest({ identity: { userId }, prescriptionId: "not-a-uuid", requestedAnalysis }),
    (error: unknown) => error instanceof PrescriptionProcessingError && error.code === "INVALID_PRESCRIPTION_ID",
  );
});

test("unknown and another user's prescriptions are indistinguishable", async () => {
  const { service } = harness({ records: [prescription(prescriptionId, otherUserId)] });
  for (const id of [prescriptionId, secondPrescriptionId]) {
    await assert.rejects(
      () => submit(service, id),
      (error: unknown) => error instanceof PrescriptionProcessingError && error.code === "PRESCRIPTION_NOT_FOUND",
    );
  }
});

test("submission rejects missing storage metadata and keeps alternatives disabled", async () => {
  const incomplete = { ...prescription(), objectKey: "" };
  const { service } = harness({ records: [incomplete] });
  await assert.rejects(() => submit(service), PrescriptionProcessingError);
  await assert.rejects(
    () => service.submitProcessingRequest({
      identity: { userId },
      prescriptionId,
      requestedAnalysis: { ...requestedAnalysis, find_alternatives: true } as unknown as RequestedAnalysis,
    }),
    (error: unknown) => error instanceof PrescriptionProcessingError && error.code === "INVALID_REQUESTED_ANALYSIS",
  );
});

test("submission creates one queued job and never starts the worker", async () => {
  const { service, client } = harness();
  const job = await submit(service);
  assert.equal(job.status, "queued");
  assert.equal(job.userId, userId);
  assert.equal(job.prescriptionId, prescriptionId);
  assert.equal(client.calls, 0);
});

test("duplicate and concurrent submissions return one active job", async () => {
  const { service, jobs } = harness();
  const [first, second, third] = await Promise.all([submit(service), submit(service), submit(service)]);
  assert.equal(first.id, second.id);
  assert.equal(second.id, third.id);
  assert.equal(jobs.snapshots().length, 1);
});

test("different prescriptions create distinct jobs and terminal jobs block implicit reprocessing", async () => {
  const { service } = harness();
  const first = await submit(service);
  const second = await submit(service, secondPrescriptionId);
  assert.notEqual(first.id, second.id);
  await service.executeJob(first.id);
  await assert.rejects(() => submit(service), /TERMINAL_JOB_EXISTS/);
});

test("job repository enforces claims, ownership snapshots, and terminal immutability", async () => {
  const { jobs } = harness();
  const queued = await jobs.createOrGetActive({ userId, prescriptionId, requestedAnalysis });
  const claimed = await jobs.claim(queued.id);
  assert.equal(claimed.status, "processing");
  await assert.rejects(() => jobs.claim(queued.id), /INVALID_TRANSITION/);
  assert.equal(await jobs.findOwned(queued.id, otherUserId), null);
  const completed = await jobs.complete(queued.id);
  assert.equal(completed.status, "completed");
  await assert.rejects(() => jobs.fail(queued.id, { category: "INTELLIGENCE_TRANSPORT_FAILED" }), /INVALID_TRANSITION/);
});

test("successful execution persists before marking completed", async () => {
  const { service, jobs, results } = harness();
  const queued = await submit(service);
  const completed = await service.executeJob(queued.id);
  assert.equal(completed.status, "completed");
  assert.ok(await results.findByJobId(queued.id));
  assert.equal(jobs.snapshots()[0]?.status, "completed");
});

test("completed_with_warnings remains in the stored result while job completes", async () => {
  const client = new FakeIntelligenceClient(async (request) => success(request.job_id, request.prescription_id, "completed_with_warnings"));
  const { service, results } = harness({ client });
  const job = await submit(service);
  const terminal = await service.executeJob(job.id);
  const stored = await results.findByJobId(job.id);
  assert.equal(terminal.status, "completed");
  assert.equal(stored?.response.status, "completed_with_warnings");
  assert.equal((stored?.response as IntelligenceSuccessV1).warnings[0]?.severity, "low");
});

test("valid Contract failure is persisted then mapped to a failed job", async () => {
  const client = new FakeIntelligenceClient(async (request) => failed(request.job_id, request.prescription_id));
  const { service, results } = harness({ client });
  const job = await submit(service);
  const terminal = await service.executeJob(job.id);
  assert.equal(terminal.status, "failed");
  assert.deepEqual(terminal.failure, { category: "INTELLIGENCE_REJECTED", contractCode: "PROCESSING_FAILED" });
  assert.equal((await results.findByJobId(job.id))?.response.status, "failed");
});

test("transport failures and timeouts from a fake client fail safely", async () => {
  for (const message of ["worker unavailable", "timeout at https://contract.invalid/private"]) {
    const client = new FakeIntelligenceClient(async () => { throw new Error(message); });
    const { service, jobs } = harness({ client });
    const job = await submit(service);
    await assert.rejects(
      () => service.executeJob(job.id),
      (error: unknown) => error instanceof PrescriptionProcessingError &&
        error.code === "PROCESSING_FAILED" && !error.message.includes("https://"),
    );
    assert.deepEqual(jobs.snapshots()[0]?.failure, { category: "INTELLIGENCE_TRANSPORT_FAILED" });
  }
});

test("invalid response shape and wrong correlation IDs are never persisted", async () => {
  const candidates = [
    { status: "invented" },
    success(jobIds[2]!, prescriptionId),
    success(jobIds[0]!, secondPrescriptionId),
  ];
  for (const candidate of candidates) {
    const client = new FakeIntelligenceClient(async () => candidate as IntelligenceResponseV1);
    const { service, jobs, results } = harness({ client });
    const job = await submit(service);
    await assert.rejects(() => service.executeJob(job.id), PrescriptionProcessingError);
    assert.equal(await results.findByJobId(job.id), null);
    assert.deepEqual(jobs.snapshots()[0]?.failure, { category: "INTELLIGENCE_RESPONSE_INVALID" });
  }
});

test("non-empty alternatives are rejected when alternatives were not requested", async () => {
  const alternative: Record<string, unknown> = {
    medicine_external_id: "synthetic-external-id",
    brand_name: "Synthetic alternative",
    match_basis: {
      ingredient_equivalent: true,
      strength_compatibility: true,
      dosage_form_compatibility: true,
    },
    confidence: 0.8,
  };
  const client = new FakeIntelligenceClient(async (request) => ({
    ...success(request.job_id, request.prescription_id),
    medicines: [medicine([alternative])],
  } as IntelligenceResponseV1));
  const { service, jobs, results } = harness({ client });
  const job = await submit(service);
  await assert.rejects(
    () => service.executeJob(job.id),
    (error: unknown) => error instanceof PrescriptionProcessingError &&
      error.code === "PROCESSING_FAILED" &&
      !error.message.includes("Synthetic alternative"),
  );
  assert.equal(await results.findByJobId(job.id), null);
  assert.equal(results.persistCalls, 0);
  assert.deepEqual(jobs.snapshots()[0]?.failure, { category: "INTELLIGENCE_RESPONSE_INVALID" });
});

test("empty alternatives are accepted when alternatives were not requested", async () => {
  const client = new FakeIntelligenceClient(async (request) => ({
    ...success(request.job_id, request.prescription_id),
    medicines: [medicine()],
  }));
  const { service, results } = harness({ client });
  const job = await submit(service);
  const terminal = await service.executeJob(job.id);
  const stored = await results.findByJobId(job.id);
  assert.equal(terminal.status, "completed");
  assert.equal(results.persistCalls, 1);
  assert.equal(stored?.response.status, "completed");
  assert.deepEqual((stored?.response as IntelligenceSuccessV1).medicines[0]?.alternatives, []);
});

test("invalid medicine sequence is rejected independently and never persisted", async () => {
  const client = new FakeIntelligenceClient(async (request) => ({
    ...success(request.job_id, request.prescription_id),
    medicines: [{ ...medicine(), sequence_number: 2 }],
  } as IntelligenceResponseV1));
  const { service, jobs, results } = harness({ client });
  const job = await submit(service);
  await assert.rejects(() => service.executeJob(job.id), PrescriptionProcessingError);
  assert.equal(await results.findByJobId(job.id), null);
  assert.equal(results.persistCalls, 0);
  assert.deepEqual(jobs.snapshots()[0]?.failure, { category: "INTELLIGENCE_RESPONSE_INVALID" });
});

test("persistence failure prevents completion and records only a safe category", async () => {
  const { service, jobs, results } = harness();
  results.failNext = true;
  const job = await submit(service);
  await assert.rejects(() => service.executeJob(job.id), PrescriptionProcessingError);
  assert.equal(jobs.snapshots()[0]?.status, "failed");
  assert.deepEqual(jobs.snapshots()[0]?.failure, { category: "RESULT_PERSISTENCE_FAILED" });
});

test("completion transition failure preserves the result and requires reconciliation", async () => {
  const { service, jobs, results } = harness();
  const job = await submit(service);
  jobs.failNextComplete = true;
  await assert.rejects(
    () => service.executeJob(job.id),
    (error: unknown) => error instanceof PrescriptionProcessingError &&
      error.code === "PROCESSING_FAILED" && !error.message.includes("SYNTHETIC_COMPLETE_FAILURE"),
  );
  assert.equal(jobs.snapshots()[0]?.status, "processing");
  assert.equal((await results.findByJobId(job.id))?.response.status, "completed");
  await assert.rejects(() => service.executeJob(job.id), PrescriptionProcessingError);
  assert.equal(results.persistCalls, 1);
});

test("failed-result transition failure preserves the failure envelope for reconciliation", async () => {
  const client = new FakeIntelligenceClient(async (request) => failed(request.job_id, request.prescription_id));
  const { service, jobs, results } = harness({ client });
  const job = await submit(service);
  jobs.failNextFail = true;
  await assert.rejects(
    () => service.executeJob(job.id),
    (error: unknown) => error instanceof PrescriptionProcessingError &&
      error.code === "PROCESSING_FAILED" && !error.message.includes("SYNTHETIC_FAIL_FAILURE"),
  );
  assert.equal(jobs.snapshots()[0]?.status, "processing");
  assert.equal((await results.findByJobId(job.id))?.response.status, "failed");
  assert.equal(results.persistCalls, 1);
});

test("result persistence preserves nulls/empty arrays and rejects conflicting replay", async () => {
  const { jobs, results } = harness();
  const job = await jobs.createOrGetActive({ userId, prescriptionId, requestedAnalysis });
  const response = success(job.id, prescriptionId);
  const stored = await results.persistValidated(job, response);
  assert.deepEqual(stored.response, response);
  await results.persistValidated(job, structuredClone(response));
  const conflicting = { ...success(job.id, prescriptionId), status: "completed_with_warnings" as const };
  await assert.rejects(
    () => results.persistValidated(job, conflicting),
    (error: unknown) => error instanceof Error && error.message === "Validated intelligence result persistence failed safely.",
  );
});

test("synthetic document reference is inert and contains no bucket or object key", async () => {
  const reference = await syntheticDocumentReferenceProvider.createReference(prescription());
  assert.match(reference.file_url, /^https:\/\/contract\.invalid\/prescriptions\//);
  assert.equal(reference.file_url.includes("synthetic-private-bucket"), false);
  assert.equal(reference.file_url.includes("private/prescriptions"), false);
});

test("worker execution orchestration is not registered as an Express route", async () => {
  const { readFile } = await import("node:fs/promises");
  const appSource = await readFile(join(process.cwd(), "src", "app.ts"), "utf8");
  assert.equal(appSource.includes("PrescriptionProcessingService"), false);
  assert.equal(appSource.includes("executeJob"), false);
});
