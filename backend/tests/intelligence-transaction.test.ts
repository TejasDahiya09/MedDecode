import assert from "node:assert/strict";
import test from "node:test";

import type { IntelligenceFailureV1, IntelligenceSuccessV1 } from "../src/types/intelligence-contract-v1.js";
import type { IntelligenceFinalizationStage } from "../src/types/intelligence-persistence.js";
import type { IntelligenceJobRecord } from "../src/types/intelligence-jobs.js";
import {
  InMemoryIntelligenceFinalizationTransaction,
  InMemoryIntelligenceTransactionError,
} from "./support/in-memory-intelligence-transaction.js";

const userId = "10000000-0000-4000-8000-000000000001";
const otherUserId = "10000000-0000-4000-8000-000000000002";
const prescriptionId = "20000000-0000-4000-8000-000000000001";
const otherPrescriptionId = "20000000-0000-4000-8000-000000000002";
const jobId = "30000000-0000-4000-8000-000000000001";
const secondJobId = "30000000-0000-4000-8000-000000000002";
const finalizedAt = "2026-11-11T12:00:00.000Z";

function job(overrides: Partial<IntelligenceJobRecord> = {}): IntelligenceJobRecord {
  return {
    id: jobId,
    userId,
    prescriptionId,
    jobType: "prescription_analysis",
    requestedAnalysis: {
      extract_prescription: true,
      match_medicines: true,
      find_alternatives: false,
      generate_recommendations: true,
    },
    status: "processing",
    createdAt: "2026-11-11T11:59:00.000Z",
    startedAt: "2026-11-11T11:59:30.000Z",
    completedAt: null,
    failure: null,
    ...overrides,
  };
}

function success(status: "completed" | "completed_with_warnings" = "completed"): IntelligenceSuccessV1 {
  return {
    schema_version: "1.0",
    job_id: jobId,
    prescription_id: prescriptionId,
    status,
    prescription: {
      prescription_date: null,
      doctor: { name: null, registration_number: null },
      facility: { name: null, address: null, phone: null },
    },
    patient: { name: null, age: null, gender: null },
    medicines: [],
    recommendations: [],
    warnings: [],
    processing_metadata: { overall_confidence: null },
  };
}

function failed(): IntelligenceFailureV1 {
  return {
    schema_version: "1.0",
    job_id: jobId,
    prescription_id: prescriptionId,
    status: "failed",
    error: { code: "PROCESSING_FAILED", message: "Synthetic failure.", retryable: false },
  };
}

function responseFor(
  targetJob: IntelligenceJobRecord,
  status: "completed" | "completed_with_warnings" | "failed" = "completed",
): IntelligenceSuccessV1 | IntelligenceFailureV1 {
  const response = status === "failed" ? failed() : success(status);
  return {
    ...response,
    job_id: targetJob.id,
    prescription_id: targetJob.prescriptionId,
  };
}

function harness(initialJob = job()) {
  const transaction = new InMemoryIntelligenceFinalizationTransaction({
    jobs: [initialJob],
    prescriptions: [
      { id: prescriptionId, userId, status: "processing" },
      { id: otherPrescriptionId, userId: otherUserId, status: "uploaded" },
    ],
  });
  const finalize = (response: IntelligenceSuccessV1 | IntelligenceFailureV1 = success(), overrides = {}) =>
    transaction.finalizeAtomically({
      expectedUserId: userId,
      prescriptionOwnerId: userId,
      job: initialJob,
      response,
      finalizedAt,
      ...overrides,
    });
  return { transaction, finalize };
}

test("atomically finalizes completed and completed-with-warnings results", async () => {
  for (const status of ["completed", "completed_with_warnings"] as const) {
    const { transaction, finalize } = harness();
    const outcome = await finalize(success(status));
    assert.equal(outcome.status, status);
    assert.equal(outcome.replayed, false);
    const snapshot = transaction.snapshot();
    assert.equal(snapshot.rawResults.length, 1);
    assert.equal(snapshot.jobs[0]?.[1].status, "completed");
    assert.equal(snapshot.prescriptions[0]?.[1].status, status);
  }
});

test("atomically finalizes a valid failed response", async () => {
  const { transaction, finalize } = harness();
  const outcome = await finalize(failed());
  assert.equal(outcome.status, "failed");
  const snapshot = transaction.snapshot();
  assert.equal(snapshot.jobs[0]?.[1].status, "failed");
  assert.equal(snapshot.rawResults[0]?.[1].error_json?.code, "PROCESSING_FAILED");
});

for (const stage of [
  "raw_result",
  "projections",
  "prescription_update",
  "job_transition",
] as const satisfies readonly IntelligenceFinalizationStage[]) {
  test(`rolls back ${stage} failure without changing committed state`, async () => {
    const { transaction, finalize } = harness();
    const before = transaction.snapshot();
    transaction.injectFailure(stage);
    await assert.rejects(
      () => finalize(),
      (error: unknown) => error instanceof InMemoryIntelligenceTransactionError &&
        error.code === "INJECTED_FAILURE",
    );
    assert.deepEqual(transaction.snapshot(), before);
  });
}

