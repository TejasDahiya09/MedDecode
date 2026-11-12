import type {
  IntelligenceJobFailure,
  IntelligenceJobRecord,
  RequestedAnalysis,
} from "../types/intelligence-jobs.js";

export interface PrescriptionOwnershipRepository {
  findOwnedProcessable(
    userId: string,
    prescriptionId: string,
  ): Promise<import("../types/intelligence-jobs.js").OwnedProcessablePrescription | null>;
}

export interface CreateIntelligenceJobInput {
  readonly userId: string;
  readonly prescriptionId: string;
  readonly requestedAnalysis: RequestedAnalysis;
}

export interface IntelligenceJobRepository {
  createOrGetActive(input: CreateIntelligenceJobInput): Promise<IntelligenceJobRecord>;
  findById(jobId: string): Promise<IntelligenceJobRecord | null>;
  findOwned(jobId: string, userId: string): Promise<IntelligenceJobRecord | null>;
  claim(jobId: string): Promise<IntelligenceJobRecord>;
  complete(jobId: string): Promise<IntelligenceJobRecord>;
  fail(jobId: string, failure: IntelligenceJobFailure): Promise<IntelligenceJobRecord>;
}
