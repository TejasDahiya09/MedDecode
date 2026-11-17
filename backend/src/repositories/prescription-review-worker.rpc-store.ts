import { createInitialReviewFromIntelligence } from "../services/prescription-review-initializer.js";
import { validatePrescriptionReviewContractV1 } from "../domain/prescription-review/index.js";
import type { PrescriptionReviewWorkerStore } from "./prescription-review-worker.store.js";

export const REVIEW_INITIALIZE_RPC = "meddecode_initialize_prescription_review_v1";
export const REVIEW_COMPLETE_INITIAL_RPC = "meddecode_complete_initial_review_job_v1";
export const REVIEW_LOAD_CONFIRMED_RPC = "meddecode_load_confirmed_review_job_v1";
export const REVIEW_FINALIZE_RPC = "meddecode_finalize_review_result_v1";
export const REVIEW_FAIL_RPC = "meddecode_fail_review_job_v1";

export interface ReviewWorkerRpcCaller {
  rpc(name: string, parameters: Readonly<Record<string, unknown>>): PromiseLike<{ data: unknown; error: unknown }>;
}

export class PrescriptionReviewWorkerRpcError extends Error {
  constructor(readonly category: "INVALID" | "STALE" | "UNAUTHORIZED" | "UNAVAILABLE", readonly rpcName?: string, readonly sqlstate?: string) {
    super("Prescription review worker operation failed safely.");
  }
}

function providerError(error: unknown, rpcName: string): never {
  const item = typeof error === "object" && error !== null ? error as Record<string, unknown> : {};
  const message = typeof item.message === "string" ? item.message : "";
  const code = typeof item.code === "string" ? item.code : "";
  const sqlstate = /^[0-9A-Z]{5}$/.test(code) ? code : undefined;
  if (code === "42501" || /review_forbidden/.test(message)) throw new PrescriptionReviewWorkerRpcError("UNAUTHORIZED", rpcName, sqlstate);
  if (/review_stale/.test(message)) throw new PrescriptionReviewWorkerRpcError("STALE", rpcName, sqlstate);
  if (code === "22023" || /review_conflict/.test(message)) throw new PrescriptionReviewWorkerRpcError("INVALID", rpcName, sqlstate);
  throw new PrescriptionReviewWorkerRpcError("UNAVAILABLE", rpcName, sqlstate);
}

async function call(caller: ReviewWorkerRpcCaller, name: string, parameters: Record<string, unknown>): Promise<unknown> {
  const result = await caller.rpc(name, parameters);
  if (result.error !== null && result.error !== undefined) providerError(result.error, name);
  return result.data;
}

export class RpcPrescriptionReviewWorkerStore implements PrescriptionReviewWorkerStore {
  constructor(private readonly caller: ReviewWorkerRpcCaller) {}

  async initializeFromOcr(input: Parameters<PrescriptionReviewWorkerStore["initializeFromOcr"]>[0]) {
    const review = createInitialReviewFromIntelligence({
      result: input.result, evidenceSetId: input.evidence.evidenceSetId,
      evidenceSchemaVersion: input.evidence.schemaVersion,
      ...(input.evidence.documentSha256 === null ? {} : { documentSha256: input.evidence.documentSha256 }),
      now: input.now,
    });
    const data = await call(this.caller, REVIEW_INITIALIZE_RPC, {
      p_job_id: input.claim.jobId, p_prescription_id: input.claim.prescriptionId,
      p_evidence: {
        evidenceSetId: input.evidence.evidenceSetId, schemaVersion: input.evidence.schemaVersion,
        documentSha256: input.evidence.documentSha256, pageCount: input.evidence.pageCount,
        providerCount: input.evidence.providerCount, payload: input.evidence.payload,
      },
      p_review: review,
      p_medicines: review.medicines.map((medicine) => ({
        medicineId: medicine.medicineId, origin: medicine.origin, status: medicine.status,
        position: medicine.position, original: medicine.original, current: medicine.current,
        provenance: medicine.provenance, addedByCommandId: medicine.addedByCommandId, removedAt: medicine.removedAt,
      })),
      p_event: {
        eventId: input.evidence.evidenceSetId, type: "draft_created", medicineId: null,
        changedFields: [], idempotencyKey: `initialize:${input.claim.jobId}`, occurredAt: input.now,
      },
    });
    try {
      const initialized = validatePrescriptionReviewContractV1(data);
      if (initialized.prescriptionId !== input.claim.prescriptionId) throw new Error('Mismatched review');
      return initialized;
    } catch { throw new PrescriptionReviewWorkerRpcError('INVALID', REVIEW_INITIALIZE_RPC); }
  }

  async completeInitialReview(input: Parameters<PrescriptionReviewWorkerStore["completeInitialReview"]>[0]): Promise<void> {
    const data = await call(this.caller, REVIEW_COMPLETE_INITIAL_RPC, {
      p_job_id: input.claim.jobId,
      p_prescription_id: input.claim.prescriptionId,
      p_worker_instance_id: input.workerInstanceId,
      p_attempt_count: input.claim.attemptCount,
      p_claim_generation: input.claim.claimGeneration,
    });
    const row = Array.isArray(data) && data.length === 1 ? data[0] : null;
    if (row === null || typeof row !== 'object' || row.job_id !== input.claim.jobId ||
        row.prescription_id !== input.claim.prescriptionId || row.job_status !== 'completed' || row.review_state !== 'draft') {
      throw new PrescriptionReviewWorkerRpcError('INVALID', REVIEW_COMPLETE_INITIAL_RPC);
    }
  }

  async loadConfirmed(input: Parameters<PrescriptionReviewWorkerStore["loadConfirmed"]>[0]) {
    const data = await call(this.caller, REVIEW_LOAD_CONFIRMED_RPC, {
      p_job_id: input.claim.jobId, p_prescription_id: input.claim.prescriptionId,
      p_review_revision_id: input.binding.revisionId, p_input_fingerprint: input.binding.inputFingerprint,
      p_worker_instance_id: input.workerInstanceId,
      p_claim_generation: input.claim.claimGeneration,
    });
    const row = Array.isArray(data) ? data[0] : data;
    if (typeof row !== "object" || row === null || !("review" in row)) throw new PrescriptionReviewWorkerRpcError("UNAVAILABLE");
    return validatePrescriptionReviewContractV1((row as { review: unknown }).review);
  }

  async finalizeConfirmed(input: Parameters<PrescriptionReviewWorkerStore["finalizeConfirmed"]>[0]): Promise<void> {
    await call(this.caller, REVIEW_FINALIZE_RPC, {
      p_job_id: input.claim.jobId, p_prescription_id: input.claim.prescriptionId,
      p_review_revision_id: input.binding.revisionId, p_input_fingerprint: input.binding.inputFingerprint,
      p_worker_instance_id: input.workerInstanceId, p_claim_generation: input.claim.claimGeneration,
      p_result_json: input.result,
    });
  }

  async failConfirmed(input: Parameters<PrescriptionReviewWorkerStore["failConfirmed"]>[0]): Promise<void> {
    await call(this.caller, REVIEW_FAIL_RPC, {
      p_job_id: input.claim.jobId, p_prescription_id: input.claim.prescriptionId,
      p_review_revision_id: input.binding.revisionId, p_input_fingerprint: input.binding.inputFingerprint,
      p_worker_instance_id: input.workerInstanceId, p_claim_generation: input.claim.claimGeneration,
      p_failure_code: input.failureCode,
    });
  }
}
