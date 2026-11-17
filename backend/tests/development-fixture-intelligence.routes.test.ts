import assert from "node:assert/strict";
import express from "express";
import test from "node:test";
import request from "supertest";

import { createDevelopmentFixtureIntelligenceRouter } from "../src/routes/development-fixture-intelligence.routes.js";
import { errorHandler, notFoundHandler } from "../src/middleware/error.middleware.js";
import type { UserSupabaseClient } from "../src/config/supabase-user.js";
import type { AuthVerifier, VerifiedIdentity } from "../src/services/auth.service.js";
import type { IntelligenceClient } from "../src/services/intelligence-client.js";
import type { IntelligenceRequestV1, IntelligenceResponseV1 } from "../src/types/intelligence-contract-v1.js";

const userId = "00000000-0000-4000-8000-000000000001";
const response: IntelligenceResponseV1 = {
  schema_version: "1.0", job_id: "10000000-0000-4000-8000-000000000020", prescription_id: "10000000-0000-4000-8000-000000000021", status: "completed_with_warnings",
  prescription: { prescription_date: null, doctor: { name: null, registration_number: null }, facility: { name: null, address: null, phone: null } },
  patient: { name: null, age: null, gender: null },
  medicines: [{ sequence_number: 1, extraction: { raw_text: "Examplemed 10 mg", frequency: { type: "unknown" }, duration: { value: null, unit: null }, quantity: { value: null, unit: null } }, confidence: {}, medicine_match: { status: "matched", confidence: 1, medicine_external_id: null, brand_name: "Examplemed", dosage_form: "tablet", ingredients: [] }, derived: { units_per_day: null, estimated_total_units: null }, alternatives: [] }],
  recommendations: [], warnings: [{ code: "DEVELOPMENT_FIXTURE_INJECTED_OCR", severity: "info", message: "fixture", related_medicine_sequence_number: null }], processing_metadata: { overall_confidence: null },
};

class Verifier implements AuthVerifier {
  async verifyAccessToken(token: string): Promise<VerifiedIdentity> {
    if (token === "valid") return { userId };
    throw new Error("invalid");
  }
}

function harness(client: IntelligenceClient) {
  const app = express();
  app.use(express.json());
  app.use(createDevelopmentFixtureIntelligenceRouter(
    new Verifier(), () => client, () => ({ marker: "scoped" } as unknown as UserSupabaseClient),
  ));
  app.use(notFoundHandler); app.use(errorHandler);
  return app;
}

test("requires authentication before starting the development fixture", async () => {
  let calls = 0;
  const app = harness({ analyze: async () => { calls++; return response; } });
  const result = await request(app).post("/api/v1/development/fictional-intelligence-result").send({});
  assert.equal(result.status, 401); assert.equal(calls, 0);
});

test("returns only the validated, fixed fictional fixture Contract v1 response", async () => {
  let received: IntelligenceRequestV1 | undefined;
  const app = harness({ analyze: async requestValue => { received = requestValue; return response; } });
  const result = await request(app).post("/api/v1/development/fictional-intelligence-result").set("Authorization", "Bearer valid").send({});
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, response);
  assert.equal(received?.document.file_url, "https://development.invalid/fictional-fixture.pdf");
  assert.equal(received?.prescription_id, response.prescription_id);
});

test("rejects request fields and safely maps fixture execution failures", async () => {
  const app = harness({ analyze: async () => { throw new Error("private provider detail"); } });
  const invalid = await request(app).post("/api/v1/development/fictional-intelligence-result").set("Authorization", "Bearer valid").send({ path: "C:\\private.pdf" });
  assert.equal(invalid.status, 400); assert.equal(invalid.body.error.code, "INVALID_DEVELOPMENT_FIXTURE_REQUEST");
  const failed = await request(app).post("/api/v1/development/fictional-intelligence-result").set("Authorization", "Bearer valid").send({});
  assert.equal(failed.status, 503); assert.equal(failed.body.error.code, "DEVELOPMENT_FIXTURE_UNAVAILABLE");
  assert.doesNotMatch(JSON.stringify(failed.body), /private|provider/i);
});
