import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import type { UserSupabaseClient } from "../src/config/supabase-user.js";
import { PostgresPrescriptionReviewRepository } from "../src/repositories/postgres-prescription-review.repository.js";
import { PrescriptionReviewRepositoryError } from "../src/repositories/prescription-review.repository.js";
import { validateIntelligenceResponseV1 } from "../src/services/intelligence-contract-v1.validator.js";
import { createInitialReviewFromIntelligence } from "../src/services/prescription-review-initializer.js";

const OWNER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB_ID = "11111111-1111-4111-8111-111111111111";
const PRESCRIPTION_ID = "22222222-2222-4222-8222-222222222222";
const EVIDENCE_ID = "33333333-3333-4333-8333-333333333333";

async function review() {
  const source = JSON.parse(await readFile(join(process.cwd(), "tests", "fixtures", "intelligence", "response-success.json"), "utf8"));
  const result = validateIntelligenceResponseV1(source, { jobId: JOB_ID, prescriptionId: PRESCRIPTION_ID });
  assert.notEqual(result.status, "failed");
  if (result.status === "failed") throw new Error("fixture is not successful");
  return createInitialReviewFromIntelligence({ result, evidenceSetId: EVIDENCE_ID, evidenceSchemaVersion: "ocr-evidence.v1", now: "2026-11-15T10:00:00.000Z" });
}

function client(handler: (name: string, args: Record<string, unknown>) => unknown): UserSupabaseClient {
  return { rpc: async (name: string, args: Record<string, unknown>) => ({ data: handler(name, args), error: null }) } as unknown as UserSupabaseClient;
}

test("PostgreSQL review repository uses owner-derived RPCs and never sends ownerId", async () => {
  const expected = await review();
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const repository = new PostgresPrescriptionReviewRepository(client((name, args) => {
    calls.push({ name, args });
    if (name === "meddecode_has_owned_prescription_review_v1") return true;
    if (name === "meddecode_get_prescription_review_v1") return expected;
    throw new Error(`unexpected RPC ${name}`);
  }));

  assert.equal(await repository.findOwnedPrescription(OWNER_ID, PRESCRIPTION_ID), true);
  assert.deepEqual(await repository.getCurrentRevision(OWNER_ID, PRESCRIPTION_ID), expected);
  assert.deepEqual(calls.map((call) => call.name), [
    "meddecode_has_owned_prescription_review_v1",
    "meddecode_get_prescription_review_v1",
  ]);
  for (const call of calls) {
    assert.deepEqual(Object.keys(call.args), ["p_prescription_id"]);
    assert.equal(JSON.stringify(call.args).includes(OWNER_ID), false);
  }
});

test("PostgreSQL review repository preserves the Supabase RPC receiver", async () => {
  const expected = await review();
  const boundClient = {
    marker: "request-scoped-user-client",
    async rpc(this: { marker: string }, name: string) {
      assert.equal(this.marker, "request-scoped-user-client");
      if (name === "meddecode_has_owned_prescription_review_v1") {
        return { data: true, error: null };
      }
      if (name === "meddecode_get_prescription_review_v1") {
        return { data: expected, error: null };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
  } as unknown as UserSupabaseClient;
  const repository = new PostgresPrescriptionReviewRepository(boundClient);

  assert.equal(await repository.findOwnedPrescription(OWNER_ID, PRESCRIPTION_ID), true);
  assert.equal((await repository.getCurrentRevision(OWNER_ID, PRESCRIPTION_ID))?.medicines.length, expected.medicines.length);
});

test("PostgreSQL review repository sends one atomic draft RPC with CAS metadata", async () => {
  const expected = await review();
  let observed: { name: string; args: Record<string, unknown> } | undefined;
  const repository = new PostgresPrescriptionReviewRepository(client((name, args) => {
    observed = { name, args };
    return expected;
  }));
  await repository.commitRevision({
    ownerId: OWNER_ID,
    prescriptionId: PRESCRIPTION_ID,
    expectedRevisionId: expected.revisionId,
    expectedRevisionNumber: expected.revisionNumber,
    expectedLockVersion: expected.lockVersion,
    revision: expected,
    event: {
      eventId: "44444444-4444-4444-8444-444444444444",
      ownerId: OWNER_ID,
      prescriptionId: PRESCRIPTION_ID,
      revisionId: expected.revisionId,
      type: "draft_saved",
      medicineId: null,
      changedFields: [],
      idempotencyKey: null,
      occurredAt: "2026-11-15T10:01:00.000Z",
    },
  });
  assert.equal(observed?.name, "meddecode_apply_prescription_review_draft_v1");
  assert.equal(observed?.args.p_expected_lock_version, expected.lockVersion);
  assert.equal(observed?.args.p_expected_revision_number, expected.revisionNumber);
  assert.equal("ownerId" in (observed?.args ?? {}), false);
  assert.ok(Array.isArray(observed?.args.p_medicines));
});

test("PostgreSQL review repository maps sanitized provider conflicts and rejects invalid payloads", async () => {
  const conflictClient = {
    rpc: async () => ({ data: null, error: { code: "P0001", message: "review_stale" } }),
  } as unknown as UserSupabaseClient;
  await assert.rejects(
    new PostgresPrescriptionReviewRepository(conflictClient).getCurrentRevision(OWNER_ID, PRESCRIPTION_ID),
    (error: unknown) => error instanceof PrescriptionReviewRepositoryError && error.code === "STALE",
  );
  await assert.rejects(
    new PostgresPrescriptionReviewRepository(client(() => ({ unsafe: true }))).getCurrentRevision(OWNER_ID, PRESCRIPTION_ID),
    (error: unknown) => error instanceof PrescriptionReviewRepositoryError && error.code === "UNAVAILABLE",
  );
});
