import assert from "node:assert/strict";
import { describe, it } from "node:test";

import request from "supertest";

import { createApp } from "../src/app.js";
import type {
  UserSupabaseClient,
  UserSupabaseClientFactory
} from "../src/config/supabase-user.js";
import type { MedicineCabinetRepository } from "../src/repositories/medicine-cabinet.repository.js";
import type { PrescriptionHistoryRepository } from "../src/repositories/prescription-history.repository.js";
import type { ProfileRepository } from "../src/repositories/profile.repository.js";
import type { AuthVerifier, VerifiedIdentity } from "../src/services/auth.service.js";
import type { MedicineCabinetRow } from "../src/types/medicine-cabinet.js";

const userId = "00000000-0000-4000-8000-000000000001";
const otherUserId = "00000000-0000-4000-8000-000000000002";
const entryId = "30000000-0000-4000-8000-000000000001";
const secondEntryId = "30000000-0000-4000-8000-000000000002";
const medicineId = "40000000-0000-4000-8000-000000000001";

const row: MedicineCabinetRow = {
  id: entryId,
  user_id: userId,
  medicine_id: medicineId,
  quantity: "9007199254740993.125",
  purchase_date: null,
  expiry_date: "2027-01-01",
  refill_date: null,
  usage_information: null,
  created_at: "2026-11-11T10:00:00.000Z",
  updated_at: "2026-11-11T10:00:00.000Z"
};
const secondRow: MedicineCabinetRow = {
  ...row,
  id: secondEntryId,
  quantity: "1.5",
  purchase_date: "2026-11-01",
  usage_information: "Synthetic test instruction",
  created_at: "2026-11-10T10:00:00.000Z"
};

class TokenVerifier implements AuthVerifier {
  constructor(private readonly identities: Readonly<Record<string, VerifiedIdentity>>) {}
  async verifyAccessToken(token: string): Promise<VerifiedIdentity> {
    const identity = this.identities[token];
    if (!identity) throw new Error("invalid synthetic token");
    return identity;
  }
}

class CabinetRepositoryProbe implements MedicineCabinetRepository {
  readonly lists: Array<{ userId: string; pagination: { limit: number; offset: number } }> = [];
  readonly details: Array<{ userId: string; entryId: string }> = [];
  rows: readonly MedicineCabinetRow[] = [];
  detail: MedicineCabinetRow | null = null;
  failure?: Error;
  async listOwned(
    _client: UserSupabaseClient,
    ownerId: string,
    pagination: { readonly limit: number; readonly offset: number }
  ) {
    this.lists.push({ userId: ownerId, pagination: { ...pagination } });
    if (this.failure) throw this.failure;
    return this.rows;
  }
  async findOwnedDetail(
    _client: UserSupabaseClient,
    ownerId: string,
    recordId: string
  ) {
    this.details.push({ userId: ownerId, entryId: recordId });
    if (this.failure) throw this.failure;
    return this.detail;
  }
}

const unusedProfileRepository = {
  async findApplicationUser() { throw new Error("not used"); },
  async findHealthProfile() { throw new Error("not used"); },
  async updateApplicationUser() { throw new Error("not used"); },
  async createHealthProfile() { throw new Error("not used"); },
  async updateHealthProfile() { throw new Error("not used"); }
} as ProfileRepository;
const unusedHistoryRepository = {
  async listOwned() { throw new Error("prescription history not used"); },
  async findOwnedDetail() { throw new Error("prescription history not used"); }
} as PrescriptionHistoryRepository;

function harness() {
  const repository = new CabinetRepositoryProbe();
  const tokens: string[] = [];
  const factory: UserSupabaseClientFactory = (token) => {
    tokens.push(token);
    return { marker: token } as unknown as UserSupabaseClient;
  };
  const app = createApp(
    undefined,
    new TokenVerifier({ token: { userId } }),
    factory,
    unusedProfileRepository,
    () => { throw new Error("cabinet must not construct upload dependencies"); },
    unusedHistoryRepository,
    repository
  );
  return { app, repository, tokens };
}

const auth = { Authorization: "Bearer token" };
const publicItem = {
  id: entryId,
  medicine_id: medicineId,
  quantity: "9007199254740993.125",
  purchase_date: null,
  expiry_date: "2027-01-01",
  refill_date: null,
  usage_information: null,
  created_at: "2026-11-11T10:00:00.000Z",
  updated_at: "2026-11-11T10:00:00.000Z"
};

