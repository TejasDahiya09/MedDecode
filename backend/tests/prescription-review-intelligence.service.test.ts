import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import { createDraftFromConfirmed } from "../src/domain/prescription-review/index.js";
import { InMemoryPrescriptionReviewRepository } from "../src/repositories/in-memory-prescription-review.repository.js";
import { validateIntelligenceResponseV1 } from "../src/services/intelligence-contract-v1.validator.js";
import { createInitialReviewFromIntelligence } from "../src/services/prescription-review-initializer.js";
import { PrescriptionReviewService } from "../src/services/prescription-review.service.js";
import { PrescriptionReviewIntelligenceService } from "../src/services/prescription-review-intelligence.service.js";

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB = "11111111-1111-4111-8111-111111111111";
const PRESCRIPTION = "22222222-2222-4222-8222-222222222222";

async function harness() {
  const raw = JSON.parse(await readFile(join(process.cwd(), "tests", "fixtures", "intelligence", "response-completed-with-warnings.json"), "utf8"));
  const source = validateIntelligenceResponseV1(raw, { jobId: JOB, prescriptionId: PRESCRIPTION });
  assert.notEqual(source.status, "failed");
  if (source.status === "failed") throw new Error("invalid fixture");
  const draft = createInitialReviewFromIntelligence({ result: source, evidenceSetId: "33333333-3333-4333-8333-333333333333", evidenceSchemaVersion: "ocr-evidence.v1", now: "2026-11-15T10:00:00Z" });
  const repository = new InMemoryPrescriptionReviewRepository([{ ownerId: OWNER, prescriptionId: PRESCRIPTION,
    evidence: { evidenceSetId: draft.evidence.evidenceSetId, prescriptionId: PRESCRIPTION, schemaVersion: draft.evidence.schemaVersion, documentSha256: null, pageCount: 1, providerCount: 1, createdAt: draft.createdAt }, revisions: [draft] }]);
  const reviewService = new PrescriptionReviewService(repository);
  await reviewService.confirm(OWNER, PRESCRIPTION, { expectedRevisionNumber: 1, expectedLockVersion: 0, idempotencyKey: "confirm-1", now: "2026-11-15T10:01:00Z" });
  return { repository, source };
}

test("confirmed review is bound once and committed with its immutable revision fingerprint", async () => {
  const { repository, source } = await harness();
  const commits: unknown[] = [];
  const service = new PrescriptionReviewIntelligenceService(repository, { async analyzeConfirmed() { return source; } }, {
    async commit(input) { await repository.acceptCurrentResult(OWNER, input.binding); commits.push(input); },
  });
  const output = await service.execute(OWNER, PRESCRIPTION, JOB);
  assert.equal(output.binding.processingJobId, JOB);
  assert.equal(commits.length, 1);
  assert.equal((await repository.getPendingIntelligenceRequest(OWNER, PRESCRIPTION)), null);
});

test("reopen during processing rejects the old result at the atomic commit boundary", async () => {
  const { repository, source } = await harness();
  const service = new PrescriptionReviewIntelligenceService(repository, { async analyzeConfirmed() {
    const current = await repository.getCurrentRevision(OWNER, PRESCRIPTION);
    assert.ok(current);
    await repository.appendRevision({ ownerId: OWNER, prescriptionId: PRESCRIPTION, expectedRevisionId: current.revisionId,
      expectedRevisionNumber: current.revisionNumber, expectedLockVersion: current.lockVersion,
      revision: createDraftFromConfirmed(current, { revisionId: "44444444-4444-4444-8444-444444444444", now: "2026-11-15T10:02:00Z" }),
      event: { eventId: "55555555-5555-4555-8555-555555555555", ownerId: OWNER, prescriptionId: PRESCRIPTION,
        revisionId: "44444444-4444-4444-8444-444444444444", type: "revision_reopened", medicineId: null,
        changedFields: [], idempotencyKey: null, occurredAt: "2026-11-15T10:02:00Z" } });
    return source;
  } }, { async commit(input) { await repository.acceptCurrentResult(OWNER, input.binding); } });
  await assert.rejects(service.execute(OWNER, PRESCRIPTION, JOB), /Prescription review persistence operation failed/);
});
