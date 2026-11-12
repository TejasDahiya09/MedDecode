import type { WorkerJobFinalizationStore } from "../repositories/worker-job-finalization.store.js";
import type { IntelligenceClient } from "./intelligence-client.js";
import { IntelligenceContractValidationError, validateIntelligenceResponseV1 } from "./intelligence-contract-v1.validator.js";
import type { WorkerClaimHandler } from "./processing-worker.runtime.js";
import { WorkerDocumentReadError, type WorkerDocumentReader } from "./worker-document.reader.js";
import type { IntelligenceRequestV1, IntelligenceSuccessV1 } from "../types/intelligence-contract-v1.js";
import type { WorkerFailureCode, WorkerJobClaim } from "../types/worker-jobs.js";

/** Creates a real-document Python client only after the isolated file exists. */
export type RealPdfIntelligenceClientFactory = (localPdfPath: string) => IntelligenceClient;

export class RealPrescriptionWorkerError extends Error {
  constructor(readonly code: WorkerFailureCode) {
    super("Real prescription worker failed safely.");
    this.name = "RealPrescriptionWorkerError";
  }
}

function requestFor(claim: WorkerJobClaim): IntelligenceRequestV1 {
  return {
    schema_version: "1.0", job_id: claim.jobId, prescription_id: claim.prescriptionId,
    document: { access_type: "authorized_url", file_url: "https://worker.invalid/authorized-document", file_type: claim.fileType },
    requested_analysis: { extract_prescription: true, match_medicines: true, find_alternatives: false, generate_recommendations: false },
  };
}

export class RealPrescriptionProcessor {
  constructor(
    private readonly documents: WorkerDocumentReader,
    private readonly createPythonClient: RealPdfIntelligenceClientFactory,
  ) {}

  async process(claim: WorkerJobClaim, signal: AbortSignal): Promise<IntelligenceSuccessV1> {
    let document: Awaited<ReturnType<WorkerDocumentReader["download"]>> | undefined;
    try {
      document = await this.documents.download(claim, signal);
      // The only permitted local document path comes from the reader. The
      // factory must construct a `real-local-pdf` client; fixture mode is not
      // accepted by this handler and no request can provide a file path.
      const response = await this.createPythonClient(document.path).analyze(requestFor(claim));
      const validated = validateIntelligenceResponseV1(response, { jobId: claim.jobId, prescriptionId: claim.prescriptionId });
      if (validated.status === "failed") throw new RealPrescriptionWorkerError("INTELLIGENCE_REJECTED");
      return validated;
    } catch (error) {
      if (error instanceof RealPrescriptionWorkerError) throw error;
      if (error instanceof WorkerDocumentReadError) throw new RealPrescriptionWorkerError("DOCUMENT_REFERENCE_FAILED");
      if (error instanceof IntelligenceContractValidationError) throw new RealPrescriptionWorkerError("INTELLIGENCE_RESPONSE_INVALID");
      throw new RealPrescriptionWorkerError("INTELLIGENCE_TRANSPORT_FAILED");
    } finally {
      await document?.cleanup().catch(() => undefined);
    }
  }
}

/**
 * Provides the existing runtime handler shape without registering a worker.
 * Completion remains behind its injected fenced finalization contract.
 */
export function createRealPrescriptionWorkerHandler(options: {
  readonly processor: RealPrescriptionProcessor;
  readonly finalization: WorkerJobFinalizationStore;
  readonly workerInstanceId: string;
  readonly now?: () => Date;
  readonly retryDelayMs?: number;
}): WorkerClaimHandler {
  return async (claim, signal) => {
    const now = options.now ?? (() => new Date());
    try {
      const result = await options.processor.process(claim, signal);
      await options.finalization.completeOwned({
        jobId: claim.jobId, prescriptionId: claim.prescriptionId,
        workerInstanceId: options.workerInstanceId, claimGeneration: claim.claimGeneration,
        result, finalizedAt: now().toISOString(),
      });
    } catch (error) {
      if (!(error instanceof RealPrescriptionWorkerError)) throw error;
      const retryable = error.code === "DOCUMENT_REFERENCE_FAILED" ||
        error.code === "INTELLIGENCE_TRANSPORT_FAILED";
      const occurredAt = now();
      await options.finalization.failOwned({
        jobId: claim.jobId, prescriptionId: claim.prescriptionId,
        workerInstanceId: options.workerInstanceId, claimGeneration: claim.claimGeneration,
        failure: { code: error.code, retryable }, occurredAt: occurredAt.toISOString(),
        retryAt: retryable
          ? new Date(occurredAt.getTime() + (options.retryDelayMs ?? 60_000)).toISOString()
          : null,
      });
    }
  };
}
