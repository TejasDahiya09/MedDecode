import { PrescriptionReviewError } from "./errors.js";
import { createReviewFingerprint } from "./fingerprint.js";
import {
  REVIEW_CONFIRMATION_STATEMENT,
  REVIEW_CONTRACT_VERSION,
  type InitialExtractedMedicineV1,
  type PrescriptionReviewContractV1,
  type ReviewEditableField,
  type ReviewFieldProvenanceMapV1,
  type ReviewMedicineEntryV1,
  type ReviewMedicineFieldsV1,
} from "./types.js";
import {
  REVIEW_EDITABLE_FIELDS,
  validateMedicineFields,
  validatePrescriptionReviewContractV1,
  validateUuid,
} from "./validator.js";

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function finish(value: unknown): PrescriptionReviewContractV1 {
  return deepFreeze(validatePrescriptionReviewContractV1(value));
}

function ensureDraft(review: PrescriptionReviewContractV1): void {
  if (review.status === "confirmed") {
    throw new PrescriptionReviewError("REVIEW_IMMUTABLE", "Confirmed review revisions are immutable.");
  }
}

function ensureLock(review: PrescriptionReviewContractV1, expectedLockVersion: number): void {
  if (review.lockVersion !== expectedLockVersion) {
    throw new PrescriptionReviewError("REVIEW_STALE", "The review was changed by another operation.");
  }
}

function sourceFor(value: string | null): { source: "user_corrected" | "unresolved"; evidenceReference: null } {
  return { source: value === null ? "unresolved" : "user_corrected", evidenceReference: null };
}

function fieldValue(fields: ReviewMedicineFieldsV1, field: ReviewEditableField): string | null {
  switch (field) {
    case "strengthValue": return fields.strength.value;
    case "strengthUnit": return fields.strength.unit;
    case "doseValue": return fields.dose.value;
    case "doseUnit": return fields.dose.unit;
    case "durationValue": return fields.duration.value;
    case "durationUnit": return fields.duration.unit;
    case "quantityValue": return fields.quantity.value;
    case "quantityUnit": return fields.quantity.unit;
    default: return fields[field];
  }
}

function defaultProvenance(fields: ReviewMedicineFieldsV1, source: "ocr_observed" | "user_corrected"): ReviewFieldProvenanceMapV1 {
  return Object.fromEntries(REVIEW_EDITABLE_FIELDS.map((field) => {
    const value = fieldValue(fields, field);
    return [field, { source: value === null ? "unresolved" : source, evidenceReference: null }];
  })) as unknown as ReviewFieldProvenanceMapV1;
}

function deriveUnresolved(medicines: readonly ReviewMedicineEntryV1[]): string[] {
  const unresolved: string[] = [];
  for (const medicine of medicines.filter((entry) => entry.status === "active")) {
    for (const field of REVIEW_EDITABLE_FIELDS) {
      if (medicine.provenance[field].source === "unresolved" || fieldValue(medicine.current, field) === null) {
        unresolved.push(`medicines.${medicine.medicineId}.${field}`);
      }
    }
  }
  return unresolved.sort();
}

function updateFields(fields: ReviewMedicineFieldsV1, updates: Partial<Record<ReviewEditableField, string | null>>): ReviewMedicineFieldsV1 {
  const next = {
    medicineName: fields.medicineName,
    brandName: fields.brandName,
    genericName: fields.genericName,
    strength: { value: fields.strength.value, unit: fields.strength.unit },
    dosageForm: fields.dosageForm,
    dose: { value: fields.dose.value, unit: fields.dose.unit },
    frequency: fields.frequency,
    timing: fields.timing,
    route: fields.route,
    duration: { value: fields.duration.value, unit: fields.duration.unit },
    quantity: { value: fields.quantity.value, unit: fields.quantity.unit },
    notes: fields.notes,
  };
  for (const [field, value] of Object.entries(updates) as [ReviewEditableField, string | null][]) {
    switch (field) {
      case "strengthValue": next.strength.value = value; break;
      case "strengthUnit": next.strength.unit = value; break;
      case "doseValue": next.dose.value = value; break;
      case "doseUnit": next.dose.unit = value; break;
      case "durationValue": next.duration.value = value; break;
      case "durationUnit": next.duration.unit = value; break;
      case "quantityValue": next.quantity.value = value; break;
      case "quantityUnit": next.quantity.unit = value; break;
      default: next[field] = value;
    }
  }
  return validateMedicineFields(next);
}

