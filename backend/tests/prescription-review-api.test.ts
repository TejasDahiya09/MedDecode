import assert from "node:assert/strict";
import { describe, it } from "node:test";

import request from "supertest";

import { createApp } from "../src/app.js";
import { createInitialReviewDraft, type ReviewMedicineFieldsV1 } from "../src/domain/prescription-review/index.js";
import type { UserSupabaseClient, UserSupabaseClientFactory } from "../src/config/supabase-user.js";
import { InMemoryPrescriptionReviewRepository } from "../src/repositories/in-memory-prescription-review.repository.js";
import { PrescriptionReviewRepositoryError } from "../src/repositories/prescription-review.repository.js";
import { PostgresPrescriptionReviewRepository } from '../src/repositories/postgres-prescription-review.repository.js';
import type { ProfileRepository } from "../src/repositories/profile.repository.js";
import type { AuthVerifier, VerifiedIdentity } from "../src/services/auth.service.js";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "00000000-0000-4000-8000-000000000002";
const PRESCRIPTION_ID = "10000000-0000-4000-8000-000000000001";
const EVIDENCE_ID = "20000000-0000-4000-8000-000000000002";
const REVISION_ID = "30000000-0000-4000-8000-000000000003";
const MEDICINE_ID = "40000000-0000-4000-8000-000000000004";
const ADDED_ID = "50000000-0000-4000-8000-000000000005";
const JOB_ID = "60000000-0000-4000-8000-000000000006";
const BASE = `/api/v1/prescriptions/${PRESCRIPTION_ID}`;
const AUTH = { Authorization: "Bearer owner" };

const medicine = (name = "Examplemed"): ReviewMedicineFieldsV1 => ({
  medicineName: name, brandName: null, genericName: null,
  strength: { value: "500", unit: "mg" }, dosageForm: "tablet",
  dose: { value: "1", unit: "tablet" }, frequency: "twice daily",
  timing: "after food", route: "oral", duration: { value: "5", unit: "days" },
  quantity: { value: "10", unit: "tablets" }, notes: null,
});

class Verifier implements AuthVerifier {
  async verifyAccessToken(token: string): Promise<VerifiedIdentity> {
    if (token === "owner") return { userId: USER_ID };
    if (token === "other") return { userId: OTHER_USER_ID };
    throw new Error("invalid token");
  }
}

const unusedProfiles = {
  async findApplicationUser() { throw new Error("not used"); },
  async findHealthProfile() { throw new Error("not used"); },
  async updateApplicationUser() { throw new Error("not used"); },
  async createHealthProfile() { throw new Error("not used"); },
  async updateHealthProfile() { throw new Error("not used"); },
} as ProfileRepository;

function harness(enabled = true) {
  const initial = createInitialReviewDraft({
    prescriptionId: PRESCRIPTION_ID, revisionId: REVISION_ID,
    evidence: { evidenceSetId: EVIDENCE_ID, schemaVersion: "ocr-evidence.v1", documentSha256: "a".repeat(64) },
    medicines: [{ medicineId: MEDICINE_ID, fields: medicine() }],
    now: "2026-11-15T10:00:00.000Z",
  });
  const repository = new InMemoryPrescriptionReviewRepository([{
    ownerId: USER_ID, prescriptionId: PRESCRIPTION_ID, revisions: [initial],
    evidence: { evidenceSetId: EVIDENCE_ID, prescriptionId: PRESCRIPTION_ID, schemaVersion: "ocr-evidence.v1", documentSha256: "a".repeat(64), pageCount: 1, providerCount: 2, createdAt: "2026-11-15T10:00:00.000Z" },
  }]);
  const factory: UserSupabaseClientFactory = () => ({ test: true } as unknown as UserSupabaseClient);
  const app = createApp(undefined, new Verifier(), factory, unusedProfiles,
    () => { throw new Error("upload not used"); }, undefined, undefined, undefined, undefined, undefined,
    { enabled, repositoryFactory: () => repository });
  return { app, repository };
}

