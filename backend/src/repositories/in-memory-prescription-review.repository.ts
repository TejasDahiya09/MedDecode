import { validatePrescriptionReviewContractV1, type PrescriptionReviewContractV1 } from "../domain/prescription-review/index.js";
import {
  PrescriptionReviewRepositoryError,
  type PendingReviewIntelligenceRequest,
  type PrescriptionReviewEvent,
  type PrescriptionReviewEvidenceMetadata,
  type PrescriptionReviewRepository,
  type ReviewResultBinding,
  type ReviewRevisionCommit,
} from "./prescription-review.repository.js";

export interface InMemoryPrescriptionReviewSeed {
  readonly ownerId: string;
  readonly prescriptionId: string;
  readonly evidence: PrescriptionReviewEvidenceMetadata;
  readonly revisions: readonly PrescriptionReviewContractV1[];
}

interface StoredPrescriptionReview {
  ownerId: string;
  prescriptionId: string;
  evidence: PrescriptionReviewEvidenceMetadata;
  revisions: PrescriptionReviewContractV1[];
  events: PrescriptionReviewEvent[];
  intelligenceRequests: PendingReviewIntelligenceRequest[];
}

const cloneRevision = (value: PrescriptionReviewContractV1): PrescriptionReviewContractV1 =>
  validatePrescriptionReviewContractV1(structuredClone(value));

export class InMemoryPrescriptionReviewRepository implements PrescriptionReviewRepository {
  private readonly records = new Map<string, StoredPrescriptionReview>();

  constructor(seeds: readonly InMemoryPrescriptionReviewSeed[] = []) {
    for (const seed of seeds) {
      this.records.set(seed.prescriptionId, {
        ownerId: seed.ownerId,
        prescriptionId: seed.prescriptionId,
        evidence: structuredClone(seed.evidence),
        revisions: seed.revisions.map(cloneRevision),
        events: [],
        intelligenceRequests: [],
      });
    }
  }

  private owned(ownerId: string, prescriptionId: string): StoredPrescriptionReview | null {
    const record = this.records.get(prescriptionId);
    return record?.ownerId === ownerId ? record : null;
  }

  async findOwnedPrescription(ownerId: string, prescriptionId: string): Promise<boolean> {
    return this.owned(ownerId, prescriptionId) !== null;
  }

  async getCurrentRevision(ownerId: string, prescriptionId: string): Promise<PrescriptionReviewContractV1 | null> {
    const revisions = this.owned(ownerId, prescriptionId)?.revisions;
    return revisions?.length ? cloneRevision(revisions[revisions.length - 1]!) : null;
  }

  async listRevisions(ownerId: string, prescriptionId: string): Promise<readonly PrescriptionReviewContractV1[]> {
    return (this.owned(ownerId, prescriptionId)?.revisions ?? []).map(cloneRevision).sort((a, b) => b.revisionNumber - a.revisionNumber);
  }

  async getEvidenceMetadata(ownerId: string, prescriptionId: string): Promise<PrescriptionReviewEvidenceMetadata | null> {
    const value = this.owned(ownerId, prescriptionId)?.evidence;
    return value ? structuredClone(value) : null;
  }

  async commitRevision(input: ReviewRevisionCommit): Promise<PrescriptionReviewContractV1> {
    const record = this.owned(input.ownerId, input.prescriptionId);
    if (!record) throw new PrescriptionReviewRepositoryError("NOT_FOUND");
    const current = record.revisions[record.revisions.length - 1];
    if (!current || current.revisionId !== input.expectedRevisionId || current.revisionNumber !== input.expectedRevisionNumber || current.lockVersion !== input.expectedLockVersion) {
      throw new PrescriptionReviewRepositoryError("STALE");
    }
    if (input.revision.revisionId !== current.revisionId || input.revision.revisionNumber !== current.revisionNumber) {
      throw new PrescriptionReviewRepositoryError("CONFLICT");
    }
    const replay = input.event.idempotencyKey === null ? null : record.events.find((event) => event.idempotencyKey === input.event.idempotencyKey);
    if (replay) {
      if (replay.revisionId !== input.event.revisionId || replay.type !== input.event.type) throw new PrescriptionReviewRepositoryError("CONFLICT");
      return cloneRevision(current);
    }
    const committed = cloneRevision(input.revision);
    record.revisions[record.revisions.length - 1] = committed;
    record.events.push(structuredClone(input.event));
    if (input.intelligenceRequest) {
      const existing = record.intelligenceRequests.find((request) => request.requestKey === input.intelligenceRequest!.requestKey);
      if (existing && (existing.confirmedRevisionId !== input.intelligenceRequest.confirmedRevisionId || existing.inputFingerprint !== input.intelligenceRequest.inputFingerprint)) {
        throw new PrescriptionReviewRepositoryError("CONFLICT");
      }
      if (!existing) record.intelligenceRequests.push(structuredClone(input.intelligenceRequest));
      for (const request of record.intelligenceRequests) {
        if (request.requestKey !== input.intelligenceRequest.requestKey && request.state !== "completed") {
          Object.assign(request, { state: "stale" });
        }
      }
    }
    return cloneRevision(committed);
  }

