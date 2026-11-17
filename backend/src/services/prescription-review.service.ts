import { randomUUID } from "node:crypto";

import {
  PrescriptionReviewError,
  addMedicine,
  confirmReview,
  createDraftFromConfirmed,
  editMedicineFields,
  removeMedicine,
  reorderMedicines,
  restoreMedicine,
  restoreOriginalMedicineValues,
  saveReviewDraft,
  type PrescriptionReviewContractV1,
  type ReviewEditableField,
  type ReviewMedicineFieldsV1,
} from "../domain/prescription-review/index.js";
import { AppError } from "../middleware/error.middleware.js";
import {
  PrescriptionReviewRepositoryError,
  type PendingReviewIntelligenceRequest,
  type PrescriptionReviewEvent,
  type PrescriptionReviewEventType,
  type PrescriptionReviewRepository,
} from "../repositories/prescription-review.repository.js";

export type ReviewDraftOperation =
  | { readonly type: "edit_fields"; readonly medicineId: string; readonly updates: Partial<Record<ReviewEditableField, string | null>> }
  | { readonly type: "add_medicine"; readonly commandId: string; readonly medicineId: string; readonly fields: ReviewMedicineFieldsV1; readonly position?: number }
  | { readonly type: "remove_medicine"; readonly medicineId: string }
  | { readonly type: "restore_medicine"; readonly medicineId: string }
  | { readonly type: "restore_original"; readonly medicineId: string }
  | { readonly type: "reorder_medicines"; readonly orderedMedicineIds: readonly string[] }
  | { readonly type: "save_draft" };

function notFound(): AppError {
  return new AppError(404, "PRESCRIPTION_NOT_FOUND", "Prescription not found.");
}

function mapError(error: unknown): never {
  if (error instanceof AppError) throw error;
  if (error instanceof PrescriptionReviewError) {
    if (error.code === "REVIEW_STALE") throw new AppError(409, error.code, "The review has changed. Refresh and retry.");
    if (error.code === "REVIEW_IMMUTABLE" || error.code === "REVIEW_INVALID_TRANSITION" || error.code === "REVIEW_COMMAND_CONFLICT") {
      throw new AppError(409, error.code, error.message);
    }
    if (error.code === "REVIEW_MEDICINE_NOT_FOUND") throw new AppError(404, error.code, "Medicine review entry not found.");
    throw new AppError(400, error.code, error.message);
  }
  if (error instanceof PrescriptionReviewRepositoryError) {
    if (error.code === "NOT_FOUND") throw notFound();
    if (error.code === "STALE" || error.code === "CONFLICT") throw new AppError(409, `REVIEW_${error.code}`, "The review could not be updated because its state changed.");
    throw new AppError(503, "REVIEW_PERSISTENCE_UNAVAILABLE", "Prescription review is temporarily unavailable.");
  }
  throw error;
}

function event(input: {
  ownerId: string;
  prescriptionId: string;
  revisionId: string;
  type: PrescriptionReviewEventType;
  medicineId?: string;
  changedFields?: readonly string[];
  idempotencyKey?: string;
  now: string;
}): PrescriptionReviewEvent {
  return {
    eventId: randomUUID(), ownerId: input.ownerId, prescriptionId: input.prescriptionId,
    revisionId: input.revisionId, type: input.type, medicineId: input.medicineId ?? null,
    changedFields: input.changedFields ?? [], idempotencyKey: input.idempotencyKey ?? null,
    occurredAt: input.now,
  };
}

function eventType(operation: ReviewDraftOperation): PrescriptionReviewEventType {
  switch (operation.type) {
    case "edit_fields": return "medicine_edited";
    case "add_medicine": return "medicine_added";
    case "remove_medicine": return "medicine_removed";
    case "restore_medicine": return "medicine_restored";
    case "restore_original": return "original_restored";
    case "reorder_medicines": return "medicines_reordered";
    case "save_draft": return "draft_saved";
  }
}

export class PrescriptionReviewService {
  constructor(
    private readonly repository: PrescriptionReviewRepository,
    private readonly autoDispatchConfirmed = false,
  ) {}

  private async current(ownerId: string, prescriptionId: string): Promise<PrescriptionReviewContractV1> {
    if (!await this.repository.findOwnedPrescription(ownerId, prescriptionId)) throw notFound();
    const revision = await this.repository.getCurrentRevision(ownerId, prescriptionId);
    if (!revision) throw new AppError(404, "REVIEW_NOT_FOUND", "Prescription review is not available.");
    return revision;
  }

  async getReview(ownerId: string, prescriptionId: string) {
    try { return await this.current(ownerId, prescriptionId); } catch (error) { mapError(error); }
  }

  async listRevisions(ownerId: string, prescriptionId: string) {
    try {
      if (!await this.repository.findOwnedPrescription(ownerId, prescriptionId)) throw notFound();
      return { revisions: await this.repository.listRevisions(ownerId, prescriptionId) };
    } catch (error) { mapError(error); }
  }

  async getEvidence(ownerId: string, prescriptionId: string) {
    try {
      if (!await this.repository.findOwnedPrescription(ownerId, prescriptionId)) throw notFound();
      const evidence = await this.repository.getEvidenceMetadata(ownerId, prescriptionId);
      if (!evidence) throw new AppError(404, "EVIDENCE_NOT_FOUND", "Prescription evidence is not available.");
      return evidence;
    } catch (error) { mapError(error); }
  }

