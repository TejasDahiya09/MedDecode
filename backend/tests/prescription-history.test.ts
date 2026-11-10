import assert from "node:assert/strict";
import { describe, it } from "node:test";

import request from "supertest";

import { createApp } from "../src/app.js";
import type {
  UserSupabaseClient,
  UserSupabaseClientFactory
} from "../src/config/supabase-user.js";
import type { PrescriptionHistoryRepository } from "../src/repositories/prescription-history.repository.js";
import type { ProfileRepository } from "../src/repositories/profile.repository.js";
import type { AuthVerifier, VerifiedIdentity } from "../src/services/auth.service.js";
import type { PrescriptionHistoryRow } from "../src/types/prescriptions.js";

const userId = "00000000-0000-4000-8000-000000000001";
const otherUserId = "00000000-0000-4000-8000-000000000002";
const prescriptionId = "10000000-0000-4000-8000-000000000001";
const secondPrescriptionId = "10000000-0000-4000-8000-000000000002";

const row: PrescriptionHistoryRow = {
  id: prescriptionId,
  user_id: userId,
  file_type: "application/pdf",
  file_size_bytes: "9007199254740993",
  status: "uploaded",
  prescription_date: null,
  created_at: "2026-11-11T10:00:00.000Z",
  updated_at: "2026-11-11T10:00:00.000Z",
  processed_at: null
};

const secondRow: PrescriptionHistoryRow = {
  ...row,
  id: secondPrescriptionId,
  file_type: "image/png",
  file_size_bytes: 42,
  status: "completed_with_warnings",
  prescription_date: "2026-11-10",
  processed_at: "2026-11-11T10:05:00.000Z"
};

class TokenVerifier implements AuthVerifier {
  readonly tokens: string[] = [];
  constructor(private readonly identities: Readonly<Record<string, VerifiedIdentity>>) {}
  async verifyAccessToken(token: string): Promise<VerifiedIdentity> {
    this.tokens.push(token);
    const identity = this.identities[token];
    if (!identity) throw new Error("invalid synthetic token");
    return identity;
  }
}

class HistoryRepositoryProbe implements PrescriptionHistoryRepository {
  readonly lists: Array<{
    client: UserSupabaseClient;
    userId: string;
    pagination: { limit: number; offset: number };
  }> = [];
  readonly details: Array<{
    client: UserSupabaseClient;
    userId: string;
    prescriptionId: string;
  }> = [];
  rows: readonly PrescriptionHistoryRow[] = [];
  detail: PrescriptionHistoryRow | null = null;
  failure?: Error;

  async listOwned(
    client: UserSupabaseClient,
    ownerId: string,
    pagination: { readonly limit: number; readonly offset: number }
  ) {
    this.lists.push({ client, userId: ownerId, pagination: { ...pagination } });
    if (this.failure) throw this.failure;
    return this.rows;
  }

