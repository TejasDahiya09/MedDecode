import assert from "node:assert/strict";
import test from "node:test";

import {
  IntelligenceResultMappingError,
  mapValidatedIntelligenceResult,
} from "../src/services/intelligence-result.mapper.js";
import type {
  IntelligenceFailureV1,
  IntelligenceSuccessV1,
} from "../src/types/intelligence-contract-v1.js";

const jobId = "30000000-0000-4000-8000-000000000001";
const prescriptionId = "20000000-0000-4000-8000-000000000001";
const finalizedAt = "2026-11-11T12:00:00.000Z";

function medicine(sequence = 1): Record<string, unknown> {
  return {
    sequence_number: sequence,
    extraction: {
      raw_text: "Synthetic medicine line",
      medicine_name: null,
      medicine_name_normalized: null,
      strength: { value: null, unit: null },
      dosage_form: null,
      frequency: {
        type: "unknown",
        morning: null,
        afternoon: null,
        night: null,
        times_per_day: null,
      },
      timing: null,
      duration: { value: null, unit: null },
      quantity: { value: null, unit: null },
      instructions: null,
    },
    confidence: { extraction: null, medicine_name: null, dosage: null },
    medicine_match: {
      status: "unmatched",
      confidence: null,
      medicine_external_id: null,
      brand_name: null,
      dosage_form: null,
      ingredients: [],
    },
    derived: { units_per_day: null, estimated_total_units: null },
    alternatives: [],
  };
}

function success(
  status: "completed" | "completed_with_warnings" = "completed",
): IntelligenceSuccessV1 {
  return {
    schema_version: "1.0",
    job_id: jobId,
    prescription_id: prescriptionId,
    status,
    prescription: {
      prescription_date: null,
      doctor: { name: null, registration_number: null },
      facility: { name: null, address: null, phone: null },
    },
    patient: { name: null, age: null, gender: null },
    medicines: [],
    recommendations: [],
    warnings: [],
    processing_metadata: { overall_confidence: null },
  };
}

function failed(): IntelligenceFailureV1 {
  return {
    schema_version: "1.0",
    job_id: jobId,
    prescription_id: prescriptionId,
    status: "failed",
    error: { code: "PROCESSING_FAILED", message: "Synthetic failure.", retryable: false },
  };
}

test("maps a completed result to existing SQL-backed records without inventing versions", () => {
  const plan = mapValidatedIntelligenceResult({ response: success(), finalizedAt });
  assert.equal(plan.rawResult.status, "completed");
  assert.equal(plan.rawResult.job_id, jobId);
  assert.equal(plan.rawResult.error_json, null);
  assert.deepEqual(plan.medicines, []);
  assert.deepEqual(plan.recommendations, []);
  assert.deepEqual(plan.warnings, []);
  assert.equal(plan.prescriptionPatch.prescription_date, null);
  assert.equal("intelligence_dataset_version" in plan.prescriptionPatch, false);
  assert.equal("intelligence_model_version" in plan.prescriptionPatch, false);
});

test("preserves completed-with-warnings severity and nullable values", () => {
  const response = success("completed_with_warnings");
  response.warnings.push({
    code: "SYNTHETIC_CAUTION",
    severity: "high",
    message: "Synthetic warning.",
    related_medicine_sequence_number: null,
  });
  const plan = mapValidatedIntelligenceResult({ response, finalizedAt });
  assert.equal(plan.prescriptionPatch.status, "completed_with_warnings");
  assert.deepEqual(plan.warnings, [{
    prescription_id: prescriptionId,
    code: "SYNTHETIC_CAUTION",
    severity: "high",
    message: "Synthetic warning.",
    related_medicine_sequence_number: null,
  }]);
});

test("maps a failed response to an immutable raw and structured failure record", () => {
  const response = failed();
  const plan = mapValidatedIntelligenceResult({ response, finalizedAt });
  assert.equal(plan.rawResult.status, "failed");
  assert.deepEqual(plan.rawResult.error_json, response.error);
  assert.equal(plan.prescriptionPatch.status, "failed");
  assert.deepEqual(plan.medicines, []);
});

