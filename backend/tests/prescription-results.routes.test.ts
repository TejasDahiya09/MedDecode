import assert from "node:assert/strict";
import { describe, it } from "node:test";

import request from "supertest";

import { createApp } from "../src/app.js";
import type { UserSupabaseClient, UserSupabaseClientFactory } from "../src/config/supabase-user.js";
import type {
  OwnedPrescriptionForResults,
  PrescriptionIntelligenceResultRow,
  PrescriptionResultsRepository
} from "../src/repositories/prescription-results.repository.js";
import type { ProfileRepository } from "../src/repositories/profile.repository.js";
import type { AuthVerifier, VerifiedIdentity } from "../src/services/auth.service.js";

const userId = "00000000-0000-4000-8000-000000000001";
const otherUserId = "00000000-0000-4000-8000-000000000002";
const prescriptionId = "10000000-0000-4000-8000-000000000001";
const jobId = "20000000-0000-4000-8000-000000000002";

class TokenVerifier implements AuthVerifier {
  constructor(private readonly identities: Readonly<Record<string, VerifiedIdentity>>) {}
  async verifyAccessToken(token: string): Promise<VerifiedIdentity> {
    const identity = this.identities[token];
    if (!identity) throw new Error("invalid test token");
    return identity;
  }
}

class ResultRepositoryProbe implements PrescriptionResultsRepository {
  prescription: OwnedPrescriptionForResults | null = {
    id: prescriptionId, user_id: userId, status: "completed_with_warnings"
  };
  result: PrescriptionIntelligenceResultRow | null = null;
  failure: Error | null = null;
  readonly prescriptionCalls: Array<{ userId: string; prescriptionId: string }> = [];
  readonly resultCalls: string[] = [];

  async findOwnedPrescription(_client: UserSupabaseClient, owner: string, id: string) {
    this.prescriptionCalls.push({ userId: owner, prescriptionId: id });
    if (this.failure) throw this.failure;
    return this.prescription;
  }

  async findOwnedResult(_client: UserSupabaseClient, id: string) {
    this.resultCalls.push(id);
    if (this.failure) throw this.failure;
    return this.result;
  }
}

const unusedProfileRepository = {
  async findApplicationUser() { throw new Error("not used"); },
  async findHealthProfile() { throw new Error("not used"); },
  async updateApplicationUser() { throw new Error("not used"); },
  async createHealthProfile() { throw new Error("not used"); },
  async updateHealthProfile() { throw new Error("not used"); }
} as ProfileRepository;

function resultJson(): Record<string, unknown> {
  return {
    schema_version: "1.0", job_id: jobId, prescription_id: prescriptionId,
    status: "completed_with_warnings",
    prescription: { prescription_date: null, doctor: { name: null, registration_number: null }, facility: { name: null, address: null, phone: null } },
    patient: { name: null, age: null, gender: null }, medicines: [], recommendations: [],
    warnings: [{ code: "LOW_CONFIDENCE", severity: "low", message: "Verification is needed.", related_medicine_sequence_number: null }],
    processing_metadata: { overall_confidence: null }
  };
}

function storedResult(overrides: Partial<PrescriptionIntelligenceResultRow> = {}): PrescriptionIntelligenceResultRow {
  return {
    prescription_id: prescriptionId, job_id: jobId, schema_version: "1.0",
    status: "completed_with_warnings", result_json: resultJson(), ...overrides
  };
}

function harness() {
  const verifier = new TokenVerifier({ token: { userId } });
  const repository = new ResultRepositoryProbe();
  const factory: UserSupabaseClientFactory = () => ({ marker: "request-client" } as unknown as UserSupabaseClient);
  const app = createApp(
    undefined, verifier, factory, unusedProfileRepository,
    () => { throw new Error("upload dependencies must not be constructed"); },
    undefined, undefined, undefined, undefined, repository
  );
  return { app, repository };
}

const path = `/api/v1/prescriptions/${prescriptionId}/results`;
const auth = { Authorization: "Bearer token" };

