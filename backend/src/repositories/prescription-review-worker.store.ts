import type { PrescriptionReviewContractV1 } from "../domain/prescription-review/index.js";
import type { IntelligenceSuccessV1 } from "../types/intelligence-contract-v1.js";
import type { ConfirmedReviewJobBinding, WorkerJobClaim } from "../types/worker-jobs.js";

export interface InitialReviewEvidence {
  readonly evidenceSetId: string;
  readonly schemaVersion: string;
  readonly documentSha256: string | null;
  readonly pageCount: number | null;
  readonly providerCount: number;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface PrescriptionReviewWorkerStore {
  initializeFromOcr(input: {
    claim: WorkerJobClaim;
    result: IntelligenceSuccessV1;
    evidence: InitialReviewEvidence;
    now: string;
  }): Promise<PrescriptionReviewContractV1>;
  /** Completes a claimed initial OCR job after its draft review is durable. */
  completeInitialReview(input: {
    claim: WorkerJobClaim;
    workerInstanceId: string;
  }): Promise<void>;
  loadConfirmed(input: {
    claim: WorkerJobClaim;
    binding: ConfirmedReviewJobBinding;
    workerInstanceId: string;
  }): Promise<PrescriptionReviewContractV1>;
  finalizeConfirmed(input: {
    claim: WorkerJobClaim;
    binding: ConfirmedReviewJobBinding;
    workerInstanceId: string;
    result: IntelligenceSuccessV1;
  }): Promise<void>;
  /** Terminal V3 failure preserves the prior current result and never retries. */
  failConfirmed(input: {
    claim: WorkerJobClaim;
    binding: ConfirmedReviewJobBinding;
    workerInstanceId: string;
    failureCode: string;
  }): Promise<void>;
}