test("preserves unknown optional fields in raw JSON", () => {
  const response = success();
  response.future_optional = { nested: ["synthetic"] };
  const plan = mapValidatedIntelligenceResult({ response, finalizedAt });
  assert.deepEqual(
    (plan.rawResult.result_json as IntelligenceSuccessV1).future_optional,
    { nested: ["synthetic"] },
  );
});

test("maps multiple medicines in one-based order and preserves nulls", () => {
  const response = success();
  response.medicines.push(medicine(1), medicine(2));
  const plan = mapValidatedIntelligenceResult({ response, finalizedAt });
  assert.deepEqual(plan.medicines.map((item) => item.sequence_number), [1, 2]);
  assert.equal(plan.medicines[0]?.strength_value, null);
  assert.equal(plan.medicines[0]?.frequency_times_per_day, null);
  assert.equal(plan.medicines[0]?.estimated_total_units, null);
});

test("rejects duplicate or out-of-order medicine sequence numbers", () => {
  for (const entries of [[medicine(1), medicine(1)], [medicine(2), medicine(1)]]) {
    const response = success();
    response.medicines.push(...entries);
    assert.throws(() => mapValidatedIntelligenceResult({ response, finalizedAt }));
  }
});

test("does not map a public medicine identifier to an internal UUID", () => {
  const response = success();
  const entry = medicine();
  const match = entry.medicine_match as Record<string, unknown>;
  match.status = "matched";
  match.confidence = 0.9;
  match.medicine_external_id = "public-synthetic-id";
  match.brand_name = "Synthetic brand";
  match.dosage_form = "tablet";
  match.ingredients = [{ name: "Synthetic ingredient", strength_value: 1, strength_unit: "mg" }];
  response.medicines.push(entry);
  const plan = mapValidatedIntelligenceResult({ response, finalizedAt });
  assert.equal("medicine_id" in plan.medicines[0]!, false);
  assert.deepEqual(plan.unsupportedNormalizedFields, [
    "medicines[].medicine_match.medicine_external_id",
    "medicines[].medicine_match.brand_name",
    "medicines[].medicine_match.dosage_form",
    "medicines[].medicine_match.ingredients",
  ]);
  assert.deepEqual(
    ((plan.rawResult.result_json as IntelligenceSuccessV1).medicines[0] as Record<string, unknown>)
      .medicine_match,
    entry.medicine_match,
  );
});

test("accepts a missing public external identifier without fabricating one", () => {
  const response = success();
  response.medicines.push(medicine());
  const plan = mapValidatedIntelligenceResult({ response, finalizedAt });
  assert.deepEqual(plan.unsupportedNormalizedFields, []);
  assert.equal("medicine_external_id" in plan.medicines[0]!, false);
});

test("accepts empty alternatives and rejects every non-empty alternative array", () => {
  const empty = success();
  empty.medicines.push(medicine());
  assert.doesNotThrow(() => mapValidatedIntelligenceResult({ response: empty, finalizedAt }));

  const nonEmpty = success();
  const entry = medicine();
  entry.alternatives = [{
    medicine_external_id: "synthetic-alternative",
    brand_name: "Synthetic alternative",
    match_basis: {
      ingredient_equivalent: true,
      strength_compatibility: true,
      dosage_form_compatibility: true,
    },
    confidence: 0.8,
    note: null,
  }];
  nonEmpty.medicines.push(entry);
  assert.throws(
    () => mapValidatedIntelligenceResult({ response: nonEmpty, finalizedAt }),
    (error: unknown) => error instanceof IntelligenceResultMappingError &&
      error.code === "ALTERNATIVES_CONTRACT_UNRESOLVED",
  );
});

test("returns immutable detached raw snapshots rather than mutating the validated response", () => {
  const response = success();
  const plan = mapValidatedIntelligenceResult({ response, finalizedAt });
  response.status = "completed_with_warnings";
  assert.equal(plan.rawResult.result_json.status, "completed");
  assert.equal(Object.isFrozen(plan.rawResult.result_json), true);
  (plan.rawResult.result_json as { status: string }).status = "failed";
  assert.equal(plan.rawResult.result_json.status, "completed");
});