  async appendRevision(input: ReviewRevisionCommit): Promise<PrescriptionReviewContractV1> {
    const record = this.owned(input.ownerId, input.prescriptionId);
    if (!record) throw new PrescriptionReviewRepositoryError("NOT_FOUND");
    const current = record.revisions[record.revisions.length - 1];
    if (!current || current.revisionId !== input.expectedRevisionId || current.revisionNumber !== input.expectedRevisionNumber || current.lockVersion !== input.expectedLockVersion) {
      throw new PrescriptionReviewRepositoryError("STALE");
    }
    if (input.revision.baseRevisionId !== current.revisionId || input.revision.revisionNumber !== current.revisionNumber + 1) {
      throw new PrescriptionReviewRepositoryError("CONFLICT");
    }
    const committed = cloneRevision(input.revision);
    record.revisions.push(committed);
    record.events.push(structuredClone(input.event));
    for (const request of record.intelligenceRequests) if (request.state !== "completed") Object.assign(request, { state: "stale" });
    return cloneRevision(committed);
  }

  async getPendingIntelligenceRequest(ownerId: string, prescriptionId: string): Promise<PendingReviewIntelligenceRequest | null> {
    const requests = this.owned(ownerId, prescriptionId)?.intelligenceRequests ?? [];
    const request = [...requests].reverse().find((item) => item.state === "pending" || item.state === "bound");
    return request ? structuredClone(request) : null;
  }

  async bindProcessingJob(ownerId: string, requestKey: string, processingJobId: string): Promise<PendingReviewIntelligenceRequest> {
    const record = [...this.records.values()].find((item) => item.ownerId === ownerId && item.intelligenceRequests.some((request) => request.requestKey === requestKey));
    const request = record?.intelligenceRequests.find((item) => item.requestKey === requestKey);
    if (!request) throw new PrescriptionReviewRepositoryError("NOT_FOUND");
    if (request.processingJobId !== null && request.processingJobId !== processingJobId) throw new PrescriptionReviewRepositoryError("CONFLICT");
    Object.assign(request, { processingJobId, state: "bound" });
    return structuredClone(request);
  }

  async submitConfirmedIntelligenceJob(ownerId: string, requestKey: string): Promise<PendingReviewIntelligenceRequest> {
    const record = [...this.records.values()].find((item) => item.ownerId === ownerId && item.intelligenceRequests.some((request) => request.requestKey === requestKey));
    const request = record?.intelligenceRequests.find((item) => item.requestKey === requestKey);
    if (!request) throw new PrescriptionReviewRepositoryError("NOT_FOUND");
    if (request.processingJobId === null) {
      const hex = request.inputFingerprint.slice(0, 32).split("");
      hex[12] = "4"; hex[16] = "8";
      const value = hex.join("");
      Object.assign(request, {
        processingJobId: `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`,
        state: "bound",
      });
    }
    return structuredClone(request);
  }

  async acceptCurrentResult(ownerId: string, binding: ReviewResultBinding): Promise<void> {
    const record = this.owned(ownerId, binding.prescriptionId);
    const current = record?.revisions[record.revisions.length - 1];
    const request = record?.intelligenceRequests.find((item) => item.confirmedRevisionId === binding.confirmedRevisionId && item.inputFingerprint === binding.inputFingerprint && item.processingJobId === binding.processingJobId);
    if (!current || current.status !== "confirmed" || current.revisionId !== binding.confirmedRevisionId || current.canonicalInputFingerprint?.value !== binding.inputFingerprint || !request || request.state !== "bound") {
      throw new PrescriptionReviewRepositoryError("STALE");
    }
    Object.assign(request, { state: "completed" });
  }

  eventsFor(ownerId: string, prescriptionId: string): readonly PrescriptionReviewEvent[] {
    return structuredClone(this.owned(ownerId, prescriptionId)?.events ?? []);
  }
}
