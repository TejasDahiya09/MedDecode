import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import request from "supertest";
import { healthRouter } from "../src/routes/health.routes.js";

test("readiness fails closed when intelligence and dedicated database checks are not configured", async () => {
  const oldPython = process.env.PYTHON_INTELLIGENCE_URL;
  const oldDb = process.env.BACKEND_READINESS_DATABASE_URL;
  delete process.env.PYTHON_INTELLIGENCE_URL;
  delete process.env.BACKEND_READINESS_DATABASE_URL;
  try {
    const app = express(); app.use(healthRouter);
    const response = await request(app).get("/ready");
    assert.equal(response.status, 503);
    assert.deepEqual(response.body, { status: "not_ready", dependencies: { intelligence: "unavailable", database: "unavailable" } });
    assert.equal((await request(app).get("/health")).status, 200);
  } finally {
    if (oldPython === undefined) delete process.env.PYTHON_INTELLIGENCE_URL; else process.env.PYTHON_INTELLIGENCE_URL = oldPython;
    if (oldDb === undefined) delete process.env.BACKEND_READINESS_DATABASE_URL; else process.env.BACKEND_READINESS_DATABASE_URL = oldDb;
  }
});