function mutated(
  review: PrescriptionReviewContractV1,
  medicines: readonly ReviewMedicineEntryV1[],
  now: string,
): PrescriptionReviewContractV1 {
  return finish({
    ...review,
    lockVersion: review.lockVersion + 1,
    medicines,
    unresolvedFields: deriveUnresolved(medicines),
    updatedAt: now,
  });
}

export function createInitialReviewDraft(input: {
  prescriptionId: string;
  revisionId: string;
  evidence: PrescriptionReviewContractV1["evidence"];
  medicines: readonly InitialExtractedMedicineV1[];
  now: string;
}): PrescriptionReviewContractV1 {
  validateUuid(input.prescriptionId, "prescriptionId");
  validateUuid(input.revisionId, "revisionId");
  const medicines = input.medicines.map((source, index): ReviewMedicineEntryV1 => {
    const fields = validateMedicineFields(source.fields, `medicines[${index}].fields`);
    const base = defaultProvenance(fields, "ocr_observed");
    return {
      medicineId: validateUuid(source.medicineId, `medicines[${index}].medicineId`),
      origin: "extracted",
      status: "active",
      position: index + 1,
      original: fields,
      current: fields,
      provenance: { ...base, ...source.provenance },
      addedByCommandId: null,
      removedAt: null,
    };
  });
  return finish({
    schemaVersion: REVIEW_CONTRACT_VERSION,
    prescriptionId: input.prescriptionId,
    evidence: input.evidence,
    revisionId: input.revisionId,
    revisionNumber: 1,
    baseRevisionId: null,
    status: "draft",
    lockVersion: 0,
    medicines,
    unresolvedFields: deriveUnresolved(medicines),
    confirmation: { status: "pending", statement: REVIEW_CONFIRMATION_STATEMENT, confirmedAt: null, idempotencyKey: null },
    canonicalInputFingerprint: null,
    createdAt: input.now,
    updatedAt: input.now,
  });
}

export function editMedicineFields(
  review: PrescriptionReviewContractV1,
  command: {
    expectedLockVersion: number;
    medicineId: string;
    updates: Partial<Record<ReviewEditableField, string | null>>;
    now: string;
  },
): PrescriptionReviewContractV1 {
  ensureDraft(review);
  ensureLock(review, command.expectedLockVersion);
  const entries = Object.entries(command.updates) as [ReviewEditableField, string | null][];
  if (entries.length === 0) throw new PrescriptionReviewError("REVIEW_INVALID", "At least one field update is required.");
  if (entries.some(([field]) => !REVIEW_EDITABLE_FIELDS.includes(field))) throw new PrescriptionReviewError("REVIEW_INVALID", "An editable field is invalid.");
  let found = false;
  const medicines = review.medicines.map((medicine) => {
    if (medicine.medicineId !== command.medicineId) return medicine;
    found = true;
    if (medicine.status !== "active") throw new PrescriptionReviewError("REVIEW_INVALID_TRANSITION", "Removed medicines must be restored before editing.");
    const current = updateFields(medicine.current, command.updates);
    const provenance = { ...medicine.provenance };
    for (const [field, value] of entries) provenance[field] = sourceFor(value === null ? null : fieldValue(current, field));
    return { ...medicine, current, provenance };
  });
  if (!found) throw new PrescriptionReviewError("REVIEW_MEDICINE_NOT_FOUND", "Medicine was not found in this revision.");
  return mutated(review, medicines, command.now);
}

