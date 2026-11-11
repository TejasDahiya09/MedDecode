import type {
  IntelligenceResponseV1,
  IntelligenceSuccessV1,
  Phase52IntelligenceRequestV1,
} from "../types/intelligence-contract-v1.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FILE_TYPES = new Set(["image/jpeg", "image/png", "application/pdf"]);
const ERROR_CODES = new Set([
  "UNSUPPORTED_FILE",
  "DOCUMENT_ACCESS_FAILED",
  "INVALID_REQUEST",
  "PROCESSING_FAILED",
]);

export class IntelligenceContractValidationError extends Error {
  readonly code = "INTELLIGENCE_CONTRACT_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "IntelligenceContractValidationError";
  }
}
function fail(message: string): never {
  throw new IntelligenceContractValidationError(message);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(`${path} must be an object.`);
  return value as Record<string, unknown>;
}

function string(value: unknown, path: string, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== "string") fail(`${path} must be a string${nullable ? " or null" : ""}.`);
  return value;
}

function number(value: unknown, path: string, nullable = false): number | null {
  if (nullable && value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${path} must be a finite number${nullable ? " or null" : ""}.`);
  return value;
}

function confidence(value: unknown, path: string): void {
  const parsed = number(value, path, true);
  if (parsed !== null && (parsed < 0 || parsed > 1)) fail(`${path} must be between 0 and 1.`);
}

function uuid(value: unknown, path: string): string {
  const parsed = string(value, path);
  if (!UUID_PATTERN.test(parsed as string)) fail(`${path} must be a UUID.`);
  return parsed as string;
}

function exactBoolean(value: unknown, path: string): void {
  if (typeof value !== "boolean") fail(`${path} must be a boolean.`);
}

function nullableString(value: unknown, path: string): void {
  string(value, path, true);
}

function valueUnit(value: unknown, path: string): void {
  const item = record(value, path);
  number(item.value, `${path}.value`, true);
  nullableString(item.unit, `${path}.unit`);
}

export function validateIntelligenceRequestV1(value: unknown): Phase52IntelligenceRequestV1 {
  const root = record(value, "request");
  if (root.schema_version !== "1.0") fail("request.schema_version must be 1.0.");
  uuid(root.job_id, "request.job_id");
  uuid(root.prescription_id, "request.prescription_id");

  const document = record(root.document, "request.document");
  if (document.access_type !== "authorized_url") {
    fail("request.document.access_type must be authorized_url for the Phase 5.2 adapter.");
  }
  const fileUrl = string(document.file_url, "request.document.file_url") as string;
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(fileUrl);
  } catch {
    fail("request.document.file_url must be a valid URL.");
  }
  if (parsedUrl.protocol !== "https:") fail("request.document.file_url must use HTTPS.");
  if (!FILE_TYPES.has(document.file_type as string)) fail("request.document.file_type is unsupported.");
  if (document.original_filename !== undefined) string(document.original_filename, "request.document.original_filename");

  const requested = record(root.requested_analysis, "request.requested_analysis");
  for (const key of ["extract_prescription", "match_medicines", "find_alternatives", "generate_recommendations"] as const) {
    exactBoolean(requested[key], `request.requested_analysis.${key}`);
  }
  return root as unknown as Phase52IntelligenceRequestV1;
}

function validateMedicine(value: unknown, index: number): void {
  const path = `response.medicines[${index}]`;
  const item = record(value, path);
  if (!Number.isInteger(item.sequence_number) || (item.sequence_number as number) < 1) fail(`${path}.sequence_number must be a positive integer.`);
  const extraction = record(item.extraction, `${path}.extraction`);
  string(extraction.raw_text, `${path}.extraction.raw_text`);
  if (extraction.medicine_name !== undefined) nullableString(extraction.medicine_name, `${path}.extraction.medicine_name`);
  if (extraction.medicine_name_normalized !== undefined) nullableString(extraction.medicine_name_normalized, `${path}.extraction.medicine_name_normalized`);
  if (extraction.strength !== undefined) valueUnit(extraction.strength, `${path}.extraction.strength`);
  if (extraction.dosage_form !== undefined) nullableString(extraction.dosage_form, `${path}.extraction.dosage_form`);
  const frequency = record(extraction.frequency, `${path}.extraction.frequency`);
  if (!new Set(["scheduled", "as_needed", "unknown"]).has(frequency.type as string)) fail(`${path}.extraction.frequency.type is invalid.`);
  for (const frequencyKey of ["morning", "afternoon", "night", "times_per_day"] as const) {
    if (frequency[frequencyKey] !== undefined) number(frequency[frequencyKey], `${path}.extraction.frequency.${frequencyKey}`, true);
  }
  if (extraction.timing !== undefined) nullableString(extraction.timing, `${path}.extraction.timing`);
  valueUnit(extraction.duration, `${path}.extraction.duration`);
  valueUnit(extraction.quantity, `${path}.extraction.quantity`);
  if (extraction.instructions !== undefined) nullableString(extraction.instructions, `${path}.extraction.instructions`);

  const confidences = record(item.confidence, `${path}.confidence`);
  for (const [key, entry] of Object.entries(confidences)) confidence(entry, `${path}.confidence.${key}`);

  const match = record(item.medicine_match, `${path}.medicine_match`);
  if (!new Set(["matched", "probable_match", "ambiguous", "unmatched", "not_attempted"]).has(match.status as string)) fail(`${path}.medicine_match.status is invalid.`);
  confidence(match.confidence, `${path}.medicine_match.confidence`);
  nullableString(match.medicine_external_id, `${path}.medicine_match.medicine_external_id`);
  nullableString(match.brand_name, `${path}.medicine_match.brand_name`);
  nullableString(match.dosage_form, `${path}.medicine_match.dosage_form`);
  if (!Array.isArray(match.ingredients)) fail(`${path}.medicine_match.ingredients must be an array.`);
  for (const [ingredientIndex, ingredientValue] of match.ingredients.entries()) {
    const ingredient = record(ingredientValue, `${path}.medicine_match.ingredients[${ingredientIndex}]`);
    string(ingredient.name, `${path}.medicine_match.ingredients[${ingredientIndex}].name`);
    number(ingredient.strength_value, `${path}.medicine_match.ingredients[${ingredientIndex}].strength_value`);
    string(ingredient.strength_unit, `${path}.medicine_match.ingredients[${ingredientIndex}].strength_unit`);
  }

  const derived = record(item.derived, `${path}.derived`);
  number(derived.units_per_day, `${path}.derived.units_per_day`, true);
  number(derived.estimated_total_units, `${path}.derived.estimated_total_units`, true);
  if (!Array.isArray(item.alternatives)) fail(`${path}.alternatives must be an array.`);
  for (const [alternativeIndex, alternativeValue] of item.alternatives.entries()) {
    const alternativePath = `${path}.alternatives[${alternativeIndex}]`;
    const alternative = record(alternativeValue, alternativePath);
    string(alternative.medicine_external_id, `${alternativePath}.medicine_external_id`);
    string(alternative.brand_name, `${alternativePath}.brand_name`);
    const basis = record(alternative.match_basis, `${alternativePath}.match_basis`);
    exactBoolean(basis.ingredient_equivalent, `${alternativePath}.match_basis.ingredient_equivalent`);
    exactBoolean(basis.strength_compatibility, `${alternativePath}.match_basis.strength_compatibility`);
    exactBoolean(basis.dosage_form_compatibility, `${alternativePath}.match_basis.dosage_form_compatibility`);
    if (alternative.price !== undefined) {
      const price = record(alternative.price, `${alternativePath}.price`);
      if (price.value !== undefined) number(price.value, `${alternativePath}.price.value`, true);
      if (price.currency !== undefined) nullableString(price.currency, `${alternativePath}.price.currency`);
      if (price.unit_description !== undefined) nullableString(price.unit_description, `${alternativePath}.price.unit_description`);
    }
    confidence(alternative.confidence, `${alternativePath}.confidence`);
    if (alternative.note !== undefined) nullableString(alternative.note, `${alternativePath}.note`);
  }
}

function validateSuccess(root: Record<string, unknown>): IntelligenceSuccessV1 {
  const prescription = record(root.prescription, "response.prescription");
  nullableString(prescription.prescription_date, "response.prescription.prescription_date");
  const doctor = record(prescription.doctor, "response.prescription.doctor");
  nullableString(doctor.name, "response.prescription.doctor.name");
  nullableString(doctor.registration_number, "response.prescription.doctor.registration_number");
  const facility = record(prescription.facility, "response.prescription.facility");
  nullableString(facility.name, "response.prescription.facility.name");
  nullableString(facility.address, "response.prescription.facility.address");
  nullableString(facility.phone, "response.prescription.facility.phone");

  const patient = record(root.patient, "response.patient");
  nullableString(patient.name, "response.patient.name");
  if (patient.age !== null && !Number.isInteger(patient.age)) fail("response.patient.age must be an integer or null.");
  nullableString(patient.gender, "response.patient.gender");

  if (!Array.isArray(root.medicines)) fail("response.medicines must be an array.");
  root.medicines.forEach(validateMedicine);
  root.medicines.forEach((medicine, index) => {
    if ((medicine as Record<string, unknown>).sequence_number !== index + 1) fail("response.medicines sequence numbers must be ordered from 1.");
  });
  if (!Array.isArray(root.recommendations)) fail("response.recommendations must be an array.");
  for (const [index, recommendationValue] of root.recommendations.entries()) {
    const recommendation = record(recommendationValue, `response.recommendations[${index}]`);
    string(recommendation.type, `response.recommendations[${index}].type`);
    string(recommendation.title, `response.recommendations[${index}].title`);
    string(recommendation.message, `response.recommendations[${index}].message`);
    if (recommendation.related_medicine_sequence_number !== null && (!Number.isInteger(recommendation.related_medicine_sequence_number) || (recommendation.related_medicine_sequence_number as number) < 1)) {
      fail(`response.recommendations[${index}].related_medicine_sequence_number must be a positive integer or null.`);
    }
    confidence(recommendation.confidence, `response.recommendations[${index}].confidence`);
  }
  if (!Array.isArray(root.warnings)) fail("response.warnings must be an array.");
  for (const [index, warningValue] of root.warnings.entries()) {
    const warning = record(warningValue, `response.warnings[${index}]`);
    string(warning.code, `response.warnings[${index}].code`);
    if (!new Set(["info", "low", "medium", "high"]).has(warning.severity as string)) fail(`response.warnings[${index}].severity is invalid.`);
    string(warning.message, `response.warnings[${index}].message`);
    if (warning.related_medicine_sequence_number !== null && (!Number.isInteger(warning.related_medicine_sequence_number) || (warning.related_medicine_sequence_number as number) < 1)) {
      fail(`response.warnings[${index}].related_medicine_sequence_number must be a positive integer or null.`);
    }
  }
  const metadata = record(root.processing_metadata, "response.processing_metadata");
  confidence(metadata.overall_confidence, "response.processing_metadata.overall_confidence");
  if (metadata.dataset_version !== undefined) string(metadata.dataset_version, "response.processing_metadata.dataset_version");
  if (metadata.model_version !== undefined) string(metadata.model_version, "response.processing_metadata.model_version");
  return root as unknown as IntelligenceSuccessV1;
}

export function validateIntelligenceResponseV1(value: unknown, expected: { jobId: string; prescriptionId: string }): IntelligenceResponseV1 {
  const root = record(value, "response");
  if (root.schema_version !== "1.0") fail("response.schema_version must be 1.0.");
  const jobId = uuid(root.job_id, "response.job_id");
  const prescriptionId = uuid(root.prescription_id, "response.prescription_id");
  if (jobId !== expected.jobId || prescriptionId !== expected.prescriptionId) fail("response correlation identifiers do not match the request.");

  if (root.status === "failed") {
    const error = record(root.error, "response.error");
    if (!ERROR_CODES.has(error.code as string)) fail("response.error.code is invalid.");
    string(error.message, "response.error.message");
    exactBoolean(error.retryable, "response.error.retryable");
    return root as unknown as IntelligenceResponseV1;
  }
  if (root.status !== "completed" && root.status !== "completed_with_warnings") fail("response.status is invalid.");
  return validateSuccess(root);
}
