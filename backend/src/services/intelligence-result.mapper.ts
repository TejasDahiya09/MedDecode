import { validateIntelligenceResponseV1 } from "./intelligence-contract-v1.validator.js";
import type { IntelligenceResponseV1 } from "../types/intelligence-contract-v1.js";
import type {
  IntelligencePersistencePlan,
  PrescriptionMedicineProjectionInsert,
  UnsupportedNormalizedField,
} from "../types/intelligence-persistence.js";

export class IntelligenceResultMappingError extends Error {
  constructor(readonly code: "ALTERNATIVES_CONTRACT_UNRESOLVED") {
    super("The validated intelligence result cannot be mapped safely.");
    this.name = "IntelligenceResultMappingError";
  }
}

const clone = <T>(value: T): T => structuredClone(value);

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value as Record<string, unknown>)) {
      deepFreeze(item);
    }
  }
  return value;
}

function object(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function unsupportedMatchFields(
  match: Record<string, unknown>,
  target: Set<UnsupportedNormalizedField>,
): void {
  if (match.medicine_external_id !== null && match.medicine_external_id !== undefined) {
    target.add("medicines[].medicine_match.medicine_external_id");
  }
  if (match.brand_name !== null && match.brand_name !== undefined) {
    target.add("medicines[].medicine_match.brand_name");
  }
  if (match.dosage_form !== null && match.dosage_form !== undefined) {
    target.add("medicines[].medicine_match.dosage_form");
  }
  if (Array.isArray(match.ingredients) && match.ingredients.length > 0) {
    target.add("medicines[].medicine_match.ingredients");
  }
}

function medicineProjection(
  prescriptionId: string,
  value: Record<string, unknown>,
  unsupported: Set<UnsupportedNormalizedField>,
): PrescriptionMedicineProjectionInsert {
  const extraction = object(value.extraction);
  const strength = object(extraction.strength);
  const frequency = object(extraction.frequency);
  const duration = object(extraction.duration);
  const quantity = object(extraction.quantity);
  const confidence = object(value.confidence);
  const match = object(value.medicine_match);
  const derived = object(value.derived);
  unsupportedMatchFields(match, unsupported);

  return Object.freeze({
    prescription_id: prescriptionId,
    sequence_number: value.sequence_number as number,
    raw_text: extraction.raw_text as string,
    medicine_name: nullableString(extraction.medicine_name),
    medicine_name_normalized: nullableString(extraction.medicine_name_normalized),
    strength_value: nullableNumber(strength.value),
    strength_unit: nullableString(strength.unit),
    dosage_form: nullableString(extraction.dosage_form),
    frequency_type: frequency.type as PrescriptionMedicineProjectionInsert["frequency_type"],
    frequency_morning: nullableNumber(frequency.morning),
    frequency_afternoon: nullableNumber(frequency.afternoon),
    frequency_night: nullableNumber(frequency.night),
    frequency_times_per_day: nullableNumber(frequency.times_per_day),
    timing: nullableString(extraction.timing),
    duration_value: nullableNumber(duration.value),
    duration_unit: nullableString(duration.unit),
    quantity_value: nullableNumber(quantity.value),
    quantity_unit: nullableString(quantity.unit),
    instructions: nullableString(extraction.instructions),
    extraction_confidence: nullableNumber(confidence.extraction),
    medicine_name_confidence: nullableNumber(confidence.medicine_name),
    dosage_confidence: nullableNumber(confidence.dosage),
    match_status: match.status as PrescriptionMedicineProjectionInsert["match_status"],
    match_confidence: nullableNumber(match.confidence),
    units_per_day: nullableNumber(derived.units_per_day),
    estimated_total_units: nullableNumber(derived.estimated_total_units),
  });
}

export function mapValidatedIntelligenceResult(input: {
  readonly response: IntelligenceResponseV1;
  readonly finalizedAt: string;
}): IntelligencePersistencePlan {
  const response = validateIntelligenceResponseV1(input.response, {
    jobId: input.response.job_id,
    prescriptionId: input.response.prescription_id,
  });
  const rawResponse = deepFreeze(clone(response));

  if (response.status === "failed") {
    return Object.freeze({
      rawResult: Object.freeze({
        prescription_id: response.prescription_id,
        job_id: response.job_id,
        schema_version: response.schema_version,
        status: response.status,
        result_json: rawResponse,
        error_json: deepFreeze(clone(response.error)),
      }),
      prescriptionPatch: Object.freeze({
        status: "failed",
        intelligence_schema_version: "1.0",
        processed_at: input.finalizedAt,
      }),
      medicines: Object.freeze([]),
      recommendations: Object.freeze([]),
      warnings: Object.freeze([]),
      unsupportedNormalizedFields: Object.freeze([]),
    });
  }

  if (response.medicines.some((medicine) => {
    const alternatives = object(medicine).alternatives;
    return Array.isArray(alternatives) && alternatives.length > 0;
  })) {
    throw new IntelligenceResultMappingError("ALTERNATIVES_CONTRACT_UNRESOLVED");
  }

  const prescription = object(response.prescription);
  const doctor = object(prescription.doctor);
  const facility = object(prescription.facility);
  const patient = object(response.patient);
  const metadata = response.processing_metadata;
  const unsupported = new Set<UnsupportedNormalizedField>();
  const medicines = response.medicines.map((item) =>
    medicineProjection(response.prescription_id, object(item), unsupported));
  const recommendations = response.recommendations.map((item) => {
    const value = object(item);
    return Object.freeze({
      prescription_id: response.prescription_id,
      type: value.type as string,
      title: value.title as string,
      message: value.message as string,
      related_medicine_sequence_number: nullableNumber(value.related_medicine_sequence_number),
      confidence: nullableNumber(value.confidence),
    });
  });
  const warnings = response.warnings.map((item) => {
    const value = object(item);
    return Object.freeze({
      prescription_id: response.prescription_id,
      code: value.code as string,
      severity: value.severity as "info" | "low" | "medium" | "high",
      message: value.message as string,
      related_medicine_sequence_number: nullableNumber(value.related_medicine_sequence_number),
    });
  });

  return Object.freeze({
    rawResult: Object.freeze({
      prescription_id: response.prescription_id,
      job_id: response.job_id,
      schema_version: response.schema_version,
      status: response.status,
      result_json: rawResponse,
      error_json: null,
    }),
    prescriptionPatch: Object.freeze({
      status: response.status,
      prescription_date: nullableString(prescription.prescription_date),
      doctor_name: nullableString(doctor.name),
      doctor_registration_number: nullableString(doctor.registration_number),
      facility_name: nullableString(facility.name),
      facility_address: nullableString(facility.address),
      facility_phone: nullableString(facility.phone),
      patient_name: nullableString(patient.name),
      patient_age: nullableNumber(patient.age),
      patient_gender: nullableString(patient.gender),
      intelligence_schema_version: "1.0",
      ...(metadata.dataset_version === undefined
        ? {}
        : { intelligence_dataset_version: metadata.dataset_version }),
      ...(metadata.model_version === undefined
        ? {}
        : { intelligence_model_version: metadata.model_version }),
      overall_confidence: metadata.overall_confidence,
      processed_at: input.finalizedAt,
    }),
    medicines: Object.freeze(medicines),
    recommendations: Object.freeze(recommendations),
    warnings: Object.freeze(warnings),
    unsupportedNormalizedFields: Object.freeze([...unsupported]),
  });
}
