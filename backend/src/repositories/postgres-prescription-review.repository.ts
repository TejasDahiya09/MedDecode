import type { UserSupabaseClient } from "../config/supabase-user.js";
import { validatePrescriptionReviewContractV1, validateUuid } from "../domain/prescription-review/index.js";
import {
  PrescriptionReviewRepositoryError,
  type PendingReviewIntelligenceRequest,
  type PrescriptionReviewEvidenceMetadata,
  type PrescriptionReviewRepository,
  type ReviewResultBinding,
  type ReviewRevisionCommit,
} from "./prescription-review.repository.js";

function mapProviderError(error: { code?: string; message?: string } | null): never {
  const message = error?.message ?? "";
  if (error?.code === "PGRST116" || /review_not_found|prescription_not_found/.test(message)) throw new PrescriptionReviewRepositoryError("NOT_FOUND");
  if (/review_stale/.test(message)) throw new PrescriptionReviewRepositoryError("STALE");
  if (/review_conflict|review_immutable|review_invalid_transition/.test(message)) throw new PrescriptionReviewRepositoryError("CONFLICT");
  throw new PrescriptionReviewRepositoryError("UNAVAILABLE");
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new PrescriptionReviewRepositoryError("UNAVAILABLE");
  return value as Record<string, unknown>;
}

function parseEvidence(value: unknown): PrescriptionReviewEvidenceMetadata {
  const item = record(value);
  const evidenceSetId = validateUuid(item.evidenceSetId, "evidenceSetId");
  const prescriptionId = validateUuid(item.prescriptionId, "prescriptionId");
  if (typeof item.schemaVersion !== "string" || typeof item.createdAt !== "string" ||
      (item.documentSha256 !== null && (typeof item.documentSha256 !== "string" || !/^[0-9a-f]{64}$/.test(item.documentSha256))) ||
      (item.pageCount !== null && (!Number.isInteger(item.pageCount) || (item.pageCount as number) < 1)) ||
      !Number.isInteger(item.providerCount) || (item.providerCount as number) < 0) {
    throw new PrescriptionReviewRepositoryError("UNAVAILABLE");
  }
  return {
    evidenceSetId, prescriptionId, schemaVersion: item.schemaVersion,
    documentSha256: item.documentSha256 as string | null,
    pageCount: item.pageCount as number | null,
    providerCount: item.providerCount as number,
    createdAt: item.createdAt,
  };
}

function parseRequest(value: unknown): PendingReviewIntelligenceRequest {
  const item = record(value);
  if (typeof item.requestKey !== "string" || typeof item.inputFingerprint !== "string" || !/^[0-9a-f]{64}$/.test(item.inputFingerprint) ||
      typeof item.createdAt !== "string" || !["pending", "bound", "completed", "stale"].includes(item.state as string)) {
    throw new PrescriptionReviewRepositoryError("UNAVAILABLE");
  }
  return {
    requestKey: item.requestKey,
    ownerId: validateUuid(item.ownerId, "ownerId"),
    prescriptionId: validateUuid(item.prescriptionId, "prescriptionId"),
    confirmedRevisionId: validateUuid(item.confirmedRevisionId, "confirmedRevisionId"),
    inputFingerprint: item.inputFingerprint,
    processingJobId: item.processingJobId === null ? null : validateUuid(item.processingJobId, "processingJobId"),
    state: item.state as PendingReviewIntelligenceRequest["state"],
    createdAt: item.createdAt,
  };
}

function parseReview(value: unknown) {
  try {
    return validatePrescriptionReviewContractV1(value);
  } catch {
    throw new PrescriptionReviewRepositoryError("UNAVAILABLE");
  }
}

function medicines(revision: ReviewRevisionCommit["revision"]): unknown[] {
  return revision.medicines.map((item) => ({
    medicineId: item.medicineId, origin: item.origin, status: item.status, position: item.position,
    original: item.original, current: item.current, provenance: item.provenance,
    addedByCommandId: item.addedByCommandId, removedAt: item.removedAt,
  }));
}

function event(input: ReviewRevisionCommit): Record<string, unknown> {
  return {
    eventId: input.event.eventId, type: input.event.type, medicineId: input.event.medicineId,
    changedFields: input.event.changedFields, idempotencyKey: input.event.idempotencyKey,
    occurredAt: input.event.occurredAt,
  };
}

export class PostgresPrescriptionReviewRepository implements PrescriptionReviewRepository {
  constructor(private readonly client: UserSupabaseClient) {}

