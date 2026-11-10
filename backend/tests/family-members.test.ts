import assert from "node:assert/strict";
import { describe, it } from "node:test";
import request from "supertest";

import { createApp } from "../src/app.js";
import type {
  UserSupabaseClient,
  UserSupabaseClientFactory
} from "../src/config/supabase-user.js";
import {
  FamilyMemberRepositoryError,
  type FamilyMemberRepository
} from "../src/repositories/family-member.repository.js";
import type { MedicineCabinetRepository } from "../src/repositories/medicine-cabinet.repository.js";
import type { PrescriptionHistoryRepository } from "../src/repositories/prescription-history.repository.js";
import type { ProfileRepository } from "../src/repositories/profile.repository.js";
import type { AuthVerifier, VerifiedIdentity } from "../src/services/auth.service.js";
import type {
  FamilyMemberInput,
  FamilyMemberRow,
  FamilyMemberUpdate
} from "../src/types/family-members.js";

const userId = "00000000-0000-4000-8000-000000000001";
const otherUserId = "00000000-0000-4000-8000-000000000002";
const memberId = "60000000-0000-4000-8000-000000000001";
const secondMemberId = "60000000-0000-4000-8000-000000000002";
const row: FamilyMemberRow = {
  id: memberId,
  user_id: userId,
  name: "Synthetic Test Member",
  relationship: "parent",
  created_at: "2026-11-11T10:00:00.000Z",
  updated_at: "2026-11-11T10:00:00.000Z"
};

class TokenVerifier implements AuthVerifier {
  async verifyAccessToken(token: string): Promise<VerifiedIdentity> {
    if (token !== "token") throw new Error("invalid synthetic token");
    return { userId };
  }
}

class RepositoryProbe implements FamilyMemberRepository {
  readonly lists: Array<{ userId: string; limit: number; offset: number }> = [];
  readonly details: Array<{ userId: string; memberId: string }> = [];
  readonly creates: Array<{ userId: string; input: FamilyMemberInput }> = [];
  readonly updates: Array<{ userId: string; memberId: string; input: FamilyMemberUpdate }> = [];
  readonly deletes: Array<{ userId: string; memberId: string }> = [];
  rows: readonly FamilyMemberRow[] = [];
  detail: FamilyMemberRow | null = null;
  created: FamilyMemberRow = row;
  updated: FamilyMemberRow | null = row;
  deleted: FamilyMemberRow | null = row;
  failure?: Error;
  async listOwned(_client: UserSupabaseClient, owner: string, page: { limit: number; offset: number }) {
    this.lists.push({ userId: owner, ...page }); if (this.failure) throw this.failure; return this.rows;
  }
  async findOwned(_client: UserSupabaseClient, owner: string, id: string) {
    this.details.push({ userId: owner, memberId: id }); if (this.failure) throw this.failure; return this.detail;
  }
  async createOwned(_client: UserSupabaseClient, owner: string, input: FamilyMemberInput) {
    this.creates.push({ userId: owner, input }); if (this.failure) throw this.failure; return this.created;
  }
  async updateOwned(_client: UserSupabaseClient, owner: string, id: string, input: FamilyMemberUpdate) {
    this.updates.push({ userId: owner, memberId: id, input }); if (this.failure) throw this.failure; return this.updated;
  }
  async deleteOwned(_client: UserSupabaseClient, owner: string, id: string) {
    this.deletes.push({ userId: owner, memberId: id }); if (this.failure) throw this.failure; return this.deleted;
  }
}

const unusedProfile = {
  async findApplicationUser() { throw new Error("unused"); },
  async findHealthProfile() { throw new Error("unused"); },
  async updateApplicationUser() { throw new Error("unused"); },
  async createHealthProfile() { throw new Error("unused"); },
  async updateHealthProfile() { throw new Error("unused"); }
} as ProfileRepository;
const unusedHistory = {
  async listOwned() { throw new Error("unused"); },
  async findOwnedDetail() { throw new Error("unused"); }
} as PrescriptionHistoryRepository;
const unusedCabinet = {
  async listOwned() { throw new Error("unused"); },
  async findOwnedDetail() { throw new Error("unused"); }
} as MedicineCabinetRepository;

