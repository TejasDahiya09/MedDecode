import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EventEmitter } from "node:events";
import type { Request, Response } from "express";

import { createRemindersRouter } from "../src/routes/reminders.routes.js";
import { InMemoryRemindersRepository } from "../src/repositories/reminders.repository.js";
import type { AuthVerifier, VerifiedIdentity } from "../src/services/auth.service.js";
import type { UserSupabaseClient, UserSupabaseClientFactory } from "../src/config/supabase-user.js";

const user1Id = "00000000-0000-4000-8000-000000000001";
const user2Id = "00000000-0000-4000-8000-000000000002";

class SyntheticTokenVerifier implements AuthVerifier {
  constructor(private readonly identities: Readonly<Record<string, VerifiedIdentity>>) {}
  async verifyAccessToken(token: string): Promise<VerifiedIdentity> {
    const identity = this.identities[token];
    if (!identity) throw new Error("invalid synthetic token");
    return identity;
  }
}

interface MockResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: any;
  status(code: number): MockResponse;
  json(data: any): MockResponse;
  end(): MockResponse;
}

function createMockResponse(): MockResponse & EventEmitter {
  const emitter = new EventEmitter() as MockResponse & EventEmitter;
  emitter.statusCode = 200;
  emitter.headers = {};
  emitter.body = null;

  emitter.status = function (code: number) {
    this.statusCode = code;
    return this;
  };
  emitter.json = function (data: any) {
    this.body = data;
    this.emit("finish");
    return this;
  };
  emitter.end = function () {
    this.emit("finish");
    return this;
  };

  return emitter;
}