  async findOwnedDetail(
    client: UserSupabaseClient,
    ownerId: string,
    recordId: string
  ) {
    this.details.push({ client, userId: ownerId, prescriptionId: recordId });
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

function harness() {
  const verifier = new TokenVerifier({ token: { userId } });
  const repository = new HistoryRepositoryProbe();
  const clients: UserSupabaseClient[] = [];
  const tokens: string[] = [];
  const factory: UserSupabaseClientFactory = (token) => {
    tokens.push(token);
    const client = { marker: token } as unknown as UserSupabaseClient;
    clients.push(client);
    return client;
  };
  let uploadDependenciesConstructed = 0;
  const app = createApp(
    undefined,
    verifier,
    factory,
    unusedProfileRepository,
    () => {
      uploadDependenciesConstructed += 1;
      throw new Error("history must not construct S3/upload dependencies");
    },
    repository
  );
  return {
    app,
    verifier,
    repository,
    clients,
    tokens,
    uploadDependenciesConstructed: () => uploadDependenciesConstructed
  };
}

const auth = { Authorization: "Bearer token" };
const publicItem = {
  id: prescriptionId,
  file_type: "application/pdf",
  file_size_bytes: "9007199254740993",
  status: "uploaded",
  prescription_date: null,
  created_at: "2026-11-11T10:00:00.000Z",
  updated_at: "2026-11-11T10:00:00.000Z",
  processed_at: null
};

describe("Authenticated prescription history APIs", () => {
  for (const path of ["/api/v1/prescriptions", `/api/v1/prescriptions/${prescriptionId}`]) {
    it(`rejects missing and invalid authentication for ${path}`, async () => {
      for (const authorization of [undefined, "Bearer invalid"]) {
        const current = harness();
        let pending = request(current.app).get(path);
        if (authorization) pending = pending.set("Authorization", authorization);
        const response = await pending;
        assert.equal(response.status, 401);
        assert.deepEqual(current.repository.lists, []);
        assert.deepEqual(current.repository.details, []);
        assert.equal(current.uploadDependenciesConstructed(), 0);
      }
    });
  }

  it("returns an empty default page", async () => {
    const current = harness();
    const response = await request(current.app)
      .get("/api/v1/prescriptions")
      .set(auth);
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
    assert.deepEqual(current.repository.lists[0]?.pagination, { limit: 20, offset: 0 });
  });

  it("returns only allowlisted owned metadata with bigint precision", async () => {
    const current = harness();
    current.repository.rows = [{
      ...row,
      storage_bucket: "must-not-appear",
      object_key: "must-not-appear",
      original_filename: "patient.pdf",
      ocr_text: "private OCR",
      patient_name: "private patient"
    } as PrescriptionHistoryRow];
    const response = await request(current.app)
      .get("/api/v1/prescriptions")
      .set(auth);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.items, [publicItem]);
    const serialized = JSON.stringify(response.body);
    assert.doesNotMatch(serialized, /must-not-appear|patient\.pdf|private OCR|private patient/);
    assert.equal(current.repository.lists[0]?.userId, userId);
    assert.equal(current.repository.lists[0]?.client, current.clients[0]);
    assert.equal(current.uploadDependenciesConstructed(), 0);
  });

  it("returns bounded pagination and removes the lookahead row", async () => {
    const current = harness();
    current.repository.rows = [row, secondRow];
    const response = await request(current.app)
      .get("/api/v1/prescriptions?limit=1&offset=5")
      .set(auth);
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

  it("accepts the maximum limit", async () => {
    const current = harness();
    const response = await request(current.app)
      .get("/api/v1/prescriptions?limit=50&offset=1000000")
      .set(auth);
    assert.equal(response.status, 200);
    assert.deepEqual(current.repository.lists[0]?.pagination, {
      limit: 50,
      offset: 1_000_000
    });
  });

  it("rejects malformed, negative, duplicate, excessive and unexpected query parameters", async () => {
    for (const query of [
      "?limit=0", "?limit=51", "?limit=-1", "?limit=1.5", "?limit=01",
      "?offset=-1", "?offset=1000001", "?limit=10&limit=20", "?page=1"
    ]) {
      const current = harness();
      const response = await request(current.app)
        .get(`/api/v1/prescriptions${query}`)
        .set(auth);
      assert.equal(response.status, 400, query);
      assert.equal(response.body.error.code, "INVALID_PRESCRIPTION_QUERY");
      assert.deepEqual(current.repository.lists, []);
    }
  });

  it("returns an allowlisted detail with nullable metadata", async () => {
    const current = harness();
    current.repository.detail = row;
    const response = await request(current.app)
      .get(`/api/v1/prescriptions/${prescriptionId}`)
      .set(auth);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { prescription: publicItem });
    assert.deepEqual(current.repository.details[0], {
      client: current.clients[0], userId, prescriptionId
    });
  });

  it("rejects an invalid prescription UUID before querying", async () => {
    const current = harness();
    const response = await request(current.app)
      .get("/api/v1/prescriptions/not-a-uuid")
      .set(auth);
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, "INVALID_PRESCRIPTION_ID");
    assert.deepEqual(current.repository.details, []);
  });

  it("returns indistinguishable 404 responses for missing and non-owned records", async () => {
    const bodies: unknown[] = [];
    for (const detail of [null, { ...row, user_id: otherUserId }]) {
      const current = harness();
      current.repository.detail = detail;
      const response = await request(current.app)
        .get(`/api/v1/prescriptions/${prescriptionId}`)
        .set(auth);
      assert.equal(response.status, 404);
      bodies.push(response.body);
    }
    assert.deepEqual(bodies[0], bodies[1]);
    assert.deepEqual(bodies[0], {
      error: { code: "PRESCRIPTION_NOT_FOUND", message: "Prescription not found." }
    });
  });

  it("fails safely on provider errors and unsafe numeric bigint values", async () => {
    const providerFailure = harness();
    providerFailure.repository.failure = new Error(
      "private object_key and Supabase diagnostic"
    );
    const failed = await request(providerFailure.app)
      .get("/api/v1/prescriptions")
      .set(auth);
    assert.equal(failed.status, 500);
    assert.doesNotMatch(JSON.stringify(failed.body), /object_key|Supabase|diagnostic/i);

    const unsafeSize = harness();
    unsafeSize.repository.rows = [{ ...row, file_size_bytes: Number.MAX_SAFE_INTEGER + 1 }];
    const unsafe = await request(unsafeSize.app)
      .get("/api/v1/prescriptions")
      .set(auth);
    assert.equal(unsafe.status, 500);
    assert.equal(unsafe.body.error.code, "INTERNAL_SERVER_ERROR");
  });
});
