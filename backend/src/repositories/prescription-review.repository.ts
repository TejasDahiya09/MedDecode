import type { PrescriptionReviewContractV1 } from "../domain/prescription-review/index.js";
import type { UserSupabaseClient } from "../config/supabase-user.js";

export interface PrescriptionReviewEvidenceMetadata {
  readonly evidenceSetId: string;
  readonly prescriptionId: string;
  readonly schemaVersion: string;
  readonly documentSha256: string | null;
  readonly pageCount: number | null;
  readonly providerCount: number;
  readonly createdAt: string;
}

export type PrescriptionReviewEventType =
  | "draft_created"
  | "medicine_edited"
  | "medicine_added"
  | "medicine_removed"
  | "medicine_restored"
  | "original_restored"
  | "medicines_reordered"
  | "draft_saved"
  | "revision_confirmed"
  | "revision_reopened";

export interface PrescriptionReviewEvent {
  readonly eventId: string;
  readonly prescriptionId: string;
  readonly revisionId: string;
  readonly ownerId: string;
  readonly type: PrescriptionReviewEventType;
  readonly medicineId: string | null;
  readonly changedFields: readonly string[];
  readonly idempotencyKey: string | null;
  readonly occurredAt: string;
}

export interface PendingReviewIntelligenceRequest {
  readonly requestKey: string;
  readonly ownerId: string;
  readonly prescriptionId: string;
  readonly confirmedRevisionId: string;
  readonly inputFingerprint: string;
  readonly processingJobId: string | null;
  readonly state: "pending" | "bound" | "completed" | "stale";
  readonly createdAt: string;
}

export interface ReviewResultBinding {
  readonly prescriptionId: string;
  readonly confirmedRevisionId: string;
  readonly inputFingerprint: string;
  readonly processingJobId: string;
}

export interface ReviewRevisionCommit {
  readonly ownerId: string;
  readonly prescriptionId: string;
  readonly expectedRevisionId: string;
  readonly expectedRevisionNumber: number;
  readonly expectedLockVersion: number;
  readonly revision: PrescriptionReviewContractV1;
  readonly event: PrescriptionReviewEvent;
  readonly intelligenceRequest?: PendingReviewIntelligenceRequest;
}

export interface PrescriptionReviewRepository {
  findOwnedPrescription(ownerId: string, prescriptionId: string): Promise<boolean>;
  getCurrentRevision(ownerId: string, prescriptionId: string): Promise<PrescriptionReviewContractV1 | null>;
  listRevisions(ownerId: string, prescriptionId: string): Promise<readonly PrescriptionReviewContractV1[]>;
  getEvidenceMetadata(ownerId: string, prescriptionId: string): Promise<PrescriptionReviewEvidenceMetadata | null>;
  commitRevision(input: ReviewRevisionCommit): Promise<PrescriptionReviewContractV1>;
  appendRevision(input: ReviewRevisionCommit): Promise<PrescriptionReviewContractV1>;
  getPendingIntelligenceRequest(ownerId: string, prescriptionId: string): Promise<PendingReviewIntelligenceRequest | null>;
  bindProcessingJob(ownerId: string, requestKey: string, processingJobId: string): Promise<PendingReviewIntelligenceRequest>;
  submitConfirmedIntelligenceJob(ownerId: string, requestKey: string): Promise<PendingReviewIntelligenceRequest>;
  acceptCurrentResult(ownerId: string, binding: ReviewResultBinding): Promise<void>;
}

export type PrescriptionReviewRepositoryFactory = (client: UserSupabaseClient) => PrescriptionReviewRepository;

export class PrescriptionReviewRepositoryError extends Error {
  constructor(readonly code: "UNAVAILABLE" | "NOT_FOUND" | "STALE" | "CONFLICT") {
    super("Prescription review persistence operation failed.");
    this.name = "PrescriptionReviewRepositoryError";
  }
}

export const unavailablePrescriptionReviewRepository: PrescriptionReviewRepository = {
  async findOwnedPrescription() { throw new PrescriptionReviewRepositoryError("UNAVAILABLE"); },
  async getCurrentRevision() { throw new PrescriptionReviewRepositoryError("UNAVAILABLE"); },
  async listRevisions() { throw new PrescriptionReviewRepositoryError("UNAVAILABLE"); },
  async getEvidenceMetadata() { throw new PrescriptionReviewRepositoryError("UNAVAILABLE"); },
  async commitRevision() { throw new PrescriptionReviewRepositoryError("UNAVAILABLE"); },
  async appendRevision() { throw new PrescriptionReviewRepositoryError("UNAVAILABLE"); },
  async getPendingIntelligenceRequest() { throw new PrescriptionReviewRepositoryError("UNAVAILABLE"); },
  async bindProcessingJob() { throw new PrescriptionReviewRepositoryError("UNAVAILABLE"); },
  async submitConfirmedIntelligenceJob() { throw new PrescriptionReviewRepositoryError("UNAVAILABLE"); },
  async acceptCurrentResult() { throw new PrescriptionReviewRepositoryError("UNAVAILABLE"); },
};