export function editMedicineField(
  review: PrescriptionReviewContractV1,
  command: { expectedLockVersion: number; medicineId: string; field: ReviewEditableField; value: string | null; now: string },
): PrescriptionReviewContractV1 {
  return editMedicineFields(review, { ...command, updates: { [command.field]: command.value } });
}

export function addMedicine(
  review: PrescriptionReviewContractV1,
  command: { expectedLockVersion: number; commandId: string; medicineId: string; fields: ReviewMedicineFieldsV1; position?: number; now: string },
): PrescriptionReviewContractV1 {
  ensureDraft(review);
  const replay = review.medicines.find((medicine) => medicine.addedByCommandId === command.commandId);
  if (replay) {
    if (replay.medicineId !== command.medicineId) throw new PrescriptionReviewError("REVIEW_COMMAND_CONFLICT", "The command identifier was already used for another medicine.");
    return review;
  }
  ensureLock(review, command.expectedLockVersion);
  if (review.medicines.some((medicine) => medicine.medicineId === command.medicineId)) throw new PrescriptionReviewError("REVIEW_DUPLICATE_MEDICINE", "Medicine identifier already exists.");
  const fields = validateMedicineFields(command.fields);
  if (fields.medicineName === null) throw new PrescriptionReviewError("REVIEW_INVALID", "A user-added medicine requires a medicine name.");
  const activeCount = review.medicines.filter((item) => item.status === "active").length;
  const position = command.position ?? activeCount + 1;
  if (!Number.isInteger(position) || position < 1 || position > activeCount + 1) throw new PrescriptionReviewError("REVIEW_INVALID", "Medicine position is invalid.");
  const shifted = review.medicines.map((medicine) => medicine.status === "active" && medicine.position >= position ? { ...medicine, position: medicine.position + 1 } : medicine);
  const added: ReviewMedicineEntryV1 = {
    medicineId: validateUuid(command.medicineId, "medicineId"), origin: "user_added", status: "active", position,
    original: null, current: fields, provenance: defaultProvenance(fields, "user_corrected"),
    addedByCommandId: command.commandId.trim(), removedAt: null,
  };
  return mutated(review, [...shifted, added].sort((a, b) => a.position - b.position), command.now);
}

export function removeMedicine(review: PrescriptionReviewContractV1, command: { expectedLockVersion: number; medicineId: string; now: string }): PrescriptionReviewContractV1 {
  ensureDraft(review); ensureLock(review, command.expectedLockVersion);
  const target = review.medicines.find((item) => item.medicineId === command.medicineId);
  if (!target) throw new PrescriptionReviewError("REVIEW_MEDICINE_NOT_FOUND", "Medicine was not found in this revision.");
  if (target.status === "removed") return review;
  const medicines = review.medicines.map((item) => item.medicineId === command.medicineId ? { ...item, status: "removed" as const, removedAt: command.now } : item);
  return mutated(review, medicines, command.now);
}

export function restoreMedicine(review: PrescriptionReviewContractV1, command: { expectedLockVersion: number; medicineId: string; now: string }): PrescriptionReviewContractV1 {
  ensureDraft(review); ensureLock(review, command.expectedLockVersion);
  const target = review.medicines.find((item) => item.medicineId === command.medicineId);
  if (!target) throw new PrescriptionReviewError("REVIEW_MEDICINE_NOT_FOUND", "Medicine was not found in this revision.");
  if (target.status === "active") return review;
  const insertionPosition = Math.min(target.position, review.medicines.filter((item) => item.status === "active").length + 1);
  const medicines = review.medicines.map((item) => {
    if (item.medicineId === command.medicineId) return { ...item, status: "active" as const, position: insertionPosition, removedAt: null };
    return item.status === "active" && item.position >= insertionPosition ? { ...item, position: item.position + 1 } : item;
  });
  return mutated(review, medicines, command.now);
}

