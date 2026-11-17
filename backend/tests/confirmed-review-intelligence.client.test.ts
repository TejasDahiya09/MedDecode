import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { confirmReview, editMedicineFields, removeMedicine } from "../src/domain/prescription-review/index.js";
import { LocalConfirmedReviewIntelligenceClient, ConfirmedReviewIntelligenceError } from "../src/services/confirmed-review-intelligence.client.js";
import { validateIntelligenceResponseV1 } from "../src/services/intelligence-contract-v1.validator.js";
import { createInitialReviewFromIntelligence } from "../src/services/prescription-review-initializer.js";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const PRESCRIPTION_ID = "22222222-2222-4222-8222-222222222222";
const FIXTURE_DIRECTORY = join(__dirname, "fixtures", "intelligence");
const INTELLIGENCE_DIRECTORY = join(__dirname, "..", "..", "intelligence");

async function confirmedReview() {
  const source = JSON.parse(await readFile(join(FIXTURE_DIRECTORY, "response-completed-with-warnings.json"), "utf8"));
  const result = validateIntelligenceResponseV1(source, { jobId: JOB_ID, prescriptionId: PRESCRIPTION_ID });
  assert.notEqual(result.status, "failed");
  if (result.status === "failed") throw new Error("invalid fixture");
  let review = createInitialReviewFromIntelligence({
    result, evidenceSetId: "33333333-3333-4333-8333-333333333333",
    evidenceSchemaVersion: "ocr-evidence.v1", now: "2026-11-15T10:00:00Z",
  });
  review = editMedicineFields(review, {
    expectedLockVersion: review.lockVersion, medicineId: review.medicines[0]!.medicineId,
    updates: { medicineName: "Paracetamol", strengthValue: "500", strengthUnit: "mg" }, now: "2026-11-15T10:01:00Z",
  });
  review = removeMedicine(review, {
    expectedLockVersion: review.lockVersion, medicineId: review.medicines[1]!.medicineId, now: "2026-11-15T10:02:00Z",
  });
  return confirmReview(review, { expectedLockVersion: review.lockVersion, idempotencyKey: "confirm-1", now: "2026-11-15T10:03:00Z" });
}

test("confirmed intelligence sends only active canonical fields and preserves the fingerprint", async () => {
  const review = await confirmedReview();
  let privateRequest: Record<string, unknown> | undefined;
  const client = new LocalConfirmedReviewIntelligenceClient({
    pythonExecutable: "python", intelligenceDirectory: "intelligence",
    run: async (options) => {
      privateRequest = JSON.parse(options.input) as Record<string, unknown>;
      return JSON.stringify({
        schema_version: "1.0", job_id: JOB_ID, prescription_id: PRESCRIPTION_ID,
        status: "completed_with_warnings",
        prescription: { prescription_date: null, doctor: { name: null, registration_number: null }, facility: { name: null, address: null, phone: null } },
        patient: { name: null, age: null, gender: null }, medicines: [], recommendations: [], warnings: [],
        processing_metadata: { overall_confidence: null },
      });
    },
  });
  await client.analyzeConfirmed({ jobId: JOB_ID, prescriptionId: PRESCRIPTION_ID, review });
  assert.equal(privateRequest?.schema_version, "meddecode.confirmed-review-intelligence.v1");
  assert.equal(privateRequest?.input_fingerprint, review.canonicalInputFingerprint?.value);
  const medicines = privateRequest?.medicines as Array<{ fields: Record<string, unknown> }>;
  assert.equal(medicines.length, 1);
  assert.equal(medicines[0]!.fields.medicineName, "Paracetamol");
  assert.deepEqual(medicines[0]!.fields.strength, { value: "500", unit: "mg" });
});

test("confirmed intelligence rejects drafts and tampered fingerprints before Python", async () => {
  const confirmed = await confirmedReview();
  let calls = 0;
  const client = new LocalConfirmedReviewIntelligenceClient({
    pythonExecutable: "python", intelligenceDirectory: "intelligence", run: async () => { calls += 1; return "{}"; },
  });
  const tampered = structuredClone(confirmed);
  (tampered.medicines[0]!.current as unknown as { medicineName: string | null }).medicineName = "Tampered";
  await assert.rejects(client.analyzeConfirmed({ jobId: JOB_ID, prescriptionId: PRESCRIPTION_ID, review: tampered }),
    (error: unknown) => error instanceof ConfirmedReviewIntelligenceError && error.code === "STALE_FINGERPRINT");
  assert.equal(calls, 0);
});

test("runs the real confirmed-review Python adapter through Layers 4-5", async () => {
  const review = await confirmedReview();
  const client = new LocalConfirmedReviewIntelligenceClient({
    pythonExecutable: join(INTELLIGENCE_DIRECTORY, ".venv", "Scripts", "python.exe"),
    intelligenceDirectory: INTELLIGENCE_DIRECTORY,
    timeoutMs: 30_000,
  });
  const result = await client.analyzeConfirmed({ jobId: JOB_ID, prescriptionId: PRESCRIPTION_ID, review });
  assert.equal(result.medicines.length, 1);
  const medicine = result.medicines[0] as { extraction: { medicine_name: string; strength: { value: number; unit: string } } };
  assert.equal(medicine.extraction.medicine_name, "Paracetamol");
  assert.deepEqual(medicine.extraction.strength, { value: 500, unit: "mg" });
  assert.ok(result.warnings.some((warning) => warning.code === "USER_CONFIRMED_TRANSCRIPTION"));
});