test("accepts canonical-equivalent replay and rejects conflicting replay", async () => {
  const { transaction, finalize } = harness();
  const first = success();
  await finalize(first);
  const reordered = {
    processing_metadata: first.processing_metadata,
    warnings: first.warnings,
    recommendations: first.recommendations,
    medicines: first.medicines,
    patient: first.patient,
    prescription: first.prescription,
    status: first.status,
    prescription_id: first.prescription_id,
    job_id: first.job_id,
    schema_version: first.schema_version,
  } as IntelligenceSuccessV1;
  const replay = await finalize(reordered);
  assert.equal(replay.replayed, true);

  const conflict = success("completed_with_warnings");
  await assert.rejects(
    () => finalize(conflict),
    (error: unknown) => error instanceof InMemoryIntelligenceTransactionError &&
      error.code === "CONFLICTING_REPLAY",
  );
  assert.equal(transaction.snapshot().rawResults.length, 1);
});

test("accepts an identical replay for an already completed job without rewriting state", async () => {
  const { transaction, finalize } = harness();
  const response = success();
  await finalize(response);
  const before = transaction.snapshot();
  assert.equal((await finalize(structuredClone(response))).replayed, true);
  assert.deepEqual(transaction.snapshot(), before);
});

test("accepts an identical replay for a warning-bearing result without rewriting state", async () => {
  const { transaction, finalize } = harness();
  const response = success("completed_with_warnings");
  response.warnings.push({
    code: "SYNTHETIC_CAUTION",
    severity: "medium",
    message: "Synthetic warning.",
    related_medicine_sequence_number: null,
  });
  await finalize(response);
  const before = transaction.snapshot();
  assert.equal((await finalize(structuredClone(response))).replayed, true);
  assert.deepEqual(transaction.snapshot(), before);
});

test("accepts an identical replay for a failed result without rewriting state", async () => {
  const { transaction, finalize } = harness();
  const response = failed();
  await finalize(response);
  const before = transaction.snapshot();
  assert.equal((await finalize(structuredClone(response))).replayed, true);
  assert.deepEqual(transaction.snapshot(), before);
});

test("rejects a same-job conflicting replay and preserves its committed result", async () => {
  const { transaction, finalize } = harness();
  await finalize(success());
  const before = transaction.snapshot();
  await assert.rejects(
    () => finalize(success("completed_with_warnings")),
    (error: unknown) => error instanceof InMemoryIntelligenceTransactionError &&
      error.code === "CONFLICTING_REPLAY",
  );
  assert.deepEqual(transaction.snapshot(), before);
});

function samePrescriptionJobs() {
  const firstJob = job();
  const secondJob = job({ id: secondJobId });
  const transaction = new InMemoryIntelligenceFinalizationTransaction({
    jobs: [firstJob, secondJob],
    prescriptions: [{ id: prescriptionId, userId, status: "processing" }],
  });
  const finalizeJob = (
    targetJob: IntelligenceJobRecord,
    response: IntelligenceSuccessV1 | IntelligenceFailureV1,
  ) => transaction.finalizeAtomically({
    expectedUserId: userId,
    prescriptionOwnerId: userId,
    job: targetJob,
    response,
    finalizedAt,
  });
  return { firstJob, secondJob, transaction, finalizeJob };
}

for (const firstStatus of ["completed", "completed_with_warnings", "failed"] as const) {
  test(`rejects a different job after a ${firstStatus} result for the same prescription`, async () => {
    const { firstJob, secondJob, transaction, finalizeJob } = samePrescriptionJobs();
    await finalizeJob(firstJob, responseFor(firstJob, firstStatus));
    const before = transaction.snapshot();
    await assert.rejects(
      () => finalizeJob(secondJob, responseFor(secondJob)),
      (error: unknown) => error instanceof InMemoryIntelligenceTransactionError &&
        error.code === "PRESCRIPTION_RESULT_EXISTS",
    );
    assert.deepEqual(transaction.snapshot(), before);
  });
}

test("rejects a different-job conflicting result for the same prescription", async () => {
  const { firstJob, secondJob, transaction, finalizeJob } = samePrescriptionJobs();
  await finalizeJob(firstJob, responseFor(firstJob));
  const before = transaction.snapshot();
  await assert.rejects(
    () => finalizeJob(secondJob, responseFor(secondJob, "failed")),
    (error: unknown) => error instanceof InMemoryIntelligenceTransactionError &&
      error.code === "PRESCRIPTION_RESULT_EXISTS",
  );
  assert.deepEqual(transaction.snapshot(), before);
});

