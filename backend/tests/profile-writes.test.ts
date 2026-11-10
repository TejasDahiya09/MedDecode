import assert from "node:assert/strict";
import { describe, it } from "node:test";

import request from "supertest";

import { createApp } from "../src/app.js";
import type {
  UserSupabaseClient,
  UserSupabaseClientFactory
} from "../src/config/supabase-user.js";
import {
  ProfileRepositoryError,
  type ProfileRepository
} from "../src/repositories/profile.repository.js";
import type { AuthVerifier } from "../src/services/auth.service.js";
import type {
  ApplicationUserProfile,
  ApplicationUserUpdate,
  HealthProfile,
  HealthProfileInput,
  HealthProfileUpdate
} from "../src/types/profiles.js";

const userId = "00000000-0000-4000-8000-000000000001";
const applicationProfile: ApplicationUserProfile = {
  id: userId,
  email: "demo@example.invalid",
  name: "Demo User",
  created_at: "2026-11-10T10:00:00.000Z",
  updated_at: "2026-11-10T10:00:00.000Z"
};
const healthProfile: HealthProfile = {
  id: "10000000-0000-4000-8000-000000000001",
  user_id: userId,
  age: null,
  gender: null,
  allergies: [],
  diabetes: false,
  hypertension: false,
  kidney_disease: false,
  liver_disease: false,
  asthma: false,
  thyroid: false,
  pregnancy: null,
  other_conditions: [],
  created_at: "2026-11-10T10:00:00.000Z",
  updated_at: "2026-11-10T10:00:00.000Z"
};
const completeHealthInput: HealthProfileInput = {
  age: null,
  gender: null,
  allergies: [],
  diabetes: false,
  hypertension: false,
  kidney_disease: false,
  liver_disease: false,
  asthma: false,
  thyroid: false,
  pregnancy: null,
  other_conditions: []
};

class WriteRepository implements ProfileRepository {
  readonly applicationUpdates: Array<{
    client: UserSupabaseClient;
    userId: string;
    input: ApplicationUserUpdate;
  }> = [];
  readonly healthCreates: Array<{
    client: UserSupabaseClient;
    userId: string;
    input: HealthProfileInput;
  }> = [];
  readonly healthUpdates: Array<{
    client: UserSupabaseClient;
    userId: string;
    input: HealthProfileUpdate;
  }> = [];

  applicationResult: ApplicationUserProfile | null = applicationProfile;
  healthResult: HealthProfile | null = healthProfile;
  failure?: Error;

  async findApplicationUser(): Promise<ApplicationUserProfile | null> {
    return this.applicationResult;
  }

  async findHealthProfile(): Promise<HealthProfile | null> {
    return this.healthResult;
  }

  async updateApplicationUser(
    client: UserSupabaseClient,
    verifiedUserId: string,
    input: ApplicationUserUpdate
  ): Promise<ApplicationUserProfile | null> {
    this.applicationUpdates.push({ client, userId: verifiedUserId, input });
    if (this.failure) throw this.failure;
    return this.applicationResult;
  }

  async createHealthProfile(
    client: UserSupabaseClient,
    verifiedUserId: string,
    input: HealthProfileInput
  ): Promise<HealthProfile> {
    this.healthCreates.push({ client, userId: verifiedUserId, input });
    if (this.failure) throw this.failure;
    if (!this.healthResult) throw new Error("Synthetic missing health result.");
    return this.healthResult;
  }

  async updateHealthProfile(
    client: UserSupabaseClient,
    verifiedUserId: string,
    input: HealthProfileUpdate
  ): Promise<HealthProfile | null> {
    this.healthUpdates.push({ client, userId: verifiedUserId, input });
    if (this.failure) throw this.failure;
    return this.healthResult;
  }
}

function createHarness() {
  const verifier: AuthVerifier = {
    async verifyAccessToken(token) {
      if (token !== "valid-token") throw new Error("Synthetic invalid token.");
      return { userId };
    }
  };
  const repository = new WriteRepository();
  const factoryTokens: string[] = [];
  const clients: UserSupabaseClient[] = [];
  const factory: UserSupabaseClientFactory = (token) => {
    factoryTokens.push(token);
    const client = Object.freeze({ marker: token }) as unknown as UserSupabaseClient;
    clients.push(client);
    return client;
  };

  return {
    repository,
    factoryTokens,
    clients,
    app: createApp(undefined, verifier, factory, repository)
  };
}

