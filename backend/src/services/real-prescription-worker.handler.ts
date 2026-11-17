import { randomUUID } from "node:crypto";

import type { WorkerJobFinalizationStore } from "../repositories/worker-job-finalization.store.js";
import type { IntelligenceClient } from "./intelligence-client.js";
import { IntelligenceContractValidationError, validateIntelligenceResponseV1 } from "./intelligence-contract-v1.validator.js";
import type { WorkerClaimHandler, WorkerLogger } from "./processing-worker.runtime.js";
import { IntelligenceHttpError } from './http-python-intelligence.client.js';
import { WorkerDocumentReadError, type WorkerDocumentReader } from "./worker-document.reader.js";
import type { IntelligenceRequestV1, IntelligenceSuccessV1 } from "../types/intelligence-contract-v1.js";
import type { WorkerContractFailureCode, WorkerFailureCode, WorkerJobClaim } from "../types/worker-jobs.js";
import { confirmedReviewBinding } from "../types/worker-jobs.js";
import { DEFAULT_REQUESTED_ANALYSIS } from "../types/intelligence-jobs.js";
import type { PrescriptionReviewWorkerStore } from "../repositories/prescription-review-worker.store.js";
import { ConfirmedReviewIntelligenceError, type ConfirmedReviewIntelligenceClient } from "./confirmed-review-intelligence.client.js";
import { PrescriptionReviewWorkerRpcError } from '../repositories/prescription-review-worker.rpc-store.js';

export class WorkerStageError extends Error {
  readonly category: string;
  readonly rpcName: string | undefined;
  readonly sqlstate: string | undefined;
  constructor(readonly stage: string, error: unknown) {
    super('Processing stage failed safely.');
    this.category = error instanceof PrescriptionReviewWorkerRpcError ? error.category : 'PROCESSING';
    this.rpcName = error instanceof PrescriptionReviewWorkerRpcError ? error.rpcName : undefined;
    this.sqlstate = error instanceof PrescriptionReviewWorkerRpcError ? error.sqlstate : undefined;
  }
}

/** Creates a real-document Python client only after the isolated file exists. */
export type RealPdfIntelligenceClientFactory = (localPdfPath: string) => IntelligenceClient;

export class RealPrescriptionWorkerError extends Error {
  constructor(readonly code: WorkerFailureCode, readonly contractCode?: WorkerContractFailureCode, readonly retryable?: boolean,
    readonly stage?: string, readonly httpStatus?: number) {
    super("Real prescription worker failed safely.");
    this.name = "RealPrescriptionWorkerError";
  }
}

function requestFor(claim: WorkerJobClaim): IntelligenceRequestV1 {
  return {
    schema_version: "1.0", job_id: claim.jobId, prescription_id: claim.prescriptionId,
    document: { access_type: "authorized_url", file_url: "https://worker.invalid/authorized-document", file_type: claim.fileType },
    requested_analysis: { ...DEFAULT_REQUESTED_ANALYSIS },
  };
}

export class RealPrescriptionProcessor {
  constructor(
    private readonly documents: WorkerDocumentReader,
    private readonly createPythonClient: RealPdfIntelligenceClientFactory,
  ) {}

