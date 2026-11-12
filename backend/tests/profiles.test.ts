import assert from "node:assert/strict";
import { describe, it } from "node:test";

import request from "supertest";

import { createApp } from "../src/app.js";
import type {
  UserSupabaseClient,
  UserSupabaseClientFactory
} from "../src/config/supabase-user.js";
import type { ProfileRepository } from "../src/repositories/profile.repository.js";
import type {
  AuthVerifier,
  VerifiedIdentity
} from "../src/services/auth.service.js";
import type {
  ApplicationUserProfile,
  ApplicationUserUpdate,
  HealthProfile,
  HealthProfileInput,
  HealthProfileUpdate
} from "../src/types/profiles.js";

const userOne: ApplicationUserProfile = {
  id: "00000000-0000-4000-8000-000000000001",
  email: null,
  name: null,
  created_at: "2026-11-10T10:00:00.000Z",
  updated_at: "2026-11-10T10:00:00.000Z"
};

const healthOne: HealthProfile = {
  id: "10000000-0000-4000-8000-000000000001",
  user_id: userOne.id,
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

class TokenVerifier implements AuthVerifier {
  readonly verifiedTokens: string[] = [];

  constructor(
    private readonly identities: Readonly<Record<string, VerifiedIdentity>>
  ) {}

  async verifyAccessToken(accessToken: string): Promise<VerifiedIdentity> {
    this.verifiedTokens.push(accessToken);
    const identity = this.identities[accessToken];
    if (!identity) {
      throw new Error("Synthetic invalid token.");
    }
    return identity;
  }
}

class MockProfileRepository implements ProfileRepository {
  readonly applicationCalls: Array<{
    client: UserSupabaseClient;
    userId: string;
  }> = [];
  readonly healthCalls: Array<{
    client: UserSupabaseClient;
    userId: string;
  }> = [];

  applicationResult: ApplicationUserProfile | null = null;
  healthResult: HealthProfile | null = null;
  failure?: Error;

  async findApplicationUser(
    client: UserSupabaseClient,
    userId: string
  ): Promise<ApplicationUserProfile | null> {
    this.applicationCalls.push({ client, userId });
    if (this.failure) throw this.failure;
    return this.applicationResult;
  }

  async findHealthProfile(
    client: UserSupabaseClient,
    userId: string
  ): Promise<HealthProfile | null> {
    this.healthCalls.push({ client, userId });
    if (this.failure) throw this.failure;
    return this.healthResult;
  }

  async updateApplicationUser(
    _client: UserSupabaseClient,
    _userId: string,
    _input: ApplicationUserUpdate
  ): Promise<ApplicationUserProfile | null> {
    if (this.failure) throw this.failure;
    return this.applicationResult;
  }

  async createHealthProfile(
    _client: UserSupabaseClient,
    _userId: string,
    _input: HealthProfileInput
  ): Promise<HealthProfile> {
    if (this.failure) throw this.failure;
    if (!this.healthResult) throw new Error("Synthetic missing health result.");
    return this.healthResult;
  }

  async updateHealthProfile(
    _client: UserSupabaseClient,
    _userId: string,
    _input: HealthProfileUpdate
  ): Promise<HealthProfile | null> {
    if (this.failure) throw this.failure;
    return this.healthResult;
  }
}

interface ProfileTestHarness {
  readonly verifier: TokenVerifier;
  readonly repository: MockProfileRepository;
  readonly factoryTokens: string[];
  readonly clients: UserSupabaseClient[];
  readonly app: ReturnType<typeof createApp>;
}

function createHarness(
  identities: Readonly<Record<string, VerifiedIdentity>> = {
    "token-one": { userId: userOne.id, email: "one@example.invalid" }
  }
): ProfileTestHarness {
  const verifier = new TokenVerifier(identities);
  const repository = new MockProfileRepository();
  const factoryTokens: string[] = [];
  const clients: UserSupabaseClient[] = [];
  const factory: UserSupabaseClientFactory = (accessToken) => {
    factoryTokens.push(accessToken);
    const client = Object.freeze({ marker: accessToken }) as unknown as UserSupabaseClient;
    clients.push(client);
    return client;
  };

  return {
    verifier,
    repository,
    factoryTokens,
    clients,
    app: createApp(undefined, verifier, factory, repository)
  };
}

const unauthorizedBody = {
  error: {
    code: "UNAUTHORIZED",
    message: "Authentication required."
  }
};

describe("Authenticated read-only profile APIs", () => {
  for (const path of ["/api/v1/users/me", "/api/v1/health-profile/me"]) {
    it(`rejects missing authentication for ${path}`, async () => {
      const harness = createHarness();
      const response = await request(harness.app).get(path);

      assert.equal(response.status, 401);
      assert.deepEqual(response.body, unauthorizedBody);
      assert.deepEqual(harness.factoryTokens, []);
      assert.equal(harness.repository.applicationCalls.length, 0);
      assert.equal(harness.repository.healthCalls.length, 0);
    });

    it(`rejects invalid authentication for ${path}`, async () => {
      const harness = createHarness();
      const response = await request(harness.app)
        .get(path)
        .set("Authorization", "Bearer invalid-token");

      assert.equal(response.status, 401);
      assert.deepEqual(response.body, unauthorizedBody);
      assert.deepEqual(harness.verifier.verifiedTokens, ["invalid-token"]);
      assert.deepEqual(harness.factoryTokens, []);
      assert.equal(harness.repository.applicationCalls.length, 0);
      assert.equal(harness.repository.healthCalls.length, 0);
    });
  }

  it("returns an existing application profile with only allowed fields", async () => {
    const harness = createHarness();
    harness.repository.applicationResult = {
      ...userOne,
      extra_private_field: "must-not-appear"
    } as ApplicationUserProfile;

    const response = await request(harness.app)
      .get("/api/v1/users/me")
      .set("Authorization", "Bearer token-one");

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { profile: userOne });
    assert.equal(response.body.profile.email, null);
    assert.equal(response.body.profile.name, null);
    assert.equal("extra_private_field" in response.body.profile, false);
  });

  it("returns a controlled 404 for a missing application profile", async () => {
    const harness = createHarness();
    const response = await request(harness.app)
      .get("/api/v1/users/me")
      .set("Authorization", "Bearer token-one");

    assert.equal(response.status, 404);
    assert.deepEqual(response.body, {
      error: {
        code: "USER_PROFILE_NOT_FOUND",
        message: "User profile not found."
      }
    });
  });

  it("returns an existing health profile with nulls and arrays preserved", async () => {
    const harness = createHarness();
    harness.repository.healthResult = {
      ...healthOne,
      extra_private_field: "must-not-appear"
    } as HealthProfile;

    const response = await request(harness.app)
      .get("/api/v1/health-profile/me")
      .set("Authorization", "Bearer token-one");

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { healthProfile: healthOne });
    assert.equal(response.body.healthProfile.age, null);
    assert.equal(response.body.healthProfile.pregnancy, null);
    assert.deepEqual(response.body.healthProfile.allergies, []);
    assert.deepEqual(response.body.healthProfile.other_conditions, []);
    assert.equal("extra_private_field" in response.body.healthProfile, false);
  });

  it("returns a controlled 404 for a missing health profile", async () => {
    const harness = createHarness();
    const response = await request(harness.app)
      .get("/api/v1/health-profile/me")
      .set("Authorization", "Bearer token-one");

    assert.equal(response.status, 404);
    assert.deepEqual(response.body, {
      error: {
        code: "HEALTH_PROFILE_NOT_FOUND",
        message: "Health profile not found."
      }
    });
  });

  it("ignores client-supplied IDs and filters by verified identity", async () => {
    const harness = createHarness();
    harness.repository.applicationResult = userOne;

    const response = await request(harness.app)
      .get("/api/v1/users/me?id=attacker")
      .set("Authorization", "Bearer token-one")
      .set("X-User-Id", "attacker")
      .send({ user_id: "attacker" });

    assert.equal(response.status, 200);
    assert.equal(harness.repository.applicationCalls[0]?.userId, userOne.id);
  });

  it("returns a generic safe response for database errors", async () => {
    const harness = createHarness();
    harness.repository.failure = new Error(
      "relation health_profiles failed with private provider detail"
    );

    const response = await request(harness.app)
      .get("/api/v1/health-profile/me")
      .set("Authorization", "Bearer token-one");

    assert.equal(response.status, 500);
    assert.deepEqual(response.body, {
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred."
      }
    });
    assert.doesNotMatch(
      JSON.stringify(response.body),
      /health_profiles|private|provider|relation/i
    );
  });

  it("constructs the scoped client after verification with the same token", async () => {
    const events: string[] = [];
    const repository = new MockProfileRepository();
    repository.applicationResult = userOne;
    const verifier: AuthVerifier = {
      async verifyAccessToken(token) {
        events.push(`verified:${token}`);
        return { userId: userOne.id };
      }
    };
    const factory: UserSupabaseClientFactory = (token) => {
      events.push(`client:${token}`);
      return {} as UserSupabaseClient;
    };
    const app = createApp(undefined, verifier, factory, repository);

    const response = await request(app)
      .get("/api/v1/users/me")
      .set("Authorization", "Bearer exact-jwt");

    assert.equal(response.status, 200);
    assert.deepEqual(events, ["verified:exact-jwt", "client:exact-jwt"]);
  });

  it("never returns the bearer token or scoped client", async () => {
    const harness = createHarness();
    harness.repository.applicationResult = userOne;

    const response = await request(harness.app)
      .get("/api/v1/users/me")
      .set("Authorization", "Bearer token-one");
    const serialized = JSON.stringify(response.body);

    assert.equal(response.status, 200);
    assert.equal(serialized.includes("token-one"), false);
    assert.equal(serialized.includes("marker"), false);
  });

  it("scopes two simulated users to distinct clients and identity filters", async () => {
    const userTwoId = "00000000-0000-4000-8000-000000000002";
    const harness = createHarness({
      "token-one": { userId: userOne.id },
      "token-two": { userId: userTwoId }
    });
    harness.repository.applicationResult = userOne;

    const first = await request(harness.app)
      .get("/api/v1/users/me")
      .set("Authorization", "Bearer token-one");
    const second = await request(harness.app)
      .get("/api/v1/users/me")
      .set("Authorization", "Bearer token-two");

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.deepEqual(harness.factoryTokens, ["token-one", "token-two"]);
    assert.notEqual(harness.clients[0], harness.clients[1]);
    assert.deepEqual(
      harness.repository.applicationCalls.map(({ userId }) => userId),
      [userOne.id, userTwoId]
    );
    assert.equal(
      harness.repository.applicationCalls[0]?.client,
      harness.clients[0]
    );
    assert.equal(
      harness.repository.applicationCalls[1]?.client,
      harness.clients[1]
    );
  });

  it("keeps auth/me unchanged without constructing a database client", async () => {
    const harness = createHarness();
    const response = await request(harness.app)
      .get("/api/v1/auth/me")
      .set("Authorization", "Bearer token-one");

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      user: { id: userOne.id, email: "one@example.invalid" }
    });
    assert.deepEqual(harness.factoryTokens, []);
  });

  it("keeps health public and credential-independent", async () => {
    const harness = createHarness();
    const response = await request(harness.app).get("/health");

    assert.equal(response.status, 200);
    assert.deepEqual(harness.verifier.verifiedTokens, []);
    assert.deepEqual(harness.factoryTokens, []);
  });
});
