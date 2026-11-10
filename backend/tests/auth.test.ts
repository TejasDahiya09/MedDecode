import assert from "node:assert/strict";
import { describe, it } from "node:test";

import request from "supertest";

import { createApp } from "../src/app.js";
import type {
  AuthVerifier,
  VerifiedIdentity
} from "../src/services/auth.service.js";

class MockAuthVerifier implements AuthVerifier {
  readonly tokens: string[] = [];

  constructor(
    private readonly result?: VerifiedIdentity,
    private readonly failure?: Error
  ) {}

  async verifyAccessToken(accessToken: string): Promise<VerifiedIdentity> {
    this.tokens.push(accessToken);

    if (this.failure) {
      throw this.failure;
    }

    if (!this.result) {
      throw new Error("Mock verifier has no result.");
    }

    return this.result;
  }
}

const unauthorizedBody = {
  error: {
    code: "UNAUTHORIZED",
    message: "Authentication required."
  }
};

describe("Supabase authentication foundation", () => {
  it("rejects a missing Authorization header", async () => {
    const verifier = new MockAuthVerifier({ userId: "verified-user" });
    const response = await request(createApp(undefined, verifier))
      .get("/api/v1/auth/me");

    assert.equal(response.status, 401);
    assert.deepEqual(response.body, unauthorizedBody);
    assert.deepEqual(verifier.tokens, []);
  });

  for (const authorization of ["", "Bearer", "Bearer   ", "Bearer one two"]) {
    it(`rejects malformed authorization: ${JSON.stringify(authorization)}`, async () => {
      const verifier = new MockAuthVerifier({ userId: "verified-user" });
      const response = await request(createApp(undefined, verifier))
        .get("/api/v1/auth/me")
        .set("Authorization", authorization);

      assert.equal(response.status, 401);
      assert.deepEqual(response.body, unauthorizedBody);
      assert.deepEqual(verifier.tokens, []);
    });
  }

  it("rejects unsupported authorization schemes", async () => {
    const verifier = new MockAuthVerifier({ userId: "verified-user" });
    const response = await request(createApp(undefined, verifier))
      .get("/api/v1/auth/me")
      .set("Authorization", "Basic credentials");

    assert.equal(response.status, 401);
    assert.deepEqual(response.body, unauthorizedBody);
    assert.deepEqual(verifier.tokens, []);
  });

  it("rejects multiple or ambiguous authorization values", async () => {
    const verifier = new MockAuthVerifier({ userId: "verified-user" });
    const response = await request(createApp(undefined, verifier))
      .get("/api/v1/auth/me")
      // Superagent supports repeated raw values, but its public types only
      // expose an array overload for Cookie.
      .set(
        "Authorization",
        ["Bearer first", "Bearer second"] as unknown as string
      );

    assert.equal(response.status, 401);
    assert.deepEqual(response.body, unauthorizedBody);
    assert.deepEqual(verifier.tokens, []);
  });

  it("rejects an invalid token without leaking verifier details", async () => {
    const verifier = new MockAuthVerifier(
      undefined,
      new Error("provider rejected token at internal/auth.ts")
    );
    const response = await request(createApp(undefined, verifier))
      .get("/api/v1/auth/me")
      .set("Authorization", "Bearer invalid-token");

    assert.equal(response.status, 401);
    assert.deepEqual(response.body, unauthorizedBody);
    assert.doesNotMatch(JSON.stringify(response.body), /provider|internal|token at/i);
    assert.deepEqual(verifier.tokens, ["invalid-token"]);
  });

  for (const condition of ["expired", "revoked"]) {
    it(`returns the same generic response for a simulated ${condition} token`, async () => {
      const verifier = new MockAuthVerifier(
        undefined,
        new Error(`${condition} token reported by provider`)
      );
      const response = await request(createApp(undefined, verifier))
        .get("/api/v1/auth/me")
        .set("Authorization", `Bearer ${condition}-token`);

      assert.equal(response.status, 401);
      assert.deepEqual(response.body, unauthorizedBody);
      assert.doesNotMatch(JSON.stringify(response.body), /expired|revoked|provider/i);
    });
  }

  it("returns verified identity for a valid case-insensitive Bearer token", async () => {
    const verifier = new MockAuthVerifier({
      userId: "00000000-0000-4000-8000-000000000001",
      email: "demo@example.invalid"
    });
    const response = await request(createApp(undefined, verifier))
      .get("/api/v1/auth/me")
      .set("Authorization", "bEaReR synthetic-token");

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      user: {
        id: "00000000-0000-4000-8000-000000000001",
        email: "demo@example.invalid"
      }
    });
    assert.deepEqual(verifier.tokens, ["synthetic-token"]);
  });

  it("omits email when the verified provider identity has none", async () => {
    const verifier = new MockAuthVerifier({ userId: "verified-user" });
    const response = await request(createApp(undefined, verifier))
      .get("/api/v1/auth/me")
      .set("Authorization", "Bearer synthetic-token");

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { user: { id: "verified-user" } });
    assert.equal("email" in response.body.user, false);
  });

  it("does not allow client-supplied identity to override verified identity", async () => {
    const verifier = new MockAuthVerifier({ userId: "verified-user" });
    const response = await request(createApp(undefined, verifier))
      .get("/api/v1/auth/me?user_id=attacker")
      .set("Authorization", "Bearer synthetic-token")
      .set("X-User-Id", "attacker");

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { user: { id: "verified-user" } });
  });

  it("keeps health public without invoking authentication", async () => {
    const verifier = new MockAuthVerifier(
      undefined,
      new Error("Authentication should not run for health.")
    );
    const response = await request(createApp(undefined, verifier)).get("/health");

    assert.equal(response.status, 200);
    assert.deepEqual(verifier.tokens, []);
  });

  it("uses only the injected verifier in tests and makes no live provider call", async () => {
    const verifier = new MockAuthVerifier({ userId: "mock-only-user" });
    const response = await request(createApp(undefined, verifier))
      .get("/api/v1/auth/me")
      .set("Authorization", "Bearer offline-test-token");

    assert.equal(response.status, 200);
    assert.deepEqual(verifier.tokens, ["offline-test-token"]);
    assert.deepEqual(response.body, { user: { id: "mock-only-user" } });
  });
});
