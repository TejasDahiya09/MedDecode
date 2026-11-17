import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import request from "supertest";
import { createPrescriptionUploadRouter } from "../src/routes/prescription-upload.routes.js";
import { errorHandler } from "../src/middleware/error.middleware.js";
import type { UserSupabaseClient } from "../src/config/supabase-user.js";
import type { ProcessingJobStore } from "../src/repositories/processing-job.store.js";
import { ProcessingJobService } from "../src/services/processing-job.service.js";
import { InMemoryProcessingJobStore } from "./support/in-memory-processing-job-store.js";

const user = "00000000-0000-4000-8000-000000000001";
const prescription = "10000000-0000-4000-8000-000000000001";
const job = "20000000-0000-4000-8000-000000000001";
const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
function setup(enabled: boolean, loseResponse = false) {
  const store = new InMemoryProcessingJobStore({ now: () => "2026-11-14T00:00:00Z", uuid: () => job });
  store.own(user, prescription);
  let writes = 0; let deletes = 0;
  const client = {} as UserSupabaseClient;
  const forwarding: ProcessingJobStore = {
    async submitOwned(input) { const result = await store.submitOwned(input); if (loseResponse) throw new Error("private detail"); return result; },
    findOwnedStatus: store.findOwnedStatus.bind(store)
  };
  const app = express();
  app.use(createPrescriptionUploadRouter({ async verifyAccessToken() { return { userId: user }; } }, () => client,
    () => ({
      storage: { async upload() { writes += 1; }, async delete() { deletes += 1; } },
      repository: { async create(_client, input) { return { ...input, created_at: "2026-11-14T00:00:00Z", updated_at: "2026-11-14T00:00:00Z" }; }, async findOwnedById() { return null; } },
      bucket: "synthetic-only", maximumFileSizeBytes: 1024, uploadTimeoutMs: 1000, generatePrescriptionId: () => prescription,
    }), { enabled, storeFactory: () => forwarding }));
  app.use(errorHandler);
  return { app, store, getWrites: () => writes, getDeletes: () => deletes };
}
const upload = (app: ReturnType<typeof express>, negotiated = true) => {
  const req = request(app).post("/api/v1/prescriptions/upload").set("Authorization", "Bearer synthetic");
  if (negotiated) req.set("X-MedDecode-Auto-Submit", "v1");
  return req.attach("file", pdf, { filename: "synthetic.pdf", contentType: "application/pdf" });
};

test("negotiated upload submits one owner-scoped job and duplicate submission reuses it", async () => {
  const h = setup(true);
  const response = await upload(h.app);
  assert.equal(response.status, 201);
  assert.deepEqual(response.body.processing, { requested: true, job_id: job });
  assert.equal(h.store.submissions.length, 1);
  assert.equal(h.store.submissions[0]?.userId, user);
  assert.equal(h.store.submissions[0]?.prescriptionId, prescription);
  const again = await new ProcessingJobService(h.store).submit(user, prescription);
  assert.equal(again.body.job.id, job);
  assert.equal(again.body.submission.created, false);
});

test("legacy clients retain original response and disabled opt-in writes nothing", async () => {
  const h = setup(false);
  const rejected = await upload(h.app);
  assert.equal(rejected.status, 503); assert.equal(h.getWrites(), 0);
  const legacy = await upload(h.app, false);
  assert.equal(legacy.status, 201);
  assert.deepEqual(legacy.body.processing, { requested: false, job_id: null });
  assert.equal(h.store.submissions.length, 0);
});

test("negotiated uploads require authentication and a recognized contract version", async () => {
  const h = setup(true);
  const unauthenticated = await request(h.app).post("/api/v1/prescriptions/upload")
    .set("X-MedDecode-Auto-Submit", "v1").attach("file", pdf, { filename: "synthetic.pdf", contentType: "application/pdf" });
  assert.equal(unauthenticated.status, 401);
  const invalid = await request(h.app).post("/api/v1/prescriptions/upload").set("Authorization", "Bearer synthetic")
    .set("X-MedDecode-Auto-Submit", "v2").attach("file", pdf, { filename: "synthetic.pdf", contentType: "application/pdf" });
  assert.equal(invalid.status, 400);
  assert.equal(h.getWrites(), 0); assert.equal(h.store.submissions.length, 0);
});

test("lost submission response preserves the uploaded document and reports uncertainty", async () => {
  const h = setup(true, true);
  const response = await upload(h.app);
  assert.equal(response.status, 201);
  assert.deepEqual(response.body.processing, { requested: null, job_id: null, submission: "unconfirmed" });
  assert.equal(h.getWrites(), 1); assert.equal(h.getDeletes(), 0);
  assert.doesNotMatch(JSON.stringify(response.body), /private detail/);
  const retry = await new ProcessingJobService(h.store).submit(user, prescription);
  assert.equal(retry.body.job.id, job); assert.equal(retry.body.submission.created, false);
});