function harness() {
  const repository = new RepositoryProbe();
  const tokens: string[] = [];
  const factory: UserSupabaseClientFactory = (token) => {
    tokens.push(token); return { marker: token } as unknown as UserSupabaseClient;
  };
  const app = createApp(
    undefined,
    new TokenVerifier(),
    factory,
    unusedProfile,
    () => { throw new Error("upload dependencies must remain unused"); },
    unusedHistory,
    unusedCabinet,
    repository
  );
  return { app, repository, tokens };
}

const auth = { Authorization: "Bearer token" };
const publicMember = {
  id: memberId,
  name: "Synthetic Test Member",
  relationship: "parent",
  created_at: "2026-11-11T10:00:00.000Z",
  updated_at: "2026-11-11T10:00:00.000Z"
};

describe("Authenticated family member CRUD APIs", () => {
  for (const method of ["get-list", "get-detail", "post", "patch", "delete"] as const) {
    it(`requires valid authentication for ${method}`, async () => {
      for (const token of [undefined, "Bearer invalid"]) {
        const current = harness();
        let call = method === "get-list"
          ? request(current.app).get("/api/v1/family-members")
          : method === "get-detail"
            ? request(current.app).get(`/api/v1/family-members/${memberId}`)
            : method === "post"
              ? request(current.app).post("/api/v1/family-members").send({ name: "Synthetic" })
              : method === "patch"
                ? request(current.app).patch(`/api/v1/family-members/${memberId}`).send({ name: "Synthetic" })
                : request(current.app).delete(`/api/v1/family-members/${memberId}`);
        if (token) call = call.set("Authorization", token);
        assert.equal((await call).status, 401);
        assert.equal(
          current.repository.lists.length + current.repository.details.length +
          current.repository.creates.length + current.repository.updates.length +
          current.repository.deletes.length,
          0
        );
      }
    });
  }

  it("returns an empty owner-scoped default page", async () => {
    const current = harness();
    const response = await request(current.app).get("/api/v1/family-members").set(auth);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      items: [],
      pagination: { limit: 20, offset: 0, returned: 0, has_more: false, next_offset: null }
    });
    assert.deepEqual(current.repository.lists, [{ userId, limit: 20, offset: 0 }]);
  });

  it("returns only public fields and bounded lookahead pagination", async () => {
    const current = harness();
    current.repository.rows = [
      { ...row, private_provider_field: "must-not-leak" } as FamilyMemberRow,
      { ...row, id: secondMemberId }
    ];
    const response = await request(current.app)
      .get("/api/v1/family-members?limit=1&offset=5").set(auth);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      items: [publicMember],
      pagination: { limit: 1, offset: 5, returned: 1, has_more: true, next_offset: 6 }
    });
    assert.equal(JSON.stringify(response.body).includes("user_id"), false);
    assert.equal(JSON.stringify(response.body).includes("private_provider_field"), false);
  });

  it("accepts max pagination and rejects malformed, duplicate and unknown parameters", async () => {
    const maximum = harness();
    assert.equal((await request(maximum.app)
      .get("/api/v1/family-members?limit=50&offset=1000000").set(auth)).status, 200);
    for (const query of [
      "?limit=0", "?limit=51", "?limit=-1", "?limit=01", "?limit=1.5",
      "?offset=-1", "?offset=1000001", "?limit=1&limit=2", "?sort=id"
    ]) {
      const current = harness();
      const response = await request(current.app).get(`/api/v1/family-members${query}`).set(auth);
      assert.equal(response.status, 400, query);
      assert.equal(response.body.error.code, "INVALID_FAMILY_MEMBER_QUERY");
      assert.equal(current.repository.lists.length, 0);
    }
  });

  it("returns detail and indistinguishable 404 for missing or non-owned rows", async () => {
    const found = harness(); found.repository.detail = row;
    assert.deepEqual((await request(found.app)
      .get(`/api/v1/family-members/${memberId}`).set(auth)).body, { member: publicMember });
    const bodies: unknown[] = [];
    for (const detail of [null, { ...row, user_id: otherUserId }]) {
      const current = harness(); current.repository.detail = detail;
      const response = await request(current.app)
        .get(`/api/v1/family-members/${memberId}`).set(auth);
      assert.equal(response.status, 404); bodies.push(response.body);
    }
    assert.deepEqual(bodies[0], bodies[1]);
  });

  it("rejects invalid UUIDs before detail or mutation repository access", async () => {
    for (const method of ["get", "patch", "delete"] as const) {
      const current = harness();
      const call = method === "get"
        ? request(current.app).get("/api/v1/family-members/not-a-uuid")
        : method === "patch"
          ? request(current.app).patch("/api/v1/family-members/not-a-uuid").send({ name: "X" })
          : request(current.app).delete("/api/v1/family-members/not-a-uuid");
      const response = await call.set(auth);
      assert.equal(response.status, 400);
      assert.equal(response.body.error.code, "INVALID_FAMILY_MEMBER_ID");
    }
  });

  it("creates a normalized synthetic member with JWT-derived ownership", async () => {
    const current = harness();
    const response = await request(current.app).post("/api/v1/family-members")
      .set(auth).send({ name: "  Synthetic Test Member  ", relationship: " parent " });
    assert.equal(response.status, 201);
    assert.deepEqual(response.body, { member: publicMember });
    assert.deepEqual(current.repository.creates, [{
      userId,
      input: { name: "Synthetic Test Member", relationship: "parent" }
    }]);
  });

  it("stores an omitted or explicit-null relationship as null", async () => {
    for (const body of [{ name: "Synthetic" }, { name: "Synthetic", relationship: null }]) {
      const current = harness();
      assert.equal((await request(current.app).post("/api/v1/family-members")
        .set(auth).send(body)).status, 201);
      assert.equal(current.repository.creates[0]?.input.relationship, null);
    }
  });

  it("rejects invalid create bodies and protected or unknown fields", async () => {
    for (const body of [
      {}, [], "primitive", { relationship: "parent" }, { name: "" },
      { name: " ".repeat(101) }, { name: "X".repeat(101) },
      { name: "X", relationship: "" }, { name: "X", relationship: 2 },
      { name: "X", relationship: "R".repeat(101) },
      { name: "X", user_id: otherUserId }, { name: "X", id: memberId },
      { name: "X", created_at: "private" }, { name: "X", unexpected: true }
    ]) {
      const current = harness();
      const response = await request(current.app).post("/api/v1/family-members")
        .set(auth).send(body);
      assert.equal(response.status, 400);
      assert.equal(response.body.error.code, "INVALID_FAMILY_MEMBER_INPUT");
      assert.equal(current.repository.creates.length, 0);
    }
  });

  it("rejects a JSON null create body", async () => {
    const current = harness();
    const response = await request(current.app).post("/api/v1/family-members")
      .set(auth).set("Content-Type", "application/json").send("null");
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, "INVALID_JSON");
    assert.equal(current.repository.creates.length, 0);
  });

  it("accepts exact 100-character name and relationship boundaries", async () => {
    const current = harness();
    const name = "N".repeat(100);
    const relationship = "R".repeat(100);
    assert.equal((await request(current.app).post("/api/v1/family-members")
      .set(auth).send({ name, relationship })).status, 201);
    assert.deepEqual(current.repository.creates[0]?.input, { name, relationship });
  });

  it("patches only supplied fields and preserves omission", async () => {
    const current = harness();
    current.repository.updated = { ...row, relationship: null };
    const response = await request(current.app).patch(`/api/v1/family-members/${memberId}`)
      .set(auth).send({ relationship: null });
    assert.equal(response.status, 200);
    assert.deepEqual(current.repository.updates, [{
      userId, memberId, input: { relationship: null }
    }]);
  });

  it("rejects empty, null-name, protected and unknown patches", async () => {
    for (const body of [
      {}, [], "primitive", { name: null }, { name: "" },
      { name: "X".repeat(101) }, { relationship: "" },
      { relationship: "R".repeat(101) },
      { user_id: otherUserId }, { updated_at: "private" }, { unknown: true }
    ]) {
      const current = harness();
      const response = await request(current.app).patch(`/api/v1/family-members/${memberId}`)
        .set(auth).send(body);
      assert.equal(response.status, 400);
      assert.equal(current.repository.updates.length, 0);
    }
  });

  it("rejects a JSON null patch body", async () => {
    const current = harness();
    const response = await request(current.app).patch(`/api/v1/family-members/${memberId}`)
      .set(auth).set("Content-Type", "application/json").send("null");
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, "INVALID_JSON");
    assert.equal(current.repository.updates.length, 0);
  });

  it("rejects malformed persisted rows with a generic response", async () => {
    const malformedRows: FamilyMemberRow[] = [
      { ...row, id: "not-a-uuid" },
      { ...row, name: "" },
      { ...row, name: " untrimmed " },
      { ...row, name: "N".repeat(101) },
      { ...row, relationship: "" },
      { ...row, relationship: " untrimmed " },
      { ...row, relationship: "R".repeat(101) },
      { ...row, created_at: "not-a-timestamp" },
      { ...row, updated_at: "not-a-timestamp" }
    ];
    for (const malformed of malformedRows) {
      const current = harness();
      current.repository.rows = [malformed];
      const response = await request(current.app).get("/api/v1/family-members").set(auth);
      assert.equal(response.status, 500);
      assert.deepEqual(response.body, {
        error: { code: "INTERNAL_SERVER_ERROR", message: "An unexpected error occurred." }
      });
    }
  });

  it("rejects wrong-owner mutation results without exposing identifiers", async () => {
    for (const operation of ["create", "update", "delete"] as const) {
      const current = harness();
      const wrongOwner = { ...row, user_id: otherUserId };
      if (operation === "create") current.repository.created = wrongOwner;
      else if (operation === "update") current.repository.updated = wrongOwner;
      else current.repository.deleted = wrongOwner;
      const response = operation === "create"
        ? await request(current.app).post("/api/v1/family-members")
            .set(auth).send({ name: "Synthetic" })
        : operation === "update"
          ? await request(current.app).patch(`/api/v1/family-members/${memberId}`)
              .set(auth).send({ name: "Synthetic" })
          : await request(current.app).delete(`/api/v1/family-members/${memberId}`).set(auth);
      assert.equal(response.status, operation === "create" ? 500 : 404);
      assert.equal(JSON.stringify(response.body).includes(otherUserId), false);
    }
  });

  it("returns the same 404 for missing and non-owned PATCH and DELETE", async () => {
    for (const operation of ["patch", "delete"] as const) {
      const bodies: unknown[] = [];
      for (const result of [null, { ...row, user_id: otherUserId }]) {
        const current = harness();
        if (operation === "patch") current.repository.updated = result;
        else current.repository.deleted = result;
        const response = operation === "patch"
          ? await request(current.app).patch(`/api/v1/family-members/${memberId}`)
              .set(auth).send({ name: "Synthetic" })
          : await request(current.app).delete(`/api/v1/family-members/${memberId}`).set(auth);
        assert.equal(response.status, 404); bodies.push(response.body);
      }
      assert.deepEqual(bodies[0], bodies[1]);
    }
  });

  it("deletes only the owner-scoped member and returns 204 without a body", async () => {
    const current = harness();
    const response = await request(current.app)
      .delete(`/api/v1/family-members/${memberId}`).set(auth);
    assert.equal(response.status, 204);
    assert.equal(response.text, "");
    assert.deepEqual(current.repository.deletes, [{ userId, memberId }]);
  });

  it("maps missing parent safely and redacts provider and returned ownership failures", async () => {
    const missingParent = harness();
    missingParent.repository.failure = new FamilyMemberRepositoryError("MISSING_APPLICATION_PROFILE");
    const conflict = await request(missingParent.app).post("/api/v1/family-members")
      .set(auth).send({ name: "Synthetic" });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.error.code, "APPLICATION_PROFILE_REQUIRED");

    const provider = harness();
    provider.repository.failure = new Error("private provider diagnostic");
    const failed = await request(provider.app).get("/api/v1/family-members").set(auth);
    assert.equal(failed.status, 500);
    assert.equal(JSON.stringify(failed.body).includes("private provider diagnostic"), false);

    const wrongOwner = harness();
    wrongOwner.repository.created = { ...row, user_id: otherUserId };
    const rejected = await request(wrongOwner.app).post("/api/v1/family-members")
      .set(auth).send({ name: "Synthetic" });
    assert.equal(rejected.status, 500);
    assert.equal(JSON.stringify(rejected.body).includes(otherUserId), false);
  });

  it("uses only injected scoped dependencies with no external or medicine operations", async () => {
    const current = harness();
    await request(current.app).get("/api/v1/family-members").set(auth);
    assert.deepEqual(current.tokens, ["token"]);
  });
});