  private async rpc(name: string, parameters: Record<string, unknown>): Promise<unknown> {
    try {
      // SupabaseClient.rpc reads the client's PostgREST transport through its
      // receiver. Keep that receiver when narrowing the generated SDK type;
      // calling an extracted method makes the real SDK throw before a request
      // is sent even though simple arrow-function test doubles still work.
      const rpc = this.client.rpc.bind(this.client) as unknown as (
        functionName: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: unknown; status?: number; error: { code?: string; message?: string } | null }>;
      const { data, error, status } = await rpc(name, parameters);
      if (error) {
        console.warn(JSON.stringify({ event: 'review_rpc_failed', rpcName: name,
          stage: 'owner_scoped_review_rpc', category: 'PERSISTENCE',
          httpStatus: Number.isInteger(status) && status! >= 100 && status! <= 599 ? status : null,
          code: typeof error.code === 'string' && /^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(error.code) ? error.code : null }));
        mapProviderError(error);
      }
      return data;
    } catch (error) {
      if (error instanceof PrescriptionReviewRepositoryError) throw error;
      throw new PrescriptionReviewRepositoryError("UNAVAILABLE");
    }
  }

  async findOwnedPrescription(_ownerId: string, prescriptionId: string): Promise<boolean> {
    return await this.rpc("meddecode_has_owned_prescription_review_v1", { p_prescription_id: prescriptionId }) === true;
  }

  async getCurrentRevision(_ownerId: string, prescriptionId: string) {
    const data = await this.rpc("meddecode_get_prescription_review_v1", { p_prescription_id: prescriptionId });
    return data === null ? null : parseReview(data);
  }

  async listRevisions(_ownerId: string, prescriptionId: string) {
    const data = await this.rpc("meddecode_list_prescription_review_revisions_v1", { p_prescription_id: prescriptionId });
    if (!Array.isArray(data)) throw new PrescriptionReviewRepositoryError("UNAVAILABLE");
    return data.map(parseReview);
  }

  async getEvidenceMetadata(_ownerId: string, prescriptionId: string) {
    const data = await this.rpc("meddecode_get_prescription_review_evidence_v1", { p_prescription_id: prescriptionId });
    return data === null ? null : parseEvidence(data);
  }

  async commitRevision(input: ReviewRevisionCommit) {
    if (input.revision.status === "confirmed") {
      const data = await this.rpc("meddecode_confirm_prescription_review_v1", {
        p_prescription_id: input.prescriptionId, p_revision_id: input.expectedRevisionId,
        p_expected_revision_number: input.expectedRevisionNumber, p_expected_lock_version: input.expectedLockVersion,
        p_review: input.revision, p_medicines: medicines(input.revision), p_event: event(input),
        p_request: input.intelligenceRequest ?? null,
      });
      return parseReview(record(data).review);
    }
    return parseReview(await this.rpc("meddecode_apply_prescription_review_draft_v1", {
      p_prescription_id: input.prescriptionId, p_revision_id: input.expectedRevisionId,
      p_expected_revision_number: input.expectedRevisionNumber, p_expected_lock_version: input.expectedLockVersion,
      p_review: input.revision, p_medicines: medicines(input.revision), p_event: event(input),
    }));
  }

  async appendRevision(input: ReviewRevisionCommit) {
    return parseReview(await this.rpc("meddecode_reopen_prescription_review_v1", {
      p_prescription_id: input.prescriptionId, p_revision_id: input.expectedRevisionId,
      p_expected_revision_number: input.expectedRevisionNumber, p_expected_lock_version: input.expectedLockVersion,
      p_new_review: input.revision, p_medicines: medicines(input.revision), p_event: event(input),
    }));
  }

  async getPendingIntelligenceRequest(_ownerId: string, prescriptionId: string) {
    const data = await this.rpc("meddecode_get_review_intelligence_request_v1", { p_prescription_id: prescriptionId });
    return data === null ? null : parseRequest(data);
  }

  async bindProcessingJob(_ownerId: string, requestKey: string, processingJobId: string) {
    return parseRequest(await this.rpc("meddecode_bind_review_intelligence_job_v1", { p_request_key: requestKey, p_processing_job_id: processingJobId }));
  }

  async submitConfirmedIntelligenceJob(_ownerId: string, requestKey: string) {
    return parseRequest(await this.rpc("meddecode_submit_confirmed_review_job_v1", {
      p_request_key: requestKey,
    }));
  }

  async acceptCurrentResult(_ownerId: string, binding: ReviewResultBinding): Promise<void> {
    await this.rpc("meddecode_assert_current_review_result_v1", {
      p_prescription_id: binding.prescriptionId, p_revision_id: binding.confirmedRevisionId,
      p_input_fingerprint: binding.inputFingerprint, p_processing_job_id: binding.processingJobId,
    });
  }
}

export const createPostgresPrescriptionReviewRepository = (client: UserSupabaseClient) =>
  new PostgresPrescriptionReviewRepository(client);