export function restoreOriginalMedicineValues(review: PrescriptionReviewContractV1, command: { expectedLockVersion: number; medicineId: string; now: string }): PrescriptionReviewContractV1 {
  ensureDraft(review); ensureLock(review, command.expectedLockVersion);
  const target = review.medicines.find((item) => item.medicineId === command.medicineId);
  if (!target) throw new PrescriptionReviewError("REVIEW_MEDICINE_NOT_FOUND", "Medicine was not found in this revision.");
  if (target.original === null) throw new PrescriptionReviewError("REVIEW_INVALID_TRANSITION", "A user-added medicine has no OCR original to restore.");
  const provenance = defaultProvenance(target.original, "ocr_observed");
  const medicines = review.medicines.map((item) => item.medicineId === command.medicineId ? { ...item, current: target.original!, provenance } : item);
  return mutated(review, medicines, command.now);
}

export function reorderMedicines(review: PrescriptionReviewContractV1, command: { expectedLockVersion: number; orderedMedicineIds: readonly string[]; now: string }): PrescriptionReviewContractV1 {
  ensureDraft(review); ensureLock(review, command.expectedLockVersion);
  const active = review.medicines.filter((item) => item.status === "active");
  if (new Set(command.orderedMedicineIds).size !== command.orderedMedicineIds.length || command.orderedMedicineIds.length !== active.length || active.some((item) => !command.orderedMedicineIds.includes(item.medicineId))) {
    throw new PrescriptionReviewError("REVIEW_INVALID", "Reorder must contain every active medicine exactly once.");
  }
  const positions = new Map(command.orderedMedicineIds.map((id, index) => [id, index + 1]));
  const medicines = review.medicines.map((item) => item.status === "active" ? { ...item, position: positions.get(item.medicineId)! } : item);
  return mutated(review, medicines.sort((a, b) => a.position - b.position), command.now);
}

export function saveReviewDraft(review: PrescriptionReviewContractV1, command: { expectedLockVersion: number; now: string }): PrescriptionReviewContractV1 {
  ensureDraft(review); ensureLock(review, command.expectedLockVersion);
  return mutated(review, review.medicines, command.now);
}

export function confirmReview(review: PrescriptionReviewContractV1, command: { expectedLockVersion: number; idempotencyKey: string; now: string }): PrescriptionReviewContractV1 {
  if (review.status === "confirmed") {
    if (review.confirmation.idempotencyKey === command.idempotencyKey) return review;
    throw new PrescriptionReviewError("REVIEW_INVALID_TRANSITION", "This revision is already confirmed with another command.");
  }
  ensureLock(review, command.expectedLockVersion);
  if (!command.idempotencyKey.trim()) throw new PrescriptionReviewError("REVIEW_INVALID", "Confirmation idempotency key is required.");
  if (!review.medicines.some((item) => item.status === "active")) throw new PrescriptionReviewError("REVIEW_INVALID_TRANSITION", "At least one active medicine is required for confirmation.");
  const fingerprint = createReviewFingerprint(review);
  return finish({
    ...review,
    status: "confirmed",
    lockVersion: review.lockVersion + 1,
    canonicalInputFingerprint: fingerprint,
    confirmation: { status: "confirmed", statement: REVIEW_CONFIRMATION_STATEMENT, confirmedAt: command.now, idempotencyKey: command.idempotencyKey.trim() },
    updatedAt: command.now,
  });
}

export function createDraftFromConfirmed(review: PrescriptionReviewContractV1, command: { revisionId: string; now: string }): PrescriptionReviewContractV1 {
  if (review.status !== "confirmed") throw new PrescriptionReviewError("REVIEW_INVALID_TRANSITION", "Only a confirmed revision can be reopened as a new draft.");
  return finish({
    ...review,
    revisionId: validateUuid(command.revisionId, "revisionId"),
    revisionNumber: review.revisionNumber + 1,
    baseRevisionId: review.revisionId,
    status: "draft",
    lockVersion: 0,
    confirmation: { status: "pending", statement: REVIEW_CONFIRMATION_STATEMENT, confirmedAt: null, idempotencyKey: null },
    canonicalInputFingerprint: null,
    medicines: review.medicines.map((item) => ({ ...item, addedByCommandId: null })),
    createdAt: command.now,
    updatedAt: command.now,
  });
}
