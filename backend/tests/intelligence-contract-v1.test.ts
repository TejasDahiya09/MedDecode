import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  IntelligenceContractValidationError,
  validateIntelligenceRequestV1,
  validateIntelligenceResponseV1,
} from "../src/services/intelligence-contract-v1.validator.js";

const fixtureDirectory = join(process.cwd(), "tests", "fixtures", "intelligence");
const load = async (name: string): Promise<unknown> => JSON.parse(await readFile(join(fixtureDirectory, name), "utf8"));
const expected = {
  jobId: "11111111-1111-4111-8111-111111111111",
  prescriptionId: "22222222-2222-4222-8222-222222222222",
};

test("accepts the Phase 5.2 authorized URL request", async () => {
  const request = validateIntelligenceRequestV1(await load("request-valid.json"));
  assert.equal(request.document.access_type, "authorized_url");
});
test("rejects direct_upload because its binary representation is unspecified", async () => {
  const value = await load("request-invalid-direct-upload.json");
  assert.throws(
    () => validateIntelligenceRequestV1(value),
    IntelligenceContractValidationError,
  );
});

test("rejects missing Phase 5.2 feature flags", async () => {
  const request = await load("request-valid.json") as Record<string, unknown>;
  delete (request.requested_analysis as Record<string, unknown>).match_medicines;
  assert.throws(() => validateIntelligenceRequestV1(request), IntelligenceContractValidationError);
});

test("rejects unsupported schema version, invalid UUID, missing document and unsupported MIME", async () => {
  const base = await load("request-valid.json") as Record<string, unknown>;
  assert.throws(() => validateIntelligenceRequestV1({ ...base, schema_version: "2.0" }), IntelligenceContractValidationError);
  assert.throws(() => validateIntelligenceRequestV1({ ...base, job_id: "not-a-uuid" }), IntelligenceContractValidationError);
  const { document: _document, ...withoutDocument } = base;
  assert.throws(() => validateIntelligenceRequestV1(withoutDocument), IntelligenceContractValidationError);
  const badMime = structuredClone(base);
  (badMime.document as Record<string, unknown>).file_type = "text/html";
  assert.throws(() => validateIntelligenceRequestV1(badMime), IntelligenceContractValidationError);
});

test("requires file_url for authorized_url requests", async () => {
  const request = await load("request-valid.json") as Record<string, unknown>;
  delete (request.document as Record<string, unknown>).file_url;
  assert.throws(() => validateIntelligenceRequestV1(request), IntelligenceContractValidationError);
});

test("accepts the exact synthetic success envelope", async () => {
  const response = validateIntelligenceResponseV1(await load("response-success.json"), expected);
  assert.equal(response.status, "completed");
});

test("accepts a contract failure envelope", async () => {
  const response = validateIntelligenceResponseV1(await load("response-failure.json"), expected);
  assert.equal(response.status, "failed");
});

test("accepts completed-with-warnings with ordered medicines and null-containing objects", async () => {
  const response = validateIntelligenceResponseV1(await load("response-completed-with-warnings.json"), expected);
  assert.equal(response.status, "completed_with_warnings");
});

test("rejects medicine ordering, match status and warning severity violations", async () => {
  const ordering = await load("response-completed-with-warnings.json") as Record<string, unknown>;
  ((ordering.medicines as Record<string, unknown>[])[1] as Record<string, unknown>).sequence_number = 3;
  assert.throws(() => validateIntelligenceResponseV1(ordering, expected), IntelligenceContractValidationError);

  const match = await load("response-completed-with-warnings.json") as Record<string, unknown>;
  (((match.medicines as Record<string, unknown>[])[0] as Record<string, unknown>).medicine_match as Record<string, unknown>).status = "invented";
  assert.throws(() => validateIntelligenceResponseV1(match, expected), IntelligenceContractValidationError);

  const warning = await load("response-completed-with-warnings.json") as Record<string, unknown>;
  ((warning.warnings as Record<string, unknown>[])[0] as Record<string, unknown>).severity = "critical";
  assert.throws(() => validateIntelligenceResponseV1(warning, expected), IntelligenceContractValidationError);
});

test("validates alternative compatibility fields", async () => {
  const response = await load("response-completed-with-warnings.json") as Record<string, unknown>;
  const medicine = (response.medicines as Record<string, unknown>[])[0] as Record<string, unknown>;
  medicine.alternatives = [{
    medicine_external_id: "synthetic-external-id",
    brand_name: "Synthetic Alternative",
    match_basis: { ingredient_equivalent: true, strength_compatibility: true, dosage_form_compatibility: false },
    confidence: 0.5,
  }];
  assert.equal(validateIntelligenceResponseV1(response, expected).status, "completed_with_warnings");
  ((medicine.alternatives as Record<string, unknown>[])[0]!.match_basis as Record<string, unknown>).ingredient_equivalent = "yes";
  assert.throws(() => validateIntelligenceResponseV1(response, expected), IntelligenceContractValidationError);
});
test("accepts absent optional version and alternative price fields", async () => {
  const response = await load("response-success.json") as Record<string, unknown>;
  delete (response.processing_metadata as Record<string, unknown>).dataset_version;
  delete (response.processing_metadata as Record<string, unknown>).model_version;
  assert.equal(validateIntelligenceResponseV1(response, expected).status, "completed");
});

test("accepts exactly all four documented failure codes", async () => {
  for (const code of ["UNSUPPORTED_FILE", "DOCUMENT_ACCESS_FAILED", "INVALID_REQUEST", "PROCESSING_FAILED"]) {
    const response = await load("response-failure.json") as Record<string, unknown>;
    (response.error as Record<string, unknown>).code = code;
    assert.equal(validateIntelligenceResponseV1(response, expected).status, "failed");
  }
  const response = await load("response-failure.json") as Record<string, unknown>;
  (response.error as Record<string, unknown>).code = "TRANSPORT_FAILED";
  assert.throws(() => validateIntelligenceResponseV1(response, expected), IntelligenceContractValidationError);
});

test("rejects response correlation mismatch", async () => {
  const value = await load("response-wrong-correlation.json");
  assert.throws(
    () => validateIntelligenceResponseV1(value, expected),
    IntelligenceContractValidationError,
  );
});

test("rejects prescription correlation mismatch independently", async () => {
  const value = await load("response-success.json") as Record<string, unknown>;
  value.prescription_id = "33333333-3333-4333-8333-333333333333";
  assert.throws(() => validateIntelligenceResponseV1(value, expected), IntelligenceContractValidationError);
});

test("allows backward-compatible optional response properties", async () => {
  const response = await load("response-success.json") as Record<string, unknown>;
  response.future_optional_field = { safe: true };
  assert.equal(validateIntelligenceResponseV1(response, expected).status, "completed");
});

test("rejects confidence outside the contract range", async () => {
  const response = await load("response-success.json") as Record<string, unknown>;
  (response.processing_metadata as Record<string, unknown>).overall_confidence = 1.1;
  assert.throws(() => validateIntelligenceResponseV1(response, expected), IntelligenceContractValidationError);
});