describe("Authenticated prescription results API", () => {
  it("returns the exact validated Contract v1 success response for its owner", async () => {
    const current = harness();
    current.repository.result = storedResult();
    const response = await request(current.app).get(path).set(auth);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, resultJson());
    assert.deepEqual(current.repository.prescriptionCalls, [{ userId, prescriptionId }]);
    assert.deepEqual(current.repository.resultCalls, [prescriptionId]);
  });

  it("rejects missing/invalid authentication before querying", async () => {
    for (const authorization of [undefined, "Bearer invalid"]) {
      const current = harness();
      let pending = request(current.app).get(path);
      if (authorization) pending = pending.set("Authorization", authorization);
      const response = await pending;
      assert.equal(response.status, 401);
      assert.deepEqual(current.repository.prescriptionCalls, []);
      assert.deepEqual(current.repository.resultCalls, []);
    }
  });

  it("makes non-owned and missing prescriptions indistinguishable", async () => {
    const bodies: unknown[] = [];
    for (const record of [null, { id: prescriptionId, user_id: otherUserId, status: "completed" } as OwnedPrescriptionForResults]) {
      const current = harness();
      current.repository.prescription = record;
      const response = await request(current.app).get(path).set(auth);
      assert.equal(response.status, 404);
      bodies.push(response.body);
      assert.deepEqual(current.repository.resultCalls, []);
    }
    assert.deepEqual(bodies[0], bodies[1]);
    assert.deepEqual(bodies[0], { error: { code: "PRESCRIPTION_NOT_FOUND", message: "Prescription not found." } });
  });

  it("reports pending processing and absent completed results without fabrication", async () => {
    const pending = harness();
    pending.repository.prescription = { id: prescriptionId, user_id: userId, status: "processing" };
    const pendingResponse = await request(pending.app).get(path).set(auth);
    assert.equal(pendingResponse.status, 409);
    assert.equal(pendingResponse.body.error.code, "PROCESSING_PENDING");
    assert.deepEqual(pending.repository.resultCalls, []);

    const unavailable = harness();
    unavailable.repository.result = null;
    const unavailableResponse = await request(unavailable.app).get(path).set(auth);
    assert.equal(unavailableResponse.status, 404);
    assert.equal(unavailableResponse.body.error.code, "RESULT_UNAVAILABLE");
  });

  it("never exposes a result for a terminal failed prescription", async () => {
    const current = harness();
    current.repository.prescription = { id: prescriptionId, user_id: userId, status: "failed" };
    current.repository.result = storedResult();
    const response = await request(current.app).get(path).set(auth);
    assert.equal(response.status, 404);
    assert.equal(response.body.error.code, "RESULT_UNAVAILABLE");
    assert.deepEqual(current.repository.resultCalls, []);
  });

  it("rejects malformed stored results and redacts provider failures", async () => {
    const malformed = harness();
    malformed.repository.result = storedResult({ result_json: { private: "bad" } });
    const malformedResponse = await request(malformed.app).get(path).set(auth);
    assert.equal(malformedResponse.status, 500);
    assert.equal(malformedResponse.body.error.code, "STORED_RESULT_INVALID");
    assert.doesNotMatch(JSON.stringify(malformedResponse.body), /private|bad/i);

    const failure = harness();
    failure.repository.failure = new Error("private S3 key and provider diagnostic");
    const failureResponse = await request(failure.app).get(path).set(auth);
    assert.equal(failureResponse.status, 500);
    assert.doesNotMatch(JSON.stringify(failureResponse.body), /S3|diagnostic|private/i);
  });

  it("rejects malformed IDs before database access", async () => {
    const current = harness();
    const response = await request(current.app)
      .get("/api/v1/prescriptions/not-a-uuid/results")
      .set(auth);
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, "INVALID_PRESCRIPTION_ID");
    assert.deepEqual(current.repository.prescriptionCalls, []);
  });
});
