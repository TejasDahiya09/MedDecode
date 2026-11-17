import { createHash } from "node:crypto";

import {
  REVIEW_FINGERPRINT_SCHEMA,
  type PrescriptionReviewContractV1,
  type ReviewFingerprintV1,
  type ReviewMedicineFieldsV1,
} from "./types.js";

function canonicalFields(fields: ReviewMedicineFieldsV1): Record<string, unknown> {
  return {
    medicine_name: fields.medicineName,
    brand_name: fields.brandName,
    generic_name: fields.genericName,
    strength: { value: fields.strength.value, unit: fields.strength.unit },
    dosage_form: fields.dosageForm,
    dose: { value: fields.dose.value, unit: fields.dose.unit },
    frequency: fields.frequency,
    timing: fields.timing,
    route: fields.route,
    duration: { value: fields.duration.value, unit: fields.duration.unit },
    quantity: { value: fields.quantity.value, unit: fields.quantity.unit },
    notes: fields.notes,
  };
}

/**
 * The exact key order below is part of `meddecode.review-input.v1`.
 * Identifiers, timestamps, provenance and display metadata are excluded. Active
 * medicine ordering is included because it preserves prescription row context.
 */
export function canonicalizeReviewInput(review: PrescriptionReviewContractV1): string {
  const medicines = review.medicines
    .filter((medicine) => medicine.status === "active")
    .sort((left, right) => left.position - right.position)
    .map((medicine) => canonicalFields(medicine.current));
  return JSON.stringify({
    schema: REVIEW_FINGERPRINT_SCHEMA,
    prescription_id: review.prescriptionId,
    medicines,
  });
}

export function createReviewFingerprint(review: PrescriptionReviewContractV1): ReviewFingerprintV1 {
  return {
    schema: REVIEW_FINGERPRINT_SCHEMA,
    algorithm: "sha256",
    value: createHash("sha256").update(canonicalizeReviewInput(review), "utf8").digest("hex"),
  };
}
