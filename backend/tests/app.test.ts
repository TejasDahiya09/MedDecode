import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import type { NextFunction, Request, Response } from "express";

import request from "supertest";

import { app, createApp } from "../src/app.js";
import { AppError, errorHandler } from "../src/middleware/error.middleware.js";

describe("Express application foundation", () => {
  it("returns the exact process-liveness response", async () => {
    const response = await request(app).get("/health");

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      status: "ok",
      service: "meddecode-backend",
      version: "1.0.0"
    });
  });

  it("returns a consistent JSON 404 for an unknown route", async () => {
    const response = await request(app).get("/unknown-route");

    assert.equal(response.status, 404);
    assert.match(response.headers["content-type"] ?? "", /^application\/json/);
    assert.deepEqual(response.body, {
      error: {
        code: "NOT_FOUND",
        message: "Route not found."
      }
    });
  });

  it("returns a controlled JSON response for malformed JSON", async () => {
    const response = await request(app)
      .post("/health")
      .set("Content-Type", "application/json")
      .send('{"invalid":');

    assert.equal(response.status, 400);
    assert.deepEqual(response.body, {
      error: {
        code: "INVALID_JSON",
        message: "Request body contains invalid JSON."
      }
    });
  });

  it("returns a controlled response when a JSON body exceeds the limit", async () => {
    const oversizedBody = JSON.stringify({ data: "x".repeat(1024 * 1024) });
    const response = await request(app)
      .post("/health")
      .set("Content-Type", "application/json")
      .send(oversizedBody);

    assert.equal(response.status, 413);
    assert.deepEqual(response.body, {
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: "Request body exceeds the allowed size."
      }
    });
  });

  it("does not expose unexpected internal error details", async () => {
    const internalMessage = "secret at C:\\private\\implementation.ts";
    const failingApp = createApp((expressApp) => {
      expressApp.get("/test-error", () => {
        throw new Error(internalMessage);
      });
    });

    const response = await request(failingApp).get("/test-error");

    assert.equal(response.status, 500);
    assert.deepEqual(response.body, {
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred."
      }
    });
    assert.doesNotMatch(JSON.stringify(response.body), /secret|private|implementation/i);
  });

  it("handles rejected async route handlers without exposing details", async () => {
    const failingApp = createApp((expressApp) => {
      expressApp.get("/async-error", async () => {
        throw new Error("private async failure");
      });
    });

    const response = await request(failingApp).get("/async-error");

    assert.equal(response.status, 500);
    assert.deepEqual(response.body, {
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred."
      }
    });
    assert.doesNotMatch(JSON.stringify(response.body), /private|async failure/i);
  });

  it("returns controlled details for a typed application error", async () => {
    const controlledApp = createApp((expressApp) => {
      expressApp.get("/controlled-error", () => {
        throw new AppError(409, "RESOURCE_CONFLICT", "The resource already exists.");
      });
    });

    const response = await request(controlledApp).get("/controlled-error");

    assert.equal(response.status, 409);
    assert.deepEqual(response.body, {
      error: {
        code: "RESOURCE_CONFLICT",
        message: "The resource already exists."
      }
    });
  });

  it("delegates errors after response headers have been sent", () => {
    const originalError = new Error("stream failed");
    let delegatedError: unknown;
    let attemptedSecondResponse = false;
    const response = {
      headersSent: true,
      status: () => {
        attemptedSecondResponse = true;
        return response;
      }
    } as unknown as Response;
    const next = ((error: unknown) => {
      delegatedError = error;
    }) as NextFunction;

    errorHandler(
      originalError,
      {} as Request,
      response,
      next
    );

    assert.equal(delegatedError, originalError);
    assert.equal(attemptedSecondResponse, false);
  });

  it("does not open a listening server when the app module is imported", () => {
    const importCheck = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "--eval",
        [
          "const { Server } = await import('node:http');",
          "await import('./src/app.ts');",
          "const listening = process._getActiveHandles()",
          "  .some((handle) => handle instanceof Server && handle.listening);",
          "if (listening) process.exitCode = 1;"
        ].join("\n")
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 5000
      }
    );

    assert.equal(importCheck.error, undefined);
    assert.equal(importCheck.signal, null);
    assert.equal(importCheck.status, 0, importCheck.stderr);
  });
});
