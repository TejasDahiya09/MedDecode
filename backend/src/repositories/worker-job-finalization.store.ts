import {
  validateIntelligenceResponseV1,
  IntelligenceContractValidationError,
} from "../services/intelligence-contract-v1.validator.js";
import type {
  WorkerJobCompletionCommand,
  WorkerJobCompletionOutcome,
  WorkerJobFailureCommand,
  WorkerJobFailureOutcome,
} from "../types/worker-jobs.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WORKER_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const FAILURE_CODES = new Set([
  "PRESCRIPTION_UNAVAILABLE",
  "DOCUMENT_REFERENCE_FAILED",
  "INTELLIGENCE_TRANSPORT_FAILED",
  "INTELLIGENCE_RESPONSE_INVALID",
  "INTELLIGENCE_REJECTED",
  "RESULT_PERSISTENCE_FAILED",
]);
const CONTRACT_FAILURE_CODES = new Set([
  "UNSUPPORTED_FILE",
  "DOCUMENT_ACCESS_FAILED",
  "INVALID_REQUEST",
  "PROCESSING_FAILED",
]);

export type WorkerJobFinalizationErrorCategory =
  | "INVALID_COMMAND"
  | "INVALID_RESULT"
  | "CORRELATION_MISMATCH"
  | "WRONG_WORKER"
  | "STALE_CLAIM"
  | "LEASE_EXPIRED"
  | "ALREADY_FINALIZED"
  | "CONFLICTING_FINALIZATION"
  | "UNAVAILABLE";

/** Safe public boundary: implementations must not surface provider diagnostics. */
export class WorkerJobFinalizationError extends Error {
  constructor(readonly category: WorkerJobFinalizationErrorCategory) {
    super("Worker finalization failed safely.");
    this.name = "WorkerJobFinalizationError";
  }
}

/**
 * A future production implementation must execute each method in one PostgreSQL
 * transaction. It must atomically verify lease owner, generation, unexpired
 * lease, processing state, result identity, and terminal/replay state before
 * changing jobs, prescriptions, or intelligence-result records.
 */
export interface WorkerJobFinalizationStore {
  completeOwned(input: WorkerJobCompletionCommand): Promise<WorkerJobCompletionOutcome>;
  failOwned(input: WorkerJobFailureCommand): Promise<WorkerJobFailureOutcome>;
}

/**
 * A maintenance-only capability for returning expired fenced claims to a
 * durable state. It is deliberately separate from the per-claim runtime
 * interface: recovery has no caller-controlled job or prescription ID.
 */
export interface WorkerExpiredJobRecoveryStore {
  recoverExpired(limit: number): Promise<readonly WorkerExpiredJobRecoveryOutcome[]>;
}

export interface WorkerExpiredJobRecoveryOutcome {
  readonly jobId: string;
  readonly prescriptionId: string;
  readonly jobStatus: "queued" | "failed";
  readonly terminal: boolean;
}

const timestamp = (value: string): boolean =>
  Number.isFinite(Date.parse(value));

const validFence = (input: {
  jobId: string;
  prescriptionId: string;
  workerInstanceId: string;
  claimGeneration: number;
}): boolean =>
  UUID_PATTERN.test(input.jobId) && UUID_PATTERN.test(input.prescriptionId) &&
  WORKER_ID_PATTERN.test(input.workerInstanceId) &&
  Number.isSafeInteger(input.claimGeneration) && input.claimGeneration >= 1;

/** Validates only data that can be checked without current database state. */
export function assertValidWorkerCompletionCommand(input: WorkerJobCompletionCommand): void {
  if (!validFence(input) || !timestamp(input.finalizedAt)) {
    throw new WorkerJobFinalizationError("INVALID_COMMAND");
  }
  try {
    const response = validateIntelligenceResponseV1(input.result, {
      jobId: input.jobId,
      prescriptionId: input.prescriptionId,
    });
    if (response.status === "failed") throw new WorkerJobFinalizationError("INVALID_RESULT");
  } catch (error) {
    if (error instanceof WorkerJobFinalizationError) throw error;
    if (error instanceof IntelligenceContractValidationError) {
      throw new WorkerJobFinalizationError("INVALID_RESULT");
    }
    throw error;
  }
}

/** Validates only data that can be checked without current database state. */
export function assertValidWorkerFailureCommand(input: WorkerJobFailureCommand): void {
  if (!validFence(input) || !timestamp(input.occurredAt) ||
      !FAILURE_CODES.has(input.failure.code) ||
      typeof input.failure.retryable !== "boolean" ||
      (input.failure.contractCode !== undefined && !CONTRACT_FAILURE_CODES.has(input.failure.contractCode)) ||
      (input.retryAt !== null && !timestamp(input.retryAt))) {
    throw new WorkerJobFinalizationError("INVALID_COMMAND");
  }
}

/** Safe production default until an approved atomic PostgreSQL implementation exists. */
export class UnavailableWorkerJobFinalizationStore implements WorkerJobFinalizationStore {
  async completeOwned(): Promise<never> {
    throw new WorkerJobFinalizationError("UNAVAILABLE");
  }

  async failOwned(): Promise<never> {
    throw new WorkerJobFinalizationError("UNAVAILABLE");
  }
}

export const createUnavailableWorkerJobFinalizationStore = (): WorkerJobFinalizationStore =>
  new UnavailableWorkerJobFinalizationStore();