function authenticated(method: "post" | "patch", app: ReturnType<typeof createApp>, path: string) {
  return request(app)[method](path).set("Authorization", "Bearer valid-token");
}

describe("Authenticated profile write APIs", () => {
  for (const [method, path] of [
    ["patch", "/api/v1/users/me"],
    ["post", "/api/v1/health-profile/me"],
    ["patch", "/api/v1/health-profile/me"]
  ] as const) {
    it(`rejects missing authentication for ${method.toUpperCase()} ${path}`, async () => {
      const harness = createHarness();
      const response = await request(harness.app)[method](path).send({});
      assert.equal(response.status, 401);
      assert.deepEqual(harness.factoryTokens, []);
      assert.equal(harness.repository.applicationUpdates.length, 0);
      assert.equal(harness.repository.healthCreates.length, 0);
      assert.equal(harness.repository.healthUpdates.length, 0);
    });

    it(`rejects invalid authentication for ${method.toUpperCase()} ${path}`, async () => {
      const harness = createHarness();
      const response = await request(harness.app)[method](path)
        .set("Authorization", "Bearer invalid-token")
        .send({});
      assert.equal(response.status, 401);
      assert.deepEqual(harness.factoryTokens, []);
    });
  }

  it("updates only the application display name for the verified user", async () => {
    const harness = createHarness();
    harness.repository.applicationResult = { ...applicationProfile, name: "New Name" };
    const response = await authenticated("patch", harness.app, "/api/v1/users/me")
      .query({ id: "attacker" })
      .set("X-User-Id", "attacker")
      .send({ name: "  New Name  " });

    assert.equal(response.status, 200);
    assert.equal(response.body.profile.name, "New Name");
    assert.deepEqual(harness.repository.applicationUpdates[0]?.input, {
      name: "New Name"
    });
    assert.equal(harness.repository.applicationUpdates[0]?.userId, userId);
    assert.equal(harness.repository.applicationUpdates[0]?.client, harness.clients[0]);
  });

  it("returns 404 instead of creating a missing application profile", async () => {
    const harness = createHarness();
    harness.repository.applicationResult = null;
    const response = await authenticated("patch", harness.app, "/api/v1/users/me")
      .send({ name: "New Name" });
    assert.equal(response.status, 404);
    assert.equal(response.body.error.code, "USER_PROFILE_NOT_FOUND");
  });

  it("creates a health profile only from a complete explicit medical-history payload", async () => {
    const harness = createHarness();
    const response = await authenticated(
      "post",
      harness.app,
      "/api/v1/health-profile/me"
    ).send(completeHealthInput);

    assert.equal(response.status, 201);
    assert.deepEqual(response.body, { healthProfile });
    assert.equal(harness.repository.healthCreates[0]?.userId, userId);
    assert.deepEqual(harness.repository.healthCreates[0]?.input, completeHealthInput);
    assert.equal("user_id" in (harness.repository.healthCreates[0]?.input ?? {}), false);
  });

  it("does not fabricate omitted medical history during creation", async () => {
    const harness = createHarness();
    const { diabetes: _omitted, ...incomplete } = completeHealthInput;
    const response = await authenticated(
      "post",
      harness.app,
      "/api/v1/health-profile/me"
    ).send(incomplete);

    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, "INVALID_PROFILE_INPUT");
    assert.equal(harness.repository.healthCreates.length, 0);
  });

  it("returns a controlled conflict for a duplicate health profile", async () => {
    const harness = createHarness();
    harness.repository.failure = new ProfileRepositoryError(
      "DUPLICATE_HEALTH_PROFILE"
    );
    const response = await authenticated(
      "post",
      harness.app,
      "/api/v1/health-profile/me"
    ).send(completeHealthInput);
    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, "HEALTH_PROFILE_ALREADY_EXISTS");
  });

  it("returns a controlled conflict when the parent application profile is missing", async () => {
    const harness = createHarness();
    harness.repository.failure = new ProfileRepositoryError(
      "MISSING_APPLICATION_PROFILE"
    );
    const response = await authenticated(
      "post",
      harness.app,
      "/api/v1/health-profile/me"
    ).send(completeHealthInput);
    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, "APPLICATION_PROFILE_REQUIRED");
  });

  it("updates only supplied health fields and leaves omitted fields absent", async () => {
    const harness = createHarness();
    harness.repository.healthResult = {
      ...healthProfile,
      age: 30,
      pregnancy: null
    };
    const response = await authenticated(
      "patch",
      harness.app,
      "/api/v1/health-profile/me"
    ).send({ age: 30, pregnancy: null });

    assert.equal(response.status, 200);
    assert.deepEqual(harness.repository.healthUpdates[0]?.input, {
      age: 30,
      pregnancy: null
    });
    assert.equal("diabetes" in (harness.repository.healthUpdates[0]?.input ?? {}), false);
    assert.equal(harness.repository.healthUpdates[0]?.userId, userId);
  });

  it("returns 404 when updating a missing health profile", async () => {
    const harness = createHarness();
    harness.repository.healthResult = null;
    const response = await authenticated(
      "patch",
      harness.app,
      "/api/v1/health-profile/me"
    ).send({ age: null });
    assert.equal(response.status, 404);
    assert.equal(response.body.error.code, "HEALTH_PROFILE_NOT_FOUND");
  });

  for (const testCase of [
    { label: "negative age", path: "/api/v1/health-profile/me", body: { age: -1 } },
    { label: "non-integer age", path: "/api/v1/health-profile/me", body: { age: 1.5 } },
    { label: "oversized age", path: "/api/v1/health-profile/me", body: { age: 151 } },
    { label: "null non-nullable boolean", path: "/api/v1/health-profile/me", body: { asthma: null } },
    { label: "wrong boolean type", path: "/api/v1/health-profile/me", body: { diabetes: "false" } },
    { label: "wrong array type", path: "/api/v1/health-profile/me", body: { allergies: "none" } },
    { label: "empty patch", path: "/api/v1/health-profile/me", body: {} },
    { label: "system health field", path: "/api/v1/health-profile/me", body: { user_id: "attacker" } },
    { label: "unknown health field", path: "/api/v1/health-profile/me", body: { unknown: true } },
    { label: "system application field", path: "/api/v1/users/me", body: { email: "attacker@example.invalid" } },
    { label: "oversized name", path: "/api/v1/users/me", body: { name: "x".repeat(101) } }
  ]) {
    it(`rejects ${testCase.label}`, async () => {
      const harness = createHarness();
      const response = await authenticated("patch", harness.app, testCase.path)
        .send(testCase.body);
      assert.equal(response.status, 400);
      assert.equal(response.body.error.code, "INVALID_PROFILE_INPUT");
      assert.equal(harness.repository.applicationUpdates.length, 0);
      assert.equal(harness.repository.healthUpdates.length, 0);
    });
  }

  it("allows null only for nullable application and health fields", async () => {
    const harness = createHarness();
    harness.repository.applicationResult = { ...applicationProfile, name: null };
    const application = await authenticated(
      "patch",
      harness.app,
      "/api/v1/users/me"
    ).send({ name: null });
    const health = await authenticated(
      "patch",
      harness.app,
      "/api/v1/health-profile/me"
    ).send({ age: null, gender: null, pregnancy: null });

    assert.equal(application.status, 200);
    assert.equal(health.status, 200);
    assert.deepEqual(harness.repository.applicationUpdates[0]?.input, { name: null });
    assert.deepEqual(harness.repository.healthUpdates[0]?.input, {
      age: null,
      gender: null,
      pregnancy: null
    });
  });

  it("returns a generic response for unexpected database failures", async () => {
    const harness = createHarness();
    harness.repository.failure = new ProfileRepositoryError("QUERY_FAILED");
    const response = await authenticated("patch", harness.app, "/api/v1/users/me")
      .send({ name: "Safe Name" });
    assert.equal(response.status, 500);
    assert.deepEqual(response.body, {
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred."
      }
    });
    assert.doesNotMatch(JSON.stringify(response.body), /database|supabase|query/i);
  });

  it("uses only injected user-scoped dependencies and performs no external call", async () => {
    const harness = createHarness();
    const response = await authenticated("patch", harness.app, "/api/v1/users/me")
      .send({ name: "Demo User" });
    assert.equal(response.status, 200);
    assert.deepEqual(harness.factoryTokens, ["valid-token"]);
    assert.equal(harness.repository.applicationUpdates.length, 1);
  });
});
