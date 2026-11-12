import type { IntelligenceFileType, IntelligenceResponseV1 } from "./intelligence-contract-v1.js";

export const INTELLIGENCE_JOB_TYPE = "prescription_analysis" as const;

export type IntelligenceJobStatus = "queued" | "processing" | "completed" | "failed";

export interface RequestedAnalysis {
  readonly extract_prescription: boolean;
  readonly match_medicines: boolean;
  readonly find_alternatives: false;
  readonly generate_recommendations: boolean;
}

export const DEFAULT_REQUESTED_ANALYSIS: RequestedAnalysis = Object.freeze({
  extract_prescription: true,
  match_medicines: true,
  find_alternatives: false,
  generate_recommendations: true
});

export interface OwnedProcessablePrescription {
  readonly id: string;
  readonly userId: string;
  readonly fileType: IntelligenceFileType;
  readonly storageProvider: "aws_s3";
  readonly storageBucket: string;
  readonly objectKey: string;
}

export interface IntelligenceJobFailure {
  readonly category:
    | "PRESCRIPTION_UNAVAILABLE"
    | "DOCUMENT_REFERENCE_FAILED"
    | "INTELLIGENCE_TRANSPORT_FAILED"
    | "INTELLIGENCE_RESPONSE_INVALID"
    | "INTELLIGENCE_REJECTED"
    | "RESULT_PERSISTENCE_FAILED";
  readonly contractCode?: "UNSUPPORTED_FILE" | "DOCUMENT_ACCESS_FAILED" | "INVALID_REQUEST" | "PROCESSING_FAILED";
}

export interface IntelligenceJobRecord {
  readonly id: string;
  readonly userId: string;
  readonly prescriptionId: string;
  readonly jobType: typeof INTELLIGENCE_JOB_TYPE;
  readonly requestedAnalysis: RequestedAnalysis;
  readonly status: IntelligenceJobStatus;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly failure: IntelligenceJobFailure | null;
}

export interface StoredIntelligenceResult {
  readonly jobId: string;
  readonly prescriptionId: string;
  readonly response: IntelligenceResponseV1;
  readonly storedAt: string;
}
