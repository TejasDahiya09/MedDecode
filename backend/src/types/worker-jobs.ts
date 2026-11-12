import type { IntelligenceFileType } from "./intelligence-contract-v1.js";
import type {
  IntelligenceFailureV1,
  IntelligenceSuccessV1,
} from "./intelligence-contract-v1.js";

export interface WorkerJobClaim {
  readonly jobId: string;
  readonly userId: string;
  readonly prescriptionId: string;
  readonly attemptCount: number;
  readonly claimGeneration: number;
  readonly leaseExpiresAt: string;
  readonly storageProvider: "aws_s3";
  readonly storageBucket: string;
  readonly objectKey: string;
  readonly fileType: IntelligenceFileType;
  readonly inputReference: Readonly<Record<string, unknown>> | null;
}

export interface WorkerHeartbeat {
  readonly jobId: string;
  readonly claimGeneration: number;
  readonly leaseExpiresAt: string;
}

export interface WorkerRuntimeConfig {
  readonly enabled: boolean;
  readonly workerInstanceId: string;
  readonly leaseSeconds: number;
  readonly heartbeatIntervalMs: number;
  readonly pollIntervalMs: number;
  readonly retryInitialMs: number;
  readonly retryMaximumMs: number;
}

/**
 * Immutable identity of one worker-owned claim. Production stores must verify
 * these fields atomically against the current leased processing job.
 */
export interface WorkerJobFence {
  readonly jobId: string;
  readonly prescriptionId: string;
  readonly workerInstanceId: string;
  readonly claimGeneration: number;
}

export type WorkerFailureCode =
  | "PRESCRIPTION_UNAVAILABLE"
  | "DOCUMENT_REFERENCE_FAILED"
  | "INTELLIGENCE_TRANSPORT_FAILED"
  | "INTELLIGENCE_RESPONSE_INVALID"
  | "INTELLIGENCE_REJECTED"
  | "RESULT_PERSISTENCE_FAILED";

export type WorkerContractFailureCode = IntelligenceFailureV1["error"]["code"];

/**
 * Deliberately excludes provider diagnostics, document text, and patient data.
 * The eventual SQL implementation may persist this safe classification only.
 */
export interface WorkerProcessingFailure {
  readonly code: WorkerFailureCode;
  readonly retryable: boolean;
  readonly contractCode?: WorkerContractFailureCode;
}

export interface WorkerJobCompletionCommand extends WorkerJobFence {
  /** Must be a Contract v1 success response correlated to this fenced claim. */
  readonly result: IntelligenceSuccessV1;
  readonly finalizedAt: string;
}

export interface WorkerJobFailureCommand extends WorkerJobFence {
  readonly failure: WorkerProcessingFailure;
  readonly occurredAt: string;
  /** A bounded retry schedule chosen by a future database implementation. */
  readonly retryAt: string | null;
}

export interface WorkerJobCompletionOutcome {
  readonly jobId: string;
  readonly prescriptionId: string;
  readonly jobStatus: "completed";
  readonly prescriptionStatus: "completed" | "completed_with_warnings";
  /** True only for an identical, already-committed finalization replay. */
  readonly replayed: boolean;
}

export interface WorkerJobFailureOutcome {
  readonly jobId: string;
  readonly prescriptionId: string;
  readonly jobStatus: "queued" | "failed";
  readonly prescriptionStatus: "queued" | "failed";
  readonly retryEligible: boolean;
  readonly terminal: boolean;
  readonly availableAt: string | null;
}
