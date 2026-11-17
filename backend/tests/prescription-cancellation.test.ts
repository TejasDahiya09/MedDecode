import assert from "node:assert/strict";
import { test } from "node:test";
import request from "supertest";
import { createApp } from "../src/app.js";
import type { UserSupabaseClient } from "../src/config/supabase-user.js";
import { createSupabaseProcessingJobStore } from "../src/repositories/processing-job.store.js";

const prescription = "10000000-0000-4000-8000-000000000001";
const job = "20000000-0000-4000-8000-000000000001";
const path = `/api/v1/prescriptions/${prescription}/jobs/${job}/cancel`;
const at = "2026-11-13T12:00:00.000Z";
const identity = { userId: "30000000-0000-4000-8000-000000000001" };

function harness(result: unknown) {
  let calls = 0;
  const client = { rpc: async (name: string, args: unknown) => {
    calls++;
    assert.equal(name, "cancel_prescription_analysis_job_v1");
    assert.deepEqual(args, { p_prescription_id: prescription, p_job_id: job });
    return result;
  } } as unknown as UserSupabaseClient;
  const app = createApp(undefined, { verifyAccessToken: async (token: string) => {
    if (token !== "owner") throw new Error("invalid token");
    return identity;
  } }, () => client, undefined, undefined, undefined, undefined, undefined,
  () => createSupabaseProcessingJobStore(client));
  return { app, calls: () => calls };
}

test("authenticated cancellation invokes the restricted RPC and preserves its idempotent response", async () => {
  const h = harness({ data: [{ job_id: job, prescription_id: prescription, job_status: "cancelled",
    cancelled_at: at, already_cancelled: false }], error: null });
  assert.equal((await request(h.app).post(path).send({})).status, 401);
  assert.equal(h.calls(), 0);
  const response = await request(h.app).post(path).set("Authorization", "Bearer owner").send({});
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { prescription_id: prescription, job_id: job, status: "cancelled",
    cancelled_at: at, already_cancelled: false });
  assert.equal(h.calls(), 1);
});

test("cancellation rejects bad identifiers, foreign jobs and processing jobs safely", async () => {
  const missing = harness({ data: null, error: { code: "P0002", message: "job not found" } });
  assert.equal((await request(missing.app).post(path).set("Authorization", "Bearer owner").send({})).status, 404);
  const conflict = harness({ data: null, error: { code: "55000", message: "job cannot be cancelled" } });
  assert.equal((await request(conflict.app).post(path).set("Authorization", "Bearer owner").send({})).status, 409);
  const invalid = harness({});
  assert.equal((await request(invalid.app).post(`/api/v1/prescriptions/${prescription}/jobs/invalid/cancel`)
    .set("Authorization", "Bearer owner").send({})).status, 400);
  assert.equal(invalid.calls(), 0);
});

test("malformed RPC response and provider details fail closed", async () => {
  const malformed = harness({ data: [{ job_id: "wrong" }], error: null });
  assert.equal((await request(malformed.app).post(path).set("Authorization", "Bearer owner").send({})).status, 503);
  const failed = harness({ data: null, error: { code: "XX000", message: "private provider detail" } });
  const response = await request(failed.app).post(path).set("Authorization", "Bearer owner").send({});
  assert.equal(response.status, 503);
  assert.doesNotMatch(JSON.stringify(response.body), /private provider detail/);
});
