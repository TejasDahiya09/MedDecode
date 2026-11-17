import type {
  IntelligenceInvalidationArea,
  IntelligenceInvalidationResult,
  PrescriptionReviewContractV1,
  ReviewMedicineEntryV1,
} from "./types.js";

const NAME_FIELDS = ["medicineName", "brandName", "genericName", "dosageForm"] as const;
const DOSE_FIELDS = ["strength", "dose", "quantity"] as const;
const SCHEDULE_FIELDS = ["frequency", "timing", "route", "duration"] as const;

function same(value: unknown, other: unknown): boolean {
  return JSON.stringify(value) === JSON.stringify(other);
}

function activeById(review: PrescriptionReviewContractV1): Map<string, ReviewMedicineEntryV1> {
  return new Map(review.medicines.filter((item) => item.status === "active").map((item) => [item.medicineId, item]));
}

export function determineIntelligenceInvalidation(
  previous: PrescriptionReviewContractV1,
  next: PrescriptionReviewContractV1,
): IntelligenceInvalidationResult {
  const prior = activeById(previous);
  const current = activeById(next);
  const medicineIds = new Set([...prior.keys(), ...current.keys()]);
  const affected = new Set<string>();
  const areas = new Set<IntelligenceInvalidationArea>();
  const reasons = new Set<string>();

  for (const medicineId of medicineIds) {
    const before = prior.get(medicineId);
    const after = current.get(medicineId);
    if (!before || !after) {
      affected.add(medicineId);
      areas.add("aggregate_intelligence");
      areas.add("catalogue_identity");
      areas.add("recommendations");
      areas.add("warnings");
      reasons.add(before ? "MEDICINE_REMOVED" : "MEDICINE_ADDED");
      continue;
    }
    if (NAME_FIELDS.some((field) => !same(before.current[field], after.current[field]))) {
      affected.add(medicineId);
      areas.add("catalogue_identity");
      areas.add("ingredient_assumptions");
      areas.add("recommendations");
      areas.add("warnings");
      reasons.add("MEDICINE_IDENTITY_CHANGED");
    }
    if (DOSE_FIELDS.some((field) => !same(before.current[field], after.current[field]))) {
      affected.add(medicineId);
      areas.add("dose_interpretation");
      areas.add("catalogue_identity");
      areas.add("recommendations");
      areas.add("warnings");
      reasons.add("DOSE_RELEVANT_FIELD_CHANGED");
    }
    if (SCHEDULE_FIELDS.some((field) => !same(before.current[field], after.current[field]))) {
      affected.add(medicineId);
      areas.add("schedule_intelligence");
      areas.add("recommendations");
      areas.add("warnings");
      reasons.add("SCHEDULE_RELEVANT_FIELD_CHANGED");
    }
    if (before.current.notes !== after.current.notes) {
      affected.add(medicineId);
      areas.add("warnings");
      reasons.add("NOTES_CHANGED");
    }
  }

  const reordered = [...current.keys()].some((id, index) => [...prior.keys()][index] !== id);
  if (reordered) {
    areas.add("aggregate_intelligence");
    reasons.add("MEDICINE_ORDER_CHANGED");
    for (const id of current.keys()) affected.add(id);
  }

  return Object.freeze({
    stale: reasons.size > 0,
    affectedMedicineIds: Object.freeze([...affected].sort()),
    areas: Object.freeze([...areas].sort()),
    reasonCodes: Object.freeze([...reasons].sort()),
  });
}
