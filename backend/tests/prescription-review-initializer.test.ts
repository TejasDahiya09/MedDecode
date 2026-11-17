import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { validateIntelligenceResponseV1 } from "../src/services/intelligence-contract-v1.validator.js";
import { createInitialReviewFromIntelligence } from "../src/services/prescription-review-initializer.js";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const PRESCRIPTION_ID = "22222222-2222-4222-8222-222222222222";
const EVIDENCE_ID = "33333333-3333-4333-8333-333333333333";

test("maps a validated Contract v1 result into a deterministic review without changing the result", async () => {
  const source = JSON.parse(await readFile(join(process.cwd(), "tests", "fixtures", "intelligence", "response-completed-with-warnings.json"), "utf8"));
  const result = validateIntelligenceResponseV1(source, { jobId: JOB_ID, prescriptionId: PRESCRIPTION_ID });
  assert.notEqual(result.status, "failed");
  if (result.status === "failed") return;
  const before = structuredClone(result);
  const input = { result, evidenceSetId: EVIDENCE_ID, evidenceSchemaVersion: "ocr-evidence.v1", documentSha256: "a".repeat(64), now: "2026-11-15T10:00:00.000Z" };
  const first = createInitialReviewFromIntelligence(input);
  const second = createInitialReviewFromIntelligence(input);
  assert.deepEqual(first, second);
  assert.deepEqual(result, before);
  assert.equal(first.medicines.length, result.medicines.length);
  assert.equal(first.medicines[0]!.provenance.medicineName.source, "automatically_interpreted");
  assert.equal(first.medicines[0]!.provenance.medicineName.evidenceReference, null);
  assert.ok(first.unresolvedFields.some((field) => field.endsWith(".route")));
});

test("does not fabricate source coordinates, dose, route or generic identity", async () => {
  const source = JSON.parse(await readFile(join(process.cwd(), "tests", "fixtures", "intelligence", "response-success.json"), "utf8"));
  const result = validateIntelligenceResponseV1(source, { jobId: JOB_ID, prescriptionId: PRESCRIPTION_ID });
  assert.notEqual(result.status, "failed");
  if (result.status === "failed") return;
  const review = createInitialReviewFromIntelligence({ result, evidenceSetId: EVIDENCE_ID, evidenceSchemaVersion: "ocr-evidence.v1", now: "2026-11-15T10:00:00.000Z" });
  for (const medicine of review.medicines) {
    assert.equal(medicine.current.dose.value, null);
    assert.equal(medicine.current.route, null);
    assert.equal(medicine.current.genericName, null);
    for (const provenance of Object.values(medicine.provenance)) assert.equal(provenance.evidenceReference, null);
  }
});
