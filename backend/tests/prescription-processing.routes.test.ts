import assert from "node:assert/strict";
import { describe, it } from "node:test";
import request from "supertest";

import { createApp } from "../src/app.js";
import type { UserSupabaseClient, UserSupabaseClientFactory } from "../src/config/supabase-user.js";
import type { ProcessingJobStoreFactory } from "../src/repositories/processing-job.store.js";
import type { AuthVerifier, VerifiedIdentity } from "../src/services/auth.service.js";
import { InMemoryProcessingJobStore } from "./support/in-memory-processing-job-store.js";

const userId = "00000000-0000-4000-8000-000000000001";
const otherUserId = "00000000-0000-4000-8000-000000000002";
const prescriptionId = "10000000-0000-4000-8000-000000000001";
const missingId = "10000000-0000-4000-8000-000000000099";
const jobId = "20000000-0000-4000-8000-000000000001";
const timestamp = "2026-11-11T12:00:00.000Z";
const auth = { Authorization: "Bearer owner-token" };

class TokenVerifier implements AuthVerifier {
  async verifyAccessToken(token: string): Promise<VerifiedIdentity> {
    if (token === "owner-token") return { userId };
    if (token === "other-token") return { userId: otherUserId };
    throw new Error("invalid synthetic token");
  }
}

function harness(configured = true) {
  const store = new InMemoryProcessingJobStore({ now: () => timestamp, uuid: () => jobId });
  store.own(userId, prescriptionId);
  const client = { marker: "user-client" } as unknown as UserSupabaseClient;
  const tokens: string[] = [];
  const clientFactory: UserSupabaseClientFactory = (token) => {
    tokens.push(token);
    return client;
  };
  const stores: UserSupabaseClient[] = [];
  const storeFactory: ProcessingJobStoreFactory | undefined = configured
    ? (receivedClient) => { stores.push(receivedClient); return store; }
    : undefined;
  const app = createApp(
    undefined, new TokenVerifier(), clientFactory, undefined, undefined,
    undefined, undefined, undefined, storeFactory
  );
  return { app, store, client, tokens, stores };
}