  async process(claim: WorkerJobClaim, signal: AbortSignal): Promise<IntelligenceSuccessV1> {
    let document: Awaited<ReturnType<WorkerDocumentReader["download"]>> | undefined;
    let stage = 'document_download';
    try {
      document = await this.documents.download(claim, signal);
      if (signal.aborted) throw new RealPrescriptionWorkerError("INTELLIGENCE_TRANSPORT_FAILED");
      // The only permitted local document path comes from the reader. The
      // factory must construct the real-document client; fixture mode is not
      // accepted by this handler and no request can provide a file path.
      stage = 'python_http';
      const response = await this.createPythonClient(document.path).analyze(requestFor(claim), signal);
      if (signal.aborted) throw new RealPrescriptionWorkerError("INTELLIGENCE_TRANSPORT_FAILED");
      stage = 'contract_validation';
      const validated = validateIntelligenceResponseV1(response, { jobId: claim.jobId, prescriptionId: claim.prescriptionId });
      if (validated.status === "failed") throw new RealPrescriptionWorkerError("INTELLIGENCE_REJECTED", validated.error.code, validated.error.retryable, stage);
      return validated;
    } catch (error) {
      if (error instanceof RealPrescriptionWorkerError) throw error;
      if (error instanceof WorkerDocumentReadError) throw new RealPrescriptionWorkerError("DOCUMENT_REFERENCE_FAILED", undefined, undefined, stage);
      if (error instanceof IntelligenceContractValidationError) throw new RealPrescriptionWorkerError("INTELLIGENCE_RESPONSE_INVALID", undefined, undefined, stage);
      if (error instanceof IntelligenceHttpError) throw new RealPrescriptionWorkerError(
        error.category === 'RESPONSE' ? 'INTELLIGENCE_RESPONSE_INVALID' : 'INTELLIGENCE_TRANSPORT_FAILED', undefined, undefined, stage, error.httpStatus);
      throw new RealPrescriptionWorkerError("INTELLIGENCE_TRANSPORT_FAILED", undefined, undefined, stage);
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
  readonly allowRetry?: boolean;
  readonly logger?: WorkerLogger;
  readonly review?: Readonly<{
    store: PrescriptionReviewWorkerStore;
    intelligence: ConfirmedReviewIntelligenceClient;
  }>;
}): WorkerClaimHandler {
  if (options.retryDelayMs !== undefined && (!Number.isSafeInteger(options.retryDelayMs) || options.retryDelayMs < 1 || options.retryDelayMs > 86_400_000)) {
    throw new Error("Worker retry delay is invalid.");
  }
  return async (claim, signal) => {
    const now = options.now ?? (() => new Date());
    let reviewBinding: ReturnType<typeof confirmedReviewBinding> = null;
    let stage = 'binding_validation';
    try {
      reviewBinding = confirmedReviewBinding(claim);
      if (reviewBinding !== null) {
        if (!options.review) throw new RealPrescriptionWorkerError("INTELLIGENCE_TRANSPORT_FAILED");
        stage = 'confirmed_review_load';
        const review = await options.review.store.loadConfirmed({ claim, binding: reviewBinding, workerInstanceId: options.workerInstanceId });
        stage = 'confirmed_intelligence';
        const result = await options.review.intelligence.analyzeConfirmed({
          jobId: claim.jobId,
          prescriptionId: claim.prescriptionId,
          review,
        }, signal);
        if (signal.aborted) throw new RealPrescriptionWorkerError("INTELLIGENCE_TRANSPORT_FAILED");
        stage = 'confirmed_finalization';
        await options.review.store.finalizeConfirmed({
          claim, binding: reviewBinding, workerInstanceId: options.workerInstanceId, result,
        });
        return;
      }
      stage = 'document_and_intelligence';
      const result = await options.processor.process(claim, signal);
      if (options.review) {
        stage = 'review_initialization';
        await options.review.store.initializeFromOcr({
          claim, result, now: now().toISOString(),
          evidence: {
            evidenceSetId: randomUUID(), schemaVersion: "1.0", documentSha256: null,
            pageCount: null, providerCount: 1,
            payload: { warnings: result.warnings, processing_metadata: result.processing_metadata },
          },
        });
        stage = 'initial_review_completion';
        await options.review.store.completeInitialReview({
          claim, workerInstanceId: options.workerInstanceId,
        });
        return;
      }
      await options.finalization.completeOwned({
        jobId: claim.jobId, prescriptionId: claim.prescriptionId,
        workerInstanceId: options.workerInstanceId, claimGeneration: claim.claimGeneration,
        result, finalizedAt: now().toISOString(),
      });
    } catch (error) {
      // Lease loss and shutdown must never trigger completion or failure writes;
      // the database recovery process owns the next transition.
      if (signal.aborted) throw error;
      if (error instanceof ConfirmedReviewIntelligenceError) {
        error = new RealPrescriptionWorkerError("INTELLIGENCE_REJECTED", undefined, false);
      }
      if (!(error instanceof RealPrescriptionWorkerError)) throw new WorkerStageError(stage, error);
      options.logger?.({ level: 'error', event: 'worker_handler_failed', jobId: claim.jobId,
        claimGeneration: claim.claimGeneration, stage: error.stage ?? stage, category: error.code,
        ...(error.httpStatus === undefined ? {} : { httpStatus: error.httpStatus }) });
      if (reviewBinding !== null && options.review) {
        await options.review.store.failConfirmed({
          claim, binding: reviewBinding, workerInstanceId: options.workerInstanceId, failureCode: error.code,
        });
        return;
      }
      const retryable = options.allowRetry !== false && (error.retryable ?? (error.code === "DOCUMENT_REFERENCE_FAILED" ||
        error.code === "INTELLIGENCE_TRANSPORT_FAILED"));
      const occurredAt = now();
      await options.finalization.failOwned({
        jobId: claim.jobId, prescriptionId: claim.prescriptionId,
        workerInstanceId: options.workerInstanceId, claimGeneration: claim.claimGeneration,
        failure: { code: error.code, retryable, ...(error.contractCode === undefined ? {} : { contractCode: error.contractCode }) }, occurredAt: occurredAt.toISOString(),
        retryAt: retryable
          ? new Date(occurredAt.getTime() + (options.retryDelayMs ?? 60_000)).toISOString()
          : null,
      });
    }
  };
}
