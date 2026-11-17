import { PrescriptionReviewError } from "./errors.js";
import {
  REVIEW_CONFIRMATION_STATEMENT,
  REVIEW_CONTRACT_VERSION,
  REVIEW_FINGERPRINT_SCHEMA,
  type PrescriptionReviewContractV1,
  type ReviewEditableField,
  type ReviewFieldProvenanceMapV1,
  type ReviewFieldSourceKind,
  type ReviewMedicineEntryV1,
  type ReviewMedicineFieldsV1,
  type ReviewValueWithUnitV1,
} from "./types.js";

export const REVIEW_EDITABLE_FIELDS: readonly ReviewEditableField[] = [
  "medicineName", "brandName", "genericName", "strengthValue", "strengthUnit",
  "dosageForm", "doseValue", "doseUnit", "frequency", "timing", "route",
  "durationValue", "durationUnit", "quantityValue", "quantityUnit", "notes",
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const DECIMAL_OR_RANGE = /^(?:\d+(?:\.\d+)?)(?:\s*-\s*(?:\d+(?:\.\d+)?))?$/;
const DOSE_OR_QUANTITY = /^(?:\d+(?:\.\d+)?|\d+\s*\/\s*\d+)$/;
const UNIT = /^[\p{L}\p{N}%µμ./ -]{1,32}$/u;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const SOURCES = new Set<ReviewFieldSourceKind>([
  "ocr_observed", "automatically_interpreted", "user_corrected", "unresolved",
]);

function invalid(message: string): never {
  throw new PrescriptionReviewError("REVIEW_INVALID", message);
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid(`${path} must be an object.`);
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, path: string, max = 200): string {
  if (typeof value !== "string") invalid(`${path} must be a string.`);
  const normalized = value.trim();
  if (!normalized) invalid(`${path} must not be empty.`);
  if (normalized.length > max) invalid(`${path} exceeds ${max} characters.`);
  if (CONTROL.test(normalized)) invalid(`${path} contains control characters.`);
  return normalized;
}

function nullableString(value: unknown, path: string, max = 200): string | null {
  if (value === null) return null;
  return requiredString(value, path, max);
}

export function validateUuid(value: unknown, path: string): string {
  const parsed = requiredString(value, path, 36);
  if (!UUID.test(parsed)) invalid(`${path} must be a UUID.`);
  return parsed.toLowerCase();
}

function positiveInteger(value: unknown, path: string, allowZero = false): number {
  if (!Number.isInteger(value) || (value as number) < (allowZero ? 0 : 1)) invalid(`${path} must be a ${allowZero ? "non-negative" : "positive"} integer.`);
  return value as number;
}

function timestamp(value: unknown, path: string): string {
  const parsed = requiredString(value, path, 40);
  if (!Number.isFinite(Date.parse(parsed))) invalid(`${path} must be an ISO timestamp.`);
  return parsed;
}

function validateUnit(value: unknown, path: string): string | null {
  const parsed = nullableString(value, path, 32);
  if (parsed !== null && !UNIT.test(parsed)) invalid(`${path} has an invalid unit format.`);
  return parsed;
}

function valueWithUnit(value: unknown, path: string, kind: "strength" | "dose" | "duration" | "quantity"): ReviewValueWithUnitV1 {
  const item = object(value, path);
  const parsedValue = nullableString(item.value, `${path}.value`, 32);
  if (parsedValue !== null) {
    const pattern = kind === "strength" || kind === "duration" ? DECIMAL_OR_RANGE : DOSE_OR_QUANTITY;
    if (!pattern.test(parsedValue)) invalid(`${path}.value has an invalid ${kind} format.`);
    if (parsedValue.includes("/")) {
      const denominator = Number(parsedValue.split("/")[1]?.trim());
      if (denominator === 0) invalid(`${path}.value must not divide by zero.`);
    }
  }
  const unit = validateUnit(item.unit, `${path}.unit`);
  return { value: parsedValue, unit };
}

export function validateMedicineFields(value: unknown, path = "medicine"): ReviewMedicineFieldsV1 {
  const item = object(value, path);
  return {
    medicineName: nullableString(item.medicineName, `${path}.medicineName`),
    brandName: nullableString(item.brandName, `${path}.brandName`),
    genericName: nullableString(item.genericName, `${path}.genericName`),
    strength: valueWithUnit(item.strength, `${path}.strength`, "strength"),
    dosageForm: nullableString(item.dosageForm, `${path}.dosageForm`, 80),
    dose: valueWithUnit(item.dose, `${path}.dose`, "dose"),
    frequency: nullableString(item.frequency, `${path}.frequency`, 80),
    timing: nullableString(item.timing, `${path}.timing`, 120),
    route: nullableString(item.route, `${path}.route`, 80),
    duration: valueWithUnit(item.duration, `${path}.duration`, "duration"),
    quantity: valueWithUnit(item.quantity, `${path}.quantity`, "quantity"),
    notes: nullableString(item.notes, `${path}.notes`, 1000),
  };
}

function provenance(value: unknown, path: string): ReviewFieldProvenanceMapV1 {
  const root = object(value, path);
  const output = {} as Record<ReviewEditableField, { source: ReviewFieldSourceKind; evidenceReference: string | null }>;
  for (const field of REVIEW_EDITABLE_FIELDS) {
    const item = object(root[field], `${path}.${field}`);
    if (!SOURCES.has(item.source as ReviewFieldSourceKind)) invalid(`${path}.${field}.source is invalid.`);
    output[field] = {
      source: item.source as ReviewFieldSourceKind,
      evidenceReference: nullableString(item.evidenceReference, `${path}.${field}.evidenceReference`, 300),
    };
  }
  return output;
}

function medicine(value: unknown, path: string): ReviewMedicineEntryV1 {
  const item = object(value, path);
  if (item.origin !== "extracted" && item.origin !== "user_added") invalid(`${path}.origin is invalid.`);
  if (item.status !== "active" && item.status !== "removed") invalid(`${path}.status is invalid.`);
  const original = item.original === null ? null : validateMedicineFields(item.original, `${path}.original`);
  const current = validateMedicineFields(item.current, `${path}.current`);
  if (item.origin === "extracted" && original === null) invalid(`${path}.original is required for extracted medicines.`);
  if (item.origin === "user_added" && original !== null) invalid(`${path}.original must be null for user-added medicines.`);
  const removedAt = item.removedAt === null ? null : timestamp(item.removedAt, `${path}.removedAt`);
  if ((item.status === "removed") !== (removedAt !== null)) invalid(`${path}.removedAt must match removed status.`);
  return {
    medicineId: validateUuid(item.medicineId, `${path}.medicineId`),
    origin: item.origin,
    status: item.status,
    position: positiveInteger(item.position, `${path}.position`),
    original,
    current,
    provenance: provenance(item.provenance, `${path}.provenance`),
    addedByCommandId: item.addedByCommandId === null ? null : requiredString(item.addedByCommandId, `${path}.addedByCommandId`, 128),
    removedAt,
  };
}

export function validatePrescriptionReviewContractV1(value: unknown): PrescriptionReviewContractV1 {
  const root = object(value, "review");
  if (root.schemaVersion !== REVIEW_CONTRACT_VERSION) invalid("review.schemaVersion must be 1.0.");
  const evidence = object(root.evidence, "review.evidence");
  if (root.status !== "draft" && root.status !== "confirmed") invalid("review.status is invalid.");
  if (!Array.isArray(root.medicines)) invalid("review.medicines must be an array.");
  const medicines = root.medicines.map((entry, index) => medicine(entry, `review.medicines[${index}]`));
  const ids = new Set<string>();
  const positions = new Set<number>();
  for (const entry of medicines) {
    if (ids.has(entry.medicineId)) invalid("review.medicines contains duplicate medicine identifiers.");
    if (entry.status === "active" && positions.has(entry.position)) invalid("review.medicines contains duplicate active positions.");
    ids.add(entry.medicineId);
    if (entry.status === "active") positions.add(entry.position);
  }
  if (!Array.isArray(root.unresolvedFields) || root.unresolvedFields.some((entry) => typeof entry !== "string" || !entry.trim())) {
    invalid("review.unresolvedFields must contain non-empty strings.");
  }
  const confirmation = object(root.confirmation, "review.confirmation");
  if (confirmation.status !== "pending" && confirmation.status !== "confirmed") invalid("review.confirmation.status is invalid.");
  if (confirmation.statement !== REVIEW_CONFIRMATION_STATEMENT) invalid("review.confirmation.statement is invalid.");
  const confirmedAt = confirmation.confirmedAt === null ? null : timestamp(confirmation.confirmedAt, "review.confirmation.confirmedAt");
  const idempotencyKey = confirmation.idempotencyKey === null ? null : requiredString(confirmation.idempotencyKey, "review.confirmation.idempotencyKey", 128);
  if ((confirmation.status === "confirmed") !== (confirmedAt !== null && idempotencyKey !== null)) invalid("review.confirmation metadata is inconsistent.");

  let fingerprint = null;
  if (root.canonicalInputFingerprint !== null) {
    const item = object(root.canonicalInputFingerprint, "review.canonicalInputFingerprint");
    if (item.schema !== REVIEW_FINGERPRINT_SCHEMA || item.algorithm !== "sha256" || typeof item.value !== "string" || !SHA256.test(item.value)) {
      invalid("review.canonicalInputFingerprint is invalid.");
    }
    fingerprint = { schema: REVIEW_FINGERPRINT_SCHEMA, algorithm: "sha256" as const, value: item.value };
  }
  if ((root.status === "confirmed") !== (confirmation.status === "confirmed" && fingerprint !== null)) invalid("review confirmation and fingerprint must match revision status.");

  const contract: PrescriptionReviewContractV1 = {
    schemaVersion: REVIEW_CONTRACT_VERSION,
    prescriptionId: validateUuid(root.prescriptionId, "review.prescriptionId"),
    evidence: {
      evidenceSetId: validateUuid(evidence.evidenceSetId, "review.evidence.evidenceSetId"),
      schemaVersion: requiredString(evidence.schemaVersion, "review.evidence.schemaVersion", 40),
      ...(evidence.documentSha256 === undefined ? {} : { documentSha256: requiredString(evidence.documentSha256, "review.evidence.documentSha256", 64).toLowerCase() }),
    },
    revisionId: validateUuid(root.revisionId, "review.revisionId"),
    revisionNumber: positiveInteger(root.revisionNumber, "review.revisionNumber"),
    baseRevisionId: root.baseRevisionId === null ? null : validateUuid(root.baseRevisionId, "review.baseRevisionId"),
    status: root.status,
    lockVersion: positiveInteger(root.lockVersion, "review.lockVersion", true),
    medicines,
    unresolvedFields: [...new Set((root.unresolvedFields as string[]).map((entry) => entry.trim()))].sort(),
    confirmation: { status: confirmation.status, statement: REVIEW_CONFIRMATION_STATEMENT, confirmedAt, idempotencyKey },
    canonicalInputFingerprint: fingerprint,
    createdAt: timestamp(root.createdAt, "review.createdAt"),
    updatedAt: timestamp(root.updatedAt, "review.updatedAt"),
  };
  if (contract.evidence.documentSha256 !== undefined && !SHA256.test(contract.evidence.documentSha256)) invalid("review.evidence.documentSha256 must be a SHA-256 digest.");
  return contract;
}