describe("Prescription review V3 API foundation", () => {
  it('returns 404 for a successful missing draft and 503 for an actual RPC failure', async () => {
    for (const mode of ['missing', 'failure', 'malformed', 'unauthorized'] as const) {
      const client = { rpc: async (name: string) => name === 'meddecode_has_owned_prescription_review_v1'
        ? { data: mode !== 'unauthorized', error: null }
        : mode === 'failure' ? { data: null, error: { code: '08006', message: 'private database detail' }, status: 503 }
        : { data: mode === 'malformed' ? {} : null, error: null } } as unknown as UserSupabaseClient;
      const repository = new PostgresPrescriptionReviewRepository(client);
      const app = createApp(undefined, new Verifier(), () => client, unusedProfiles,
        () => { throw new Error('not used'); }, undefined, undefined, undefined, undefined, undefined,
        { enabled: true, repositoryFactory: () => repository });
      const result = await request(app).get(`${BASE}/review`).set(AUTH);
      assert.equal(result.status, mode === 'failure' || mode === 'malformed' ? 503 : 404);
      assert.doesNotMatch(JSON.stringify(result.body), /private database detail/);
    }
  });
  it("is disabled by default/flag and does not alter existing routing", async () => {
    const current = harness(false);
    const response = await request(current.app).get(`${BASE}/review`).set(AUTH);
    assert.equal(response.status, 404);
    assert.equal(response.body.error.code, "NOT_FOUND");
  });

  it("requires authentication before repository access", async () => {
    const current = harness();
    for (const path of [`${BASE}/review`, `${BASE}/review/revisions`, `${BASE}/evidence`]) {
      assert.equal((await request(current.app).get(path)).status, 401);
    }
  });

  it("fetches only the owner review, history and bounded evidence metadata", async () => {
    const current = harness();
    const review = await request(current.app).get(`${BASE}/review`).set(AUTH);
    assert.equal(review.status, 200);
    assert.equal(review.body.prescriptionId, PRESCRIPTION_ID);
    const history = await request(current.app).get(`${BASE}/review/revisions`).set(AUTH);
    assert.equal(history.status, 200);
    assert.equal(history.body.revisions.length, 1);
    const evidence = await request(current.app).get(`${BASE}/evidence`).set(AUTH);
    assert.equal(evidence.status, 200);
    assert.deepEqual(Object.keys(evidence.body).sort(), ["createdAt", "documentSha256", "evidenceSetId", "pageCount", "prescriptionId", "providerCount", "schemaVersion"]);
    assert.doesNotMatch(JSON.stringify(evidence.body), /bucket|object|prescription text|credential/i);
  });

  it("makes missing and cross-owner access indistinguishable", async () => {
    const current = harness();
    const denied = await request(current.app).get(`${BASE}/review`).set("Authorization", "Bearer other");
    const missing = await request(current.app).get("/api/v1/prescriptions/90000000-0000-4000-8000-000000000009/review").set(AUTH);
    assert.equal(denied.status, 404);
    assert.deepEqual(denied.body, missing.body);
    assert.equal(denied.body.error.code, "PRESCRIPTION_NOT_FOUND");
  });

  it("edits, adds, removes, restores and saves with lock-version protection", async () => {
    const current = harness();
    let lock = 0;
    const send = async (operation: unknown) => {
      const response = await request(current.app).patch(`${BASE}/review/draft`).set(AUTH).send({ expectedRevisionNumber: 1, expectedLockVersion: lock, operation });
      assert.equal(response.status, 200, JSON.stringify(response.body));
      lock = response.body.lockVersion;
      return response;
    };
    await send({ type: "edit_fields", medicineId: MEDICINE_ID, updates: { medicineName: "Correctedmed", strengthValue: "250" } });
    await send({ type: "add_medicine", commandId: "add-1", medicineId: ADDED_ID, fields: medicine("Missingmed") });
    await send({ type: "remove_medicine", medicineId: MEDICINE_ID });
    await send({ type: "restore_medicine", medicineId: MEDICINE_ID });
    const saved = await send({ type: "save_draft" });
    assert.equal(saved.body.medicines.length, 2);
    assert.equal(current.repository.eventsFor(USER_ID, PRESCRIPTION_ID).length, 5);

    const stale = await request(current.app).patch(`${BASE}/review/draft`).set(AUTH).send({ expectedRevisionNumber: 1, expectedLockVersion: 0, operation: { type: "save_draft" } });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, "REVIEW_STALE");
  });

  it("rejects client owner IDs, malformed fields and invalid medicine values", async () => {
    const current = harness();
    const owner = await request(current.app).patch(`${BASE}/review/draft`).set(AUTH).send({ expectedRevisionNumber: 1, expectedLockVersion: 0, ownerId: OTHER_USER_ID, operation: { type: "save_draft" } });
    assert.equal(owner.status, 400);
    const malformed = await request(current.app).patch(`${BASE}/review/draft`).set(AUTH).send({ expectedRevisionNumber: 1, expectedLockVersion: 0, operation: { type: "edit_fields", medicineId: MEDICINE_ID, updates: { strengthValue: "500mg" } } });
    assert.equal(malformed.status, 400);
    assert.equal(malformed.body.error.code, "REVIEW_INVALID");
  });

  it("confirms once, replays safely, creates one pending request and records no medical verification", async () => {
    const current = harness();
    const body = { expectedRevisionNumber: 1, expectedLockVersion: 0, idempotencyKey: "confirm-1" };
    const first = await request(current.app).post(`${BASE}/review/confirm`).set(AUTH).send(body);
    assert.equal(first.status, 200);
    assert.equal(first.body.review.status, "confirmed");
    assert.match(first.body.review.confirmation.statement, /not medical verification/i);
    const second = await request(current.app).post(`${BASE}/review/confirm`).set(AUTH).send(body);
    assert.equal(second.status, 200);
    assert.equal(second.body.intelligenceRequest.requestKey, first.body.intelligenceRequest.requestKey);
    assert.equal(current.repository.eventsFor(USER_ID, PRESCRIPTION_ID).filter((event) => event.type === "revision_confirmed").length, 1);
  });

  it("reopens a confirmed review as immutable history and rejects stale result completion", async () => {
    const current = harness();
    const confirmed = await request(current.app).post(`${BASE}/review/confirm`).set(AUTH).send({ expectedRevisionNumber: 1, expectedLockVersion: 0, idempotencyKey: "confirm-1" });
    const binding = confirmed.body.intelligenceRequest;
    await current.repository.bindProcessingJob(USER_ID, binding.requestKey, JOB_ID);
    const reopened = await request(current.app).post(`${BASE}/review/reopen`).set(AUTH).send({ expectedRevisionNumber: 1, expectedLockVersion: 1 });
    assert.equal(reopened.status, 201);
    assert.equal(reopened.body.revisionNumber, 2);
    const history = await request(current.app).get(`${BASE}/review/revisions`).set(AUTH);
    assert.deepEqual(history.body.revisions.map((item: { revisionNumber: number }) => item.revisionNumber), [2, 1]);
    await assert.rejects(() => current.repository.acceptCurrentResult(USER_ID, {
      prescriptionId: PRESCRIPTION_ID, confirmedRevisionId: REVISION_ID,
      inputFingerprint: binding.inputFingerprint, processingJobId: JOB_ID,
    }), (error: unknown) => error instanceof PrescriptionReviewRepositoryError && error.code === "STALE");
  });

  it("accepts a result only when prescription, latest revision, fingerprint and job all match", async () => {
    const current = harness();
    const confirmed = await request(current.app).post(`${BASE}/review/confirm`).set(AUTH).send({ expectedRevisionNumber: 1, expectedLockVersion: 0, idempotencyKey: "confirm-1" });
    const binding = confirmed.body.intelligenceRequest;
    await current.repository.bindProcessingJob(USER_ID, binding.requestKey, JOB_ID);
    await current.repository.acceptCurrentResult(USER_ID, {
      prescriptionId: PRESCRIPTION_ID, confirmedRevisionId: REVISION_ID,
      inputFingerprint: binding.inputFingerprint, processingJobId: JOB_ID,
    });
    await assert.rejects(() => current.repository.acceptCurrentResult(USER_ID, {
      prescriptionId: PRESCRIPTION_ID, confirmedRevisionId: REVISION_ID,
      inputFingerprint: "b".repeat(64), processingJobId: JOB_ID,
    }), PrescriptionReviewRepositoryError);
  });
});