function createTestContext() {
  const repository = new InMemoryRemindersRepository();
  const verifier = new SyntheticTokenVerifier({
    "user-1-token": { userId: user1Id },
    "user-2-token": { userId: user2Id },
  });
  const clientFactory: UserSupabaseClientFactory = (_token: string) => {
    return {} as unknown as UserSupabaseClient;
  };

  const router = createRemindersRouter(verifier, clientFactory, repository);

  async function dispatch(options: {
    method: "GET" | "POST" | "PATCH" | "DELETE";
    url: string;
    token?: string;
    body?: any;
  }): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(options.url, "http://localhost");
      const query: Record<string, string> = {};
      parsedUrl.searchParams.forEach((val, key) => {
        query[key] = val;
      });

      const rawHeaders: string[] = [];
      if (options.token) {
        rawHeaders.push("authorization", `Bearer ${options.token}`);
      }

      const req = {
        method: options.method,
        url: options.url,
        path: parsedUrl.pathname,
        originalUrl: options.url,
        query,
        params: {},
        headers: options.token ? { authorization: `Bearer ${options.token}` } : {},
        rawHeaders,
        body: options.body ?? {},
      } as unknown as Request;

      const mockResponse = createMockResponse();
      const res = mockResponse as unknown as Response;

      mockResponse.on("finish", () => {
        resolve({ status: mockResponse.statusCode, body: mockResponse.body });
      });

      // Simple route matcher for router tests
      try {
        router(req, res, (error: unknown) => {
          if (error && typeof error === "object") {
            const detail = error as { readonly statusCode?: number; readonly message?: string; readonly code?: string };
            resolve({ status: detail.statusCode ?? 500, body: { error: detail.message, code: detail.code } });
          } else {
            resolve({ status: 404, body: { error: "Not Found" } });
          }
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  return { repository, dispatch };
}

describe("Medication Reminders In-Memory Routing & Repository", () => {
  it("enforces authentication when bearer token is absent", async () => {
    const { dispatch } = createTestContext();

    const res = await dispatch({
      method: "GET",
      url: "/api/v1/reminders",
    });
    assert.equal(res.status, 401);
  });

  it("returns empty list for a user with no reminders", async () => {
    const { dispatch } = createTestContext();

    const res = await dispatch({
      method: "GET",
      url: "/api/v1/reminders",
      token: "user-1-token",
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { items: [], total: 0 });
  });

  it("creates, retrieves, updates, and deletes reminders", async () => {
    const { dispatch } = createTestContext();

    // 1. Create reminder
    const createRes = await dispatch({
      method: "POST",
      url: "/api/v1/reminders",
      token: "user-1-token",
      body: {
        medicine_name: "Metformin 500mg",
        dosage: "1 Tablet with breakfast",
        scheduled_time: "08:30",
        recurrence: "daily",
        notes: "Take with food",
      },
    });

    assert.equal(createRes.status, 201);
    assert.ok(createRes.body.reminder);
    const reminderId = createRes.body.reminder.id;
    assert.equal(createRes.body.reminder.medicine_name, "Metformin 500mg");
    assert.equal(createRes.body.reminder.dosage, "1 Tablet with breakfast");
    assert.equal(createRes.body.reminder.status, "active");

    // 2. List reminders
    const listRes = await dispatch({
      method: "GET",
      url: "/api/v1/reminders",
      token: "user-1-token",
    });
    assert.equal(listRes.status, 200);
    assert.equal(listRes.body.total, 1);
    assert.equal(listRes.body.items[0].id, reminderId);

    // 3. Update reminder to paused
    const updateRes = await dispatch({
      method: "PATCH",
      url: `/api/v1/reminders/${reminderId}`,
      token: "user-1-token",
      body: {
        status: "paused",
        dosage: "2 Tablets with dinner",
      },
    });
    assert.equal(updateRes.status, 200);
    assert.equal(updateRes.body.reminder.status, "paused");
    assert.equal(updateRes.body.reminder.dosage, "2 Tablets with dinner");

    // 4. Filter by status
    const activeFilter = await dispatch({
      method: "GET",
      url: "/api/v1/reminders?status=active",
      token: "user-1-token",
    });
    assert.equal(activeFilter.status, 200);
    assert.equal(activeFilter.body.total, 0);

    const pausedFilter = await dispatch({
      method: "GET",
      url: "/api/v1/reminders?status=paused",
      token: "user-1-token",
    });
    assert.equal(pausedFilter.status, 200);
    assert.equal(pausedFilter.body.total, 1);

    // 5. Delete reminder
    const deleteRes = await dispatch({
      method: "DELETE",
      url: `/api/v1/reminders/${reminderId}`,
      token: "user-1-token",
    });
    assert.equal(deleteRes.status, 204);

    // 6. Verify deleted
    const verifyList = await dispatch({
      method: "GET",
      url: "/api/v1/reminders",
      token: "user-1-token",
    });
    assert.equal(verifyList.body.total, 0);
  });

  it("handles multi-dose schedule configuration and dates", async () => {
    const { dispatch } = createTestContext();

    const createRes = await dispatch({
      method: "POST",
      url: "/api/v1/reminders",
      token: "user-1-token",
      body: {
        medicine_name: "Amoxicillin 500mg",
        scheduled_time: "08:00",
        scheduled_times: ["08:00", "14:00", "20:00"],
        start_date: "2026-11-16",
        end_date: "2026-11-23",
        recurrence: "thrice_daily",
      },
    });

    assert.equal(createRes.status, 201);
    assert.deepEqual(createRes.body.reminder.scheduled_times, ["08:00", "14:00", "20:00"]);
    assert.equal(createRes.body.reminder.start_date, "2026-11-16");
    assert.equal(createRes.body.reminder.end_date, "2026-11-23");
  });

  it("logs doses and protects against duplicate events", async () => {
    const { repository } = createTestContext();

    // Create reminder directly in repo
    const reminder = await repository.create(null, user1Id, {
      medicine_name: "Lisinopril 10mg",
      scheduled_time: "09:00",
      recurrence: "daily",
    });

    const doseTime = "2026-11-16T09:00:00.000Z";

    // 1. Log dose taken
    const res1 = await repository.logDose(null, user1Id, reminder.id, {
      status: "taken",
      dose_time: doseTime,
      notes: "Taken on time",
    });
    assert.equal(res1.dose.status, "taken");
    assert.ok(res1.reminder.last_taken_at);

    // 2. Duplicate log call for the same dose time is idempotent
    const res2 = await repository.logDose(null, user1Id, reminder.id, {
      status: "taken",
      dose_time: doseTime,
    });
    assert.equal(res2.dose.id, res1.dose.id);

    // 3. List recent doses
    const recent = await repository.listRecentDoses(null, user1Id);
    assert.equal(recent.length, 1);
    assert.equal(recent[0]?.medicine_name, "Lisinopril 10mg");
    assert.equal(recent[0]?.status, "taken");
  });

  it("enforces cross-user isolation", async () => {
    const { repository } = createTestContext();

    const reminder1 = await repository.create(null, user1Id, {
      medicine_name: "User 1 Secret Medicine",
      scheduled_time: "10:00",
    });

    // User 2 cannot see User 1's reminder
    const user2List = await repository.list(null, user2Id);
    assert.equal(user2List.length, 0);

    const user2Find = await repository.findById(null, user2Id, reminder1.id);
    assert.equal(user2Find, null);

    const user2Update = await repository.update(null, user2Id, reminder1.id, { status: "paused" });
    assert.equal(user2Update, null);

    const user2Delete = await repository.delete(null, user2Id, reminder1.id);
    assert.equal(user2Delete, false);

    await assert.rejects(async () => {
      await repository.logDose(null, user2Id, reminder1.id, { status: "taken" });
    }, /Reminder not found/);
  });
});
