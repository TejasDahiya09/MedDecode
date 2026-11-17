import assert from "node:assert/strict";
import test from "node:test";

import {
  PrescriptionReviewError,
  addMedicine,
  canonicalizeReviewInput,
  confirmReview,
  createDraftFromConfirmed,
  createInitialReviewDraft,
  createReviewFingerprint,
  determineIntelligenceInvalidation,
  editMedicineField,
  editMedicineFields,
  removeMedicine,
  reorderMedicines,
  restoreMedicine,
  restoreOriginalMedicineValues,
  saveReviewDraft,
  validatePrescriptionReviewContractV1,
  type PrescriptionReviewContractV1,
  type ReviewEditableField,
  type ReviewMedicineFieldsV1,
} from "../src/domain/prescription-review/index.js";

const PRESCRIPTION_ID = "10000000-0000-4000-8000-000000000001";
const EVIDENCE_ID = "20000000-0000-4000-8000-000000000002";
const REVISION_ID = "30000000-0000-4000-8000-000000000003";
const MEDICINE_A = "40000000-0000-4000-8000-000000000004";
const MEDICINE_B = "50000000-0000-4000-8000-000000000005";
const MEDICINE_C = "60000000-0000-4000-8000-000000000006";
const NEXT_REVISION_ID = "70000000-0000-4000-8000-000000000007";
const NOW = "2026-11-15T10:00:00.000Z";

const fields = (name = "Examplemed"): ReviewMedicineFieldsV1 => ({
  medicineName: name,
  brandName: null,
  genericName: null,
  strength: { value: "500", unit: "mg" },
  dosageForm: "tablet",
  dose: { value: "1", unit: "tablet" },
  frequency: "twice daily",
  timing: "after food",
  route: "oral",
  duration: { value: "5", unit: "days" },
  quantity: { value: "10", unit: "tablets" },
  notes: null,
});

function draft(): PrescriptionReviewContractV1 {
  return createInitialReviewDraft({
    prescriptionId: PRESCRIPTION_ID,
    revisionId: REVISION_ID,
    evidence: { evidenceSetId: EVIDENCE_ID, schemaVersion: "ocr-evidence.v1", documentSha256: "a".repeat(64) },
    medicines: [
      { medicineId: MEDICINE_A, fields: fields() },
      { medicineId: MEDICINE_B, fields: fields("Secondmed") },
    ],
    now: NOW,
  });
}

function errorCode(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => error instanceof PrescriptionReviewError && error.code === code);
}

test("creates a validated immutable initial draft and preserves OCR originals", () => {
  const review = draft();
  assert.equal(review.schemaVersion, "1.0");
  assert.equal(review.status, "draft");
  assert.equal(review.medicines[0]!.original?.medicineName, "Examplemed");
  assert.equal(review.medicines[0]!.provenance.medicineName.source, "ocr_observed");
  assert.ok(Object.isFrozen(review));
  assert.ok(Object.isFrozen(review.medicines[0]!.current));
});

test("edits every supported field while retaining original OCR values", () => {
  const values: Record<ReviewEditableField, string | null> = {
    medicineName: "Correctedmed", brandName: "Corrected Brand", genericName: "Corrected Generic",
    strengthValue: "250", strengthUnit: "mg", dosageForm: "capsule", doseValue: "2", doseUnit: "capsules",
    frequency: "once daily", timing: "before food", route: "oral", durationValue: "7", durationUnit: "days",
    quantityValue: "14", quantityUnit: "capsules", notes: "Fictional transcription note",
  };
  let review = draft();
  for (const [field, value] of Object.entries(values) as [ReviewEditableField, string | null][]) {
    review = editMedicineField(review, { expectedLockVersion: review.lockVersion, medicineId: MEDICINE_A, field, value, now: NOW });
    assert.equal(review.medicines[0]!.provenance[field].source, "user_corrected");
  }
  assert.equal(review.medicines[0]!.current.medicineName, "Correctedmed");
  assert.equal(review.medicines[0]!.current.strength.value, "250");
  assert.equal(review.medicines[0]!.original?.medicineName, "Examplemed");
  assert.equal(review.medicines[0]!.original?.strength.value, "500");
});

test("supports atomic paired-field edits and unresolved values without inventing data", () => {
  const review = editMedicineFields(draft(), {
    expectedLockVersion: 0,
    medicineId: MEDICINE_A,
    updates: { strengthValue: null, strengthUnit: null, timing: null },
    now: NOW,
  });
  assert.equal(review.medicines[0]!.current.strength.value, null);
  assert.equal(review.medicines[0]!.provenance.strengthValue.source, "unresolved");
  assert.ok(review.unresolvedFields.includes(`medicines.${MEDICINE_A}.timing`));
});

