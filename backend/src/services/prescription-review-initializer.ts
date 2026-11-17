import { createHash } from "node:crypto";

import {
  createInitialReviewDraft,
  type InitialExtractedMedicineV1,
  type PrescriptionReviewContractV1,
  type ReviewFieldProvenanceMapV1,
  type ReviewMedicineFieldsV1,
} from "../domain/prescription-review/index.js";
import type { IntelligenceSuccessV1 } from "../types/intelligence-contract-v1.js";

function stableUuid(namespace: string): string {
  const hex = createHash("sha256").update(namespace, "utf8").digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = (["8", "9", "a", "b"] as const)[Number.parseInt(hex[16]!, 16) % 4]!;
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

const numberText = (value: number | null | undefined): string | null => value === null || value === undefined ? null : String(value);

interface SourceMedicine {
  sequence_number: number;
  extraction: {
    medicine_name?: string | null;
    strength?: { value: number | null; unit: string | null };
    dosage_form?: string | null;
    frequency: { type: "scheduled" | "as_needed" | "unknown"; morning?: number | null; afternoon?: number | null; night?: number | null; times_per_day?: number | null };
    timing?: string | null;
    duration?: { value: number | null; unit: string | null };
    quantity?: { value: number | null; unit: string | null };
    instructions?: string | null;
  };
  medicine_match: { brand_name: string | null };
}

function frequencyText(frequency: SourceMedicine["extraction"]["frequency"]): string | null {
  if (frequency.type === "as_needed") return "as needed";
  if (frequency.type === "unknown") return null;
  if (frequency.times_per_day !== null && frequency.times_per_day !== undefined) return `${frequency.times_per_day} times daily`;
  const parts = [["morning", frequency.morning], ["afternoon", frequency.afternoon], ["night", frequency.night]]
    .filter((entry) => typeof entry[1] === "number" && entry[1] !== 0)
    .map((entry) => `${entry[0]}:${entry[1]}`);
  return parts.length ? parts.join(", ") : null;
}

function provenance(fields: ReviewMedicineFieldsV1): Partial<ReviewFieldProvenanceMapV1> {
  const interpreted = (value: string | null) => ({ source: value === null ? "unresolved" as const : "automatically_interpreted" as const, evidenceReference: null });
  return {
    medicineName: interpreted(fields.medicineName), brandName: interpreted(fields.brandName), genericName: interpreted(fields.genericName),
    strengthValue: interpreted(fields.strength.value), strengthUnit: interpreted(fields.strength.unit), dosageForm: interpreted(fields.dosageForm),
    doseValue: interpreted(fields.dose.value), doseUnit: interpreted(fields.dose.unit), frequency: interpreted(fields.frequency),
    timing: interpreted(fields.timing), route: interpreted(fields.route), durationValue: interpreted(fields.duration.value),
    durationUnit: interpreted(fields.duration.unit), quantityValue: interpreted(fields.quantity.value), quantityUnit: interpreted(fields.quantity.unit),
    notes: interpreted(fields.notes),
  };
}

export function createInitialReviewFromIntelligence(input: {
  result: IntelligenceSuccessV1;
  evidenceSetId: string;
  evidenceSchemaVersion: string;
  documentSha256?: string;
  now: string;
}): PrescriptionReviewContractV1 {
  const medicines: InitialExtractedMedicineV1[] = (input.result.medicines as unknown as SourceMedicine[]).map((medicine) => {
    const fields: ReviewMedicineFieldsV1 = {
      medicineName: medicine.extraction.medicine_name ?? null,
      brandName: medicine.medicine_match.brand_name,
      genericName: null,
      strength: { value: numberText(medicine.extraction.strength?.value), unit: medicine.extraction.strength?.unit ?? null },
      dosageForm: medicine.extraction.dosage_form ?? null,
      dose: { value: null, unit: null },
      frequency: frequencyText(medicine.extraction.frequency),
      timing: medicine.extraction.timing ?? null,
      route: null,
      duration: { value: numberText(medicine.extraction.duration?.value), unit: medicine.extraction.duration?.unit ?? null },
      quantity: { value: numberText(medicine.extraction.quantity?.value), unit: medicine.extraction.quantity?.unit ?? null },
      notes: medicine.extraction.instructions ?? null,
    };
    return {
      medicineId: stableUuid(`${input.result.prescription_id}:medicine:${medicine.sequence_number}`),
      fields,
      provenance: provenance(fields),
    };
  });
  return createInitialReviewDraft({
    prescriptionId: input.result.prescription_id,
    revisionId: stableUuid(`${input.result.prescription_id}:review:1`),
    evidence: {
      evidenceSetId: input.evidenceSetId,
      schemaVersion: input.evidenceSchemaVersion,
      ...(input.documentSha256 === undefined ? {} : { documentSha256: input.documentSha256 }),
    },
    medicines,
    now: input.now,
  });
}