describe("Prescription processing APIs", () => {
  it("authenticates before constructing or using the store", async () => {
    for (const method of ["post", "get"] as const) {
      for (const authorization of [undefined, "Bearer invalid"]) {
        const current = harness();
        const path = method === "post"
          ? `/api/v1/prescriptions/${prescriptionId}/process`
          : `/api/v1/prescriptions/${prescriptionId}/processing-status`;
        let pending = request(current.app)[method](path);
        if (authorization) pending = pending.set("Authorization", authorization);
        const response = await pending;
        assert.equal(response.status, 401);
        assert.deepEqual(current.stores, []);
        assert.deepEqual(current.store.submissions, []);
        assert.deepEqual(current.store.statusReads, []);
      }
    }
  });

  it("persists an owner submission before returning queued", async () => {
    const current = harness();
    const response = await request(current.app)
      .post(`/api/v1/prescriptions/${prescriptionId}/process`).set(auth).send({});
    assert.equal(response.status, 202);
    assert.deepEqual(response.body, {
      prescription_id: prescriptionId,
      job: { id: jobId, status: "queued", created_at: timestamp },
      submission: { created: true }
    });
    assert.deepEqual(current.store.submissions[0], {
      userId, prescriptionId,
      requestedAnalysis: {
        extract_prescription: true, match_medicines: true,
        find_alternatives: false, generate_recommendations: true
      }
    });
    assert.equal(current.stores[0], current.client);
    assert.deepEqual(current.tokens, ["owner-token"]);
    assert.doesNotMatch(JSON.stringify(response.body), /ocr|medicine|warning|recommendation|progress/i);
  });

  it("returns one stable job for duplicate concurrent submissions", async () => {
    const current = harness();
    const [first, second] = await Promise.all([
      request(current.app).post(`/api/v1/prescriptions/${prescriptionId}/process`).set(auth).send({}),
      request(current.app).post(`/api/v1/prescriptions/${prescriptionId}/process`).set(auth).send({})
    ]);
    assert.deepEqual([first.status, second.status].sort(), [200, 202]);
    assert.equal(first.body.job.id, jobId);
    assert.equal(second.body.job.id, jobId);
  });

  it("returns an existing processing job honestly", async () => {
    const current = harness();
    await request(current.app).post(`/api/v1/prescriptions/${prescriptionId}/process`).set(auth).send({});
    current.store.setStatus(userId, prescriptionId, "processing");
    const response = await request(current.app)
      .post(`/api/v1/prescriptions/${prescriptionId}/process`).set(auth).send({});
    assert.equal(response.status, 200);
    assert.equal(response.body.job.status, "processing");
    assert.equal(response.body.submission.created, false);
  });

  it("rejects invalid IDs, missing/non-owned records, and request fields", async () => {
    const invalid = harness();
    const invalidResponse = await request(invalid.app)
      .post("/api/v1/prescriptions/not-a-uuid/process").set(auth).send({});
    assert.equal(invalidResponse.status, 400);
    assert.equal(invalidResponse.body.error.code, "INVALID_PRESCRIPTION_ID");
    assert.deepEqual(invalid.store.submissions, []);

    for (const [token, id] of [["owner-token", missingId], ["other-token", prescriptionId]]) {
      const current = harness();
      const response = await request(current.app)
        .post(`/api/v1/prescriptions/${id}/process`)
        .set("Authorization", `Bearer ${token}`).send({});
      assert.equal(response.status, 404);
      assert.equal(response.body.error.code, "PRESCRIPTION_NOT_FOUND");
    }

    const unexpected = harness();
    const response = await request(unexpected.app)
      .post(`/api/v1/prescriptions/${prescriptionId}/process`)
      .set(auth).send({ job_id: "caller-controlled" });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, "INVALID_PROCESSING_REQUEST");
    assert.deepEqual(unexpected.store.submissions, []);
  });

  it("blocks submission when a final result exists", async () => {
    const current = harness();
    current.store.markResult(userId, prescriptionId);
    const response = await request(current.app)
      .post(`/api/v1/prescriptions/${prescriptionId}/process`).set(auth).send({});
    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, "PROCESSING_ALREADY_COMPLETED");
  });

  it("returns an honest no-job state", async () => {
    const current = harness();
    const response = await request(current.app)
      .get(`/api/v1/prescriptions/${prescriptionId}/processing-status`).set(auth);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { prescription_id: prescriptionId, processing: null });
  });

  it("returns only queued, processing, completed, and failed statuses", async () => {
    for (const status of ["queued", "processing", "completed", "failed"] as const) {
      const current = harness();
      await request(current.app).post(`/api/v1/prescriptions/${prescriptionId}/process`).set(auth).send({});
      current.store.setStatus(userId, prescriptionId, status);
      const response = await request(current.app)
        .get(`/api/v1/prescriptions/${prescriptionId}/processing-status`).set(auth);
      assert.equal(response.status, 200);
      assert.equal(response.body.processing.status, status);
      assert.deepEqual(Object.keys(response.body.processing).sort(), [
        "completed_at", "created_at", "job_id", "started_at", "status"
      ]);
      assert.doesNotMatch(JSON.stringify(response.body), /completed_with_warnings|progress|result|ocr/i);
    }
  });

  it("validates status IDs and hides missing records", async () => {
    const invalid = harness();
    const invalidResponse = await request(invalid.app)
      .get("/api/v1/prescriptions/not-a-uuid/processing-status").set(auth);
    assert.equal(invalidResponse.status, 400);
    assert.equal(invalidResponse.body.error.code, "INVALID_PRESCRIPTION_ID");
    assert.deepEqual(invalid.store.statusReads, []);

    const missing = harness();
    const missingResponse = await request(missing.app)
      .get(`/api/v1/prescriptions/${missingId}/processing-status`).set(auth);
    assert.equal(missingResponse.status, 404);
    assert.equal(missingResponse.body.error.code, "PRESCRIPTION_NOT_FOUND");
  });

  it("fails closed when the secure store is not configured", async () => {
    const current = harness(false);
    for (const method of ["post", "get"] as const) {
      const path = method === "post"
        ? `/api/v1/prescriptions/${prescriptionId}/process`
        : `/api/v1/prescriptions/${prescriptionId}/processing-status`;
      const response = await request(current.app)[method](path).set(auth);
      assert.equal(response.status, 503);
      assert.equal(response.body.error.code, "PROCESSING_SERVICE_UNAVAILABLE");
    }
  });

  it("redacts database failures", async () => {
    const current = harness();
    current.store.failure = new Error("private database host and SQL details");
    const response = await request(current.app)
      .post(`/api/v1/prescriptions/${prescriptionId}/process`).set(auth).send({});
    assert.equal(response.status, 503);
    assert.equal(response.body.error.code, "PROCESSING_SERVICE_UNAVAILABLE");
    assert.doesNotMatch(JSON.stringify(response.body), /private|database|host|SQL/i);
  });
});