test("adds a medicine idempotently and rejects command or identifier conflicts", () => {
  const added = addMedicine(draft(), { expectedLockVersion: 0, commandId: "add-1", medicineId: MEDICINE_C, fields: fields("Missingmed"), now: NOW });
  assert.equal(added.medicines.length, 3);
  assert.equal(added.medicines[2]!.origin, "user_added");
  assert.equal(addMedicine(added, { expectedLockVersion: 0, commandId: "add-1", medicineId: MEDICINE_C, fields: fields("Missingmed"), now: NOW }), added);
  errorCode(() => addMedicine(added, { expectedLockVersion: added.lockVersion, commandId: "add-1", medicineId: "80000000-0000-4000-8000-000000000008", fields: fields(), now: NOW }), "REVIEW_COMMAND_CONFLICT");
  errorCode(() => addMedicine(draft(), { expectedLockVersion: 0, commandId: "add-2", medicineId: MEDICINE_A, fields: fields(), now: NOW }), "REVIEW_DUPLICATE_MEDICINE");
});

test("removes and restores a tombstoned medicine without deleting history", () => {
  const removed = removeMedicine(draft(), { expectedLockVersion: 0, medicineId: MEDICINE_A, now: NOW });
  assert.equal(removed.medicines[0]!.status, "removed");
  assert.equal(removed.medicines.length, 2);
  const restored = restoreMedicine(removed, { expectedLockVersion: removed.lockVersion, medicineId: MEDICINE_A, now: NOW });
  assert.equal(restored.medicines.find((entry) => entry.medicineId === MEDICINE_A)!.status, "active");
});

test("restores original extracted fields after correction", () => {
  const edited = editMedicineField(draft(), { expectedLockVersion: 0, medicineId: MEDICINE_A, field: "medicineName", value: "Correction", now: NOW });
  const restored = restoreOriginalMedicineValues(edited, { expectedLockVersion: edited.lockVersion, medicineId: MEDICINE_A, now: NOW });
  assert.deepEqual(restored.medicines[0]!.current, restored.medicines[0]!.original);
  assert.equal(restored.medicines[0]!.provenance.medicineName.source, "ocr_observed");
});

test("reorders every active medicine exactly once", () => {
  const review = reorderMedicines(draft(), { expectedLockVersion: 0, orderedMedicineIds: [MEDICINE_B, MEDICINE_A], now: NOW });
  assert.deepEqual(review.medicines.filter((entry) => entry.status === "active").map((entry) => entry.medicineId), [MEDICINE_B, MEDICINE_A]);
  errorCode(() => reorderMedicines(draft(), { expectedLockVersion: 0, orderedMedicineIds: [MEDICINE_A, MEDICINE_A], now: NOW }), "REVIEW_INVALID");
});

test("rejects stale edits and advances lock versions on draft saves", () => {
  const saved = saveReviewDraft(draft(), { expectedLockVersion: 0, now: NOW });
  assert.equal(saved.lockVersion, 1);
  errorCode(() => editMedicineField(saved, { expectedLockVersion: 0, medicineId: MEDICINE_A, field: "notes", value: "stale", now: NOW }), "REVIEW_STALE");
});

test("confirms deterministically, handles duplicate confirmation, and freezes revision", () => {
  const confirmed = confirmReview(draft(), { expectedLockVersion: 0, idempotencyKey: "confirm-1", now: NOW });
  assert.equal(confirmed.status, "confirmed");
  assert.match(confirmed.canonicalInputFingerprint!.value, /^[0-9a-f]{64}$/);
  assert.equal(confirmReview(confirmed, { expectedLockVersion: 0, idempotencyKey: "confirm-1", now: NOW }), confirmed);
  errorCode(() => confirmReview(confirmed, { expectedLockVersion: confirmed.lockVersion, idempotencyKey: "confirm-2", now: NOW }), "REVIEW_INVALID_TRANSITION");
  errorCode(() => editMedicineField(confirmed, { expectedLockVersion: confirmed.lockVersion, medicineId: MEDICINE_A, field: "notes", value: "not allowed", now: NOW }), "REVIEW_IMMUTABLE");
});

test("creates a new mutable revision from a confirmed revision without changing history", () => {
  const confirmed = confirmReview(draft(), { expectedLockVersion: 0, idempotencyKey: "confirm-1", now: NOW });
  const reopened = createDraftFromConfirmed(confirmed, { revisionId: NEXT_REVISION_ID, now: "2026-11-15T11:00:00.000Z" });
  assert.equal(reopened.status, "draft");
  assert.equal(reopened.revisionNumber, 2);
  assert.equal(reopened.baseRevisionId, confirmed.revisionId);
  assert.equal(reopened.canonicalInputFingerprint, null);
  assert.equal(confirmed.status, "confirmed");
});