test("a rejected second job preserves the first raw result and projections", async () => {
  const { firstJob, secondJob, transaction, finalizeJob } = samePrescriptionJobs();
  const first = responseFor(firstJob) as IntelligenceSuccessV1;
  first.recommendations.push({
    type: "synthetic",
    title: "Synthetic recommendation",
    message: "Synthetic message.",
    related_medicine_sequence_number: null,
    confidence: null,
  });
  await finalizeJob(firstJob, first);
  const before = transaction.snapshot();
  await assert.rejects(() => finalizeJob(secondJob, responseFor(secondJob)));
  const after = transaction.snapshot();
  assert.deepEqual(after.rawResults, before.rawResults);
  assert.deepEqual(after.projections, before.projections);
  assert.equal(after.rawResults.length, 1);
  assert.equal(after.projections.length, 1);
});

test("a rejected second job preserves the first prescription state", async () => {
  const { firstJob, secondJob, transaction, finalizeJob } = samePrescriptionJobs();
  await finalizeJob(firstJob, responseFor(firstJob, "completed_with_warnings"));
  const before = transaction.snapshot();
  await assert.rejects(() => finalizeJob(secondJob, responseFor(secondJob, "failed")));
  assert.deepEqual(transaction.snapshot().prescriptions, before.prescriptions);
  assert.equal(transaction.snapshot().prescriptions[0]?.[1].status, "completed_with_warnings");
});

test("concurrent same-prescription finalizations commit exactly one result", async () => {
  const { firstJob, secondJob, transaction, finalizeJob } = samePrescriptionJobs();
  const outcomes = await Promise.allSettled([
    finalizeJob(firstJob, responseFor(firstJob)),
    finalizeJob(secondJob, responseFor(secondJob)),
  ]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((outcome) => outcome.status === "rejected").length, 1);
  const rejected = outcomes.find((outcome) => outcome.status === "rejected");
  assert.equal(
    rejected?.status === "rejected" &&
      rejected.reason instanceof InMemoryIntelligenceTransactionError &&
      rejected.reason.code === "PRESCRIPTION_RESULT_EXISTS",
    true,
  );
  const snapshot = transaction.snapshot();
  assert.equal(snapshot.rawResults.length, 1);
  assert.equal(snapshot.projections.length, 1);
});

test("rejects another user, a mismatched prescription owner, and job reassignment", async () => {
  const { finalize } = harness();
  for (const overrides of [
    { expectedUserId: otherUserId },
    { prescriptionOwnerId: otherUserId },
    { job: job({ prescriptionId: otherPrescriptionId }) },
  ]) {
    await assert.rejects(
      () => finalize(success(), overrides),
      InMemoryIntelligenceTransactionError,
    );
  }
});

test("rejects mismatched response correlation identifiers", async () => {
  const { finalize } = harness();
  const wrongJob = { ...success(), job_id: "30000000-0000-4000-8000-000000000002" };
  const wrongPrescription = { ...success(), prescription_id: otherPrescriptionId };
  for (const response of [wrongJob, wrongPrescription]) {
    await assert.rejects(
      () => finalize(response),
      (error: unknown) => error instanceof InMemoryIntelligenceTransactionError &&
        error.code === "CORRELATION_MISMATCH",
    );
  }
});

test("prevents finalization from queued or already-terminal jobs", async () => {
  for (const status of ["queued", "completed", "failed"] as const) {
    const current = job({ status });
    const { finalize } = harness(current);
    await assert.rejects(() => finalize(), InMemoryIntelligenceTransactionError);
  }
});

test("rejects unresolved non-empty alternatives before any synthetic write", async () => {
  const { transaction, finalize } = harness();
  const response = success();
  response.medicines.push({
    sequence_number: 1,
    extraction: {
      raw_text: "Synthetic",
      frequency: { type: "unknown" },
      duration: { value: null, unit: null },
      quantity: { value: null, unit: null },
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
    alternatives: [{
      medicine_external_id: "synthetic",
      brand_name: "Synthetic",
      match_basis: {
        ingredient_equivalent: true,
        strength_compatibility: true,
        dosage_form_compatibility: true,
      },
      confidence: 0.5,
    }],
  });
  const before = transaction.snapshot();
  await assert.rejects(
    () => finalize(response),
    (error: unknown) => error instanceof InMemoryIntelligenceTransactionError &&
      error.code === "MAPPING_REJECTED",
  );
  assert.deepEqual(transaction.snapshot(), before);
});

test("result records never persist document URLs or storage metadata", async () => {
  const { transaction, finalize } = harness();
  await finalize();
  const serialized = JSON.stringify(transaction.snapshot().rawResults);
  assert.equal(serialized.includes("file_url"), false);
  assert.equal(serialized.includes("storageBucket"), false);
  assert.equal(serialized.includes("objectKey"), false);
  assert.equal(serialized.includes("private/prescriptions"), false);
});

test("snapshots are immutable, detached, and expose no unrelated domain stores", async () => {
  const { transaction, finalize } = harness();
  await finalize();
  const first = transaction.snapshot();
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.jobs[0]![1]), true);
  (first.jobs[0]![1] as { status: string }).status = "failed";
  assert.equal(first.jobs[0]![1].status, "completed");
  const second = transaction.snapshot();
  assert.equal(second.jobs[0]?.[1].status, "completed");
  assert.deepEqual(Object.keys(second).sort(), ["jobs", "prescriptions", "projections", "rawResults"]);
});