describe("Authenticated read-only medicine cabinet APIs", () => {
  for (const path of ["/api/v1/medicine-cabinet", `/api/v1/medicine-cabinet/${entryId}`]) {
    it(`rejects missing and invalid authentication for ${path}`, async () => {
      const missing = harness();
      assert.equal((await request(missing.app).get(path)).status, 401);
      assert.equal(missing.repository.lists.length + missing.repository.details.length, 0);
      const invalid = harness();
      assert.equal((await request(invalid.app).get(path)
        .set("Authorization", "Bearer invalid")).status, 401);
      assert.equal(invalid.repository.lists.length + invalid.repository.details.length, 0);
    });
  }

  it("returns an empty default page scoped to the verified owner", async () => {
    const current = harness();
    const response = await request(current.app).get("/api/v1/medicine-cabinet").set(auth);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      items: [],
      pagination: {
        limit: 20,
        offset: 0,
        returned: 0,
        has_more: false,
        next_offset: null
      }
    });
    assert.deepEqual(current.repository.lists, [
      { userId, pagination: { limit: 20, offset: 0 } }
    ]);
    assert.deepEqual(current.tokens, ["token"]);
  });

  it("returns only the public allowlist and exact numeric strings", async () => {
    const current = harness();
    current.repository.rows = [{
      ...row,
      family_member_id: "must-not-leak",
      provider_private: "must-not-leak"
    } as MedicineCabinetRow];
    const response = await request(current.app).get("/api/v1/medicine-cabinet").set(auth);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.items, [publicItem]);
    assert.equal(JSON.stringify(response.body).includes("user_id"), false);
    assert.equal(JSON.stringify(response.body).includes("family_member_id"), false);
    assert.equal(JSON.stringify(response.body).includes("provider_private"), false);
  });

  it("uses one lookahead row for bounded pagination", async () => {
    const current = harness();
    current.repository.rows = [row, secondRow];
    const response = await request(current.app)
      .get("/api/v1/medicine-cabinet?limit=1&offset=5").set(auth);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.items, [publicItem]);
    assert.deepEqual(response.body.pagination, {
      limit: 1,
      offset: 5,
      returned: 1,
      has_more: true,
      next_offset: 6
    });
  });

  it("accepts maximum pagination bounds", async () => {
    const current = harness();
    assert.equal((await request(current.app)
      .get("/api/v1/medicine-cabinet?limit=50&offset=1000000").set(auth)).status, 200);
    assert.deepEqual(current.repository.lists[0]?.pagination, {
      limit: 50,
      offset: 1_000_000
    });
  });

  it("rejects malformed, negative, duplicate, excessive and unexpected pagination", async () => {
    for (const query of [
      "?limit=0", "?limit=-1", "?limit=51", "?limit=01", "?limit=1.5",
      "?offset=-1", "?offset=1000001", "?limit=1&limit=2", "?sort=id"
    ]) {
      const current = harness();
      const response = await request(current.app)
        .get(`/api/v1/medicine-cabinet${query}`).set(auth);
      assert.equal(response.status, 400, query);
      assert.equal(response.body.error.code, "INVALID_MEDICINE_CABINET_QUERY");
      assert.equal(current.repository.lists.length, 0);
    }
  });

  it("returns a valid nullable detail with fractional quantity preserved", async () => {
    const current = harness();
    current.repository.detail = { ...row, quantity: "1.5000" };
    const response = await request(current.app)
      .get(`/api/v1/medicine-cabinet/${entryId}`).set(auth);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      entry: { ...publicItem, quantity: "1.5000" }
    });
    assert.deepEqual(current.repository.details, [{ userId, entryId }]);
  });

  it("rejects invalid UUID before repository access", async () => {
    const current = harness();
    const response = await request(current.app)
      .get("/api/v1/medicine-cabinet/not-a-uuid").set(auth);
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, "INVALID_MEDICINE_CABINET_ENTRY_ID");
    assert.equal(current.repository.details.length, 0);
  });

  it("returns indistinguishable 404 responses for missing and non-owned entries", async () => {
    const bodies: unknown[] = [];
    for (const detail of [null, { ...row, user_id: otherUserId }]) {
      const current = harness();
      current.repository.detail = detail;
      const response = await request(current.app)
        .get(`/api/v1/medicine-cabinet/${entryId}`).set(auth);
      assert.equal(response.status, 404);
      bodies.push(response.body);
    }
    assert.deepEqual(bodies[0], bodies[1]);
    assert.deepEqual(bodies[0], {
      error: {
        code: "MEDICINE_CABINET_ENTRY_NOT_FOUND",
        message: "Medicine cabinet entry not found."
      }
    });
  });

  it("fails closed on unsafe numeric and invalid provider rows", async () => {
    for (const invalidRow of [
      { ...row, quantity: 1.25 },
      { ...row, quantity: Number.MAX_SAFE_INTEGER + 1 },
      { ...row, quantity: "1e3" },
      { ...row, medicine_id: "not-a-uuid" },
      { ...row, purchase_date: 123 }
    ]) {
      const current = harness();
      current.repository.rows = [invalidRow as MedicineCabinetRow];
      const response = await request(current.app)
        .get("/api/v1/medicine-cabinet").set(auth);
      assert.equal(response.status, 500);
      assert.deepEqual(response.body, {
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "An unexpected error occurred."
        }
      });
    }
  });

  it("returns a generic response for repository failures", async () => {
    const current = harness();
    current.repository.failure = new Error("private provider diagnostic");
    const response = await request(current.app).get("/api/v1/medicine-cabinet").set(auth);
    assert.equal(response.status, 500);
    assert.equal(JSON.stringify(response.body).includes("private provider diagnostic"), false);
  });
});