test("canonical fingerprints are stable across volatile metadata but sensitive to clinical fields and order", () => {
  const original = draft();
  const saved = saveReviewDraft(original, { expectedLockVersion: 0, now: "2026-11-15T12:00:00.000Z" });
  assert.equal(createReviewFingerprint(original).value, createReviewFingerprint(saved).value);
  assert.equal(canonicalizeReviewInput(original), canonicalizeReviewInput(validatePrescriptionReviewContractV1(structuredClone(original))));
  for (const [field, value] of [
    ["medicineName", "Othermed"], ["strengthValue", "250"], ["doseValue", "2"],
    ["timing", "before food"], ["durationValue", "10"],
  ] as const) {
    const changed = editMedicineField(original, { expectedLockVersion: 0, medicineId: MEDICINE_A, field, value, now: NOW });
    assert.notEqual(createReviewFingerprint(original).value, createReviewFingerprint(changed).value, field);
  }
  const reordered = reorderMedicines(original, { expectedLockVersion: 0, orderedMedicineIds: [MEDICINE_B, MEDICINE_A], now: NOW });
  assert.notEqual(createReviewFingerprint(original).value, createReviewFingerprint(reordered).value);
});

test("returns typed intelligence invalidation for identity, dose, schedule, add and remove changes", () => {
  const base = draft();
  const identity = editMedicineField(base, { expectedLockVersion: 0, medicineId: MEDICINE_A, field: "medicineName", value: "Changedmed", now: NOW });
  assert.deepEqual(determineIntelligenceInvalidation(base, identity).areas, ["catalogue_identity", "ingredient_assumptions", "recommendations", "warnings"]);
  const dose = editMedicineField(base, { expectedLockVersion: 0, medicineId: MEDICINE_A, field: "strengthValue", value: "250", now: NOW });
  assert.ok(determineIntelligenceInvalidation(base, dose).areas.includes("dose_interpretation"));
  const schedule = editMedicineField(base, { expectedLockVersion: 0, medicineId: MEDICINE_A, field: "frequency", value: "once daily", now: NOW });
  assert.ok(determineIntelligenceInvalidation(base, schedule).areas.includes("schedule_intelligence"));
  const added = addMedicine(base, { expectedLockVersion: 0, commandId: "add", medicineId: MEDICINE_C, fields: fields("Thirdmed"), now: NOW });
  assert.ok(determineIntelligenceInvalidation(base, added).areas.includes("aggregate_intelligence"));
  const removed = removeMedicine(base, { expectedLockVersion: 0, medicineId: MEDICINE_A, now: NOW });
  assert.ok(determineIntelligenceInvalidation(base, removed).reasonCodes.includes("MEDICINE_REMOVED"));
  assert.equal(determineIntelligenceInvalidation(base, base).stale, false);
});

test("rejects malformed values, empty names, bad strength formats and duplicate identifiers", () => {
  errorCode(() => editMedicineField(draft(), { expectedLockVersion: 0, medicineId: MEDICINE_A, field: "medicineName", value: "  ", now: NOW }), "REVIEW_INVALID");
  errorCode(() => editMedicineField(draft(), { expectedLockVersion: 0, medicineId: MEDICINE_A, field: "strengthValue", value: "five hundred mg", now: NOW }), "REVIEW_INVALID");
  errorCode(() => createInitialReviewDraft({
    prescriptionId: PRESCRIPTION_ID, revisionId: REVISION_ID,
    evidence: { evidenceSetId: EVIDENCE_ID, schemaVersion: "ocr-evidence.v1" },
    medicines: [{ medicineId: MEDICINE_A, fields: fields() }, { medicineId: MEDICINE_A, fields: fields("Duplicate") }], now: NOW,
  }), "REVIEW_INVALID");
});

test("rejects invalid transitions and never treats confirmation as medical verification", () => {
  const confirmed = confirmReview(draft(), { expectedLockVersion: 0, idempotencyKey: "confirm", now: NOW });
  assert.match(confirmed.confirmation.statement, /not medical verification/i);
  errorCode(() => createDraftFromConfirmed(draft(), { revisionId: NEXT_REVISION_ID, now: NOW }), "REVIEW_INVALID_TRANSITION");
  const allRemoved = removeMedicine(removeMedicine(draft(), { expectedLockVersion: 0, medicineId: MEDICINE_A, now: NOW }), { expectedLockVersion: 1, medicineId: MEDICINE_B, now: NOW });
  errorCode(() => confirmReview(allRemoved, { expectedLockVersion: 2, idempotencyKey: "empty", now: NOW }), "REVIEW_INVALID_TRANSITION");
});
