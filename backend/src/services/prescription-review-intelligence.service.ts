import type { IntelligenceSuccessV1 } from "../types/intelligence-contract-v1.js";
import {
  PrescriptionReviewRepositoryError,
  type PrescriptionReviewRepository,
  type ReviewResultBinding,
} from "../repositories/prescription-review.repository.js";
import type { ConfirmedReviewIntelligenceClient } from "./confirmed-review-intelligence.client.js";

export interface ReviewBoundResultCommitter {
  /** Must persist the result and validate the binding in one transaction. */
  commit(input: { binding: ReviewResultBinding; result: IntelligenceSuccessV1 }): Promise<void>;
}

export class PrescriptionReviewIntelligenceService {
  constructor(
    private readonly repository: PrescriptionReviewRepository,
    private readonly intelligence: ConfirmedReviewIntelligenceClient,
    private readonly committer: ReviewBoundResultCommitter,
  ) {}

  async execute(ownerId: string, prescriptionId: string, processingJobId: string, signal?: AbortSignal) {
    const review = await this.repository.getCurrentRevision(ownerId, prescriptionId);
    if (!review || review.status !== "confirmed" || review.canonicalInputFingerprint === null) {
      throw new PrescriptionReviewRepositoryError("STALE");
    }
    const pending = await this.repository.getPendingIntelligenceRequest(ownerId, prescriptionId);
    if (!pending || pending.confirmedRevisionId !== review.revisionId ||
        pending.inputFingerprint !== review.canonicalInputFingerprint.value) {
      throw new PrescriptionReviewRepositoryError("STALE");
    }
    const bound = pending.processingJobId === null
      ? await this.repository.bindProcessingJob(ownerId, pending.requestKey, processingJobId)
      : pending;
    if (bound.processingJobId !== processingJobId || bound.state !== "bound") {
      throw new PrescriptionReviewRepositoryError("CONFLICT");
    }
    const binding: ReviewResultBinding = {
      prescriptionId,
      confirmedRevisionId: review.revisionId,
      inputFingerprint: review.canonicalInputFingerprint.value,
      processingJobId,
    };
    const result = await this.intelligence.analyzeConfirmed({ jobId: processingJobId, prescriptionId, review }, signal);
    // The committer owns the atomic database transaction. It must reject a
    // reopen/correction that occurred while Python was running.
    await this.committer.commit({ binding, result });
    return { binding, result };
  }
}