  async applyDraft(ownerId: string, prescriptionId: string, input: {
    expectedRevisionNumber: number;
    expectedLockVersion: number;
    operation: ReviewDraftOperation;
    now: string;
  }) {
    try {
      const current = await this.current(ownerId, prescriptionId);
      if (current.revisionNumber !== input.expectedRevisionNumber) throw new PrescriptionReviewError("REVIEW_STALE", "Revision number is stale.");
      const common = { expectedLockVersion: input.expectedLockVersion, now: input.now };
      let next: PrescriptionReviewContractV1;
      switch (input.operation.type) {
        case "edit_fields": next = editMedicineFields(current, { ...common, medicineId: input.operation.medicineId, updates: input.operation.updates }); break;
        case "add_medicine": next = addMedicine(current, { ...common, ...input.operation }); break;
        case "remove_medicine": next = removeMedicine(current, { ...common, medicineId: input.operation.medicineId }); break;
        case "restore_medicine": next = restoreMedicine(current, { ...common, medicineId: input.operation.medicineId }); break;
        case "restore_original": next = restoreOriginalMedicineValues(current, { ...common, medicineId: input.operation.medicineId }); break;
        case "reorder_medicines": next = reorderMedicines(current, { ...common, orderedMedicineIds: input.operation.orderedMedicineIds }); break;
        case "save_draft": next = saveReviewDraft(current, common); break;
      }
      if (next === current) return current;
      return await this.repository.commitRevision({
        ownerId, prescriptionId, expectedRevisionId: current.revisionId,
        expectedRevisionNumber: input.expectedRevisionNumber, expectedLockVersion: input.expectedLockVersion,
        revision: next,
        event: event({ ownerId, prescriptionId, revisionId: current.revisionId, type: eventType(input.operation),
          ...(input.operation.type === "reorder_medicines" || input.operation.type === "save_draft" ? {} : { medicineId: input.operation.medicineId }),
          ...(input.operation.type === "edit_fields" ? { changedFields: Object.keys(input.operation.updates) } : {}),
          ...(input.operation.type === "add_medicine" ? { idempotencyKey: input.operation.commandId } : {}), now: input.now }),
      });
    } catch (error) { mapError(error); }
  }

  async confirm(ownerId: string, prescriptionId: string, input: { expectedRevisionNumber: number; expectedLockVersion: number; idempotencyKey: string; now: string }) {
    try {
      const current = await this.current(ownerId, prescriptionId);
      if (current.revisionNumber !== input.expectedRevisionNumber) throw new PrescriptionReviewError("REVIEW_STALE", "Revision number is stale.");
      const next = confirmReview(current, input);
      if (next === current) {
        const existing = await this.repository.getPendingIntelligenceRequest(ownerId, prescriptionId);
        if (!existing) return { review: current, intelligenceRequest: null };
        const intelligenceRequest = this.autoDispatchConfirmed && existing.processingJobId === null
          ? await this.repository.submitConfirmedIntelligenceJob(ownerId, existing.requestKey)
          : existing;
        return { review: current, intelligenceRequest };
      }
      const fingerprint = next.canonicalInputFingerprint!.value;
      const intelligenceRequest: PendingReviewIntelligenceRequest = {
        requestKey: `review:${next.revisionId}:${fingerprint}`,
        ownerId, prescriptionId, confirmedRevisionId: next.revisionId, inputFingerprint: fingerprint,
        processingJobId: null, state: "pending", createdAt: input.now,
      };
      const review = await this.repository.commitRevision({
        ownerId, prescriptionId, expectedRevisionId: current.revisionId,
        expectedRevisionNumber: current.revisionNumber, expectedLockVersion: input.expectedLockVersion,
        revision: next, intelligenceRequest,
        event: event({ ownerId, prescriptionId, revisionId: current.revisionId, type: "revision_confirmed", idempotencyKey: input.idempotencyKey, now: input.now }),
      });
      return { review, intelligenceRequest: this.autoDispatchConfirmed
        ? await this.repository.submitConfirmedIntelligenceJob(ownerId, intelligenceRequest.requestKey)
        : intelligenceRequest };
    } catch (error) { mapError(error); }
  }

  async reopen(ownerId: string, prescriptionId: string, input: { expectedRevisionNumber: number; expectedLockVersion: number; now: string }) {
    try {
      const current = await this.current(ownerId, prescriptionId);
      if (current.revisionNumber !== input.expectedRevisionNumber || current.lockVersion !== input.expectedLockVersion) throw new PrescriptionReviewError("REVIEW_STALE", "Revision is stale.");
      const next = createDraftFromConfirmed(current, { revisionId: randomUUID(), now: input.now });
      return await this.repository.appendRevision({
        ownerId, prescriptionId, expectedRevisionId: current.revisionId,
        expectedRevisionNumber: current.revisionNumber, expectedLockVersion: current.lockVersion,
        revision: next,
        event: event({ ownerId, prescriptionId, revisionId: next.revisionId, type: "revision_reopened", now: input.now }),
      });
    } catch (error) { mapError(error); }
  }
}
