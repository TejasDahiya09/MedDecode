export const INTELLIGENCE_SCHEMA_VERSION = "1.0" as const;

export type IntelligenceFileType = "image/jpeg" | "image/png" | "application/pdf";

export interface IntelligenceRequestV1 {
  schema_version: typeof INTELLIGENCE_SCHEMA_VERSION;
  job_id: string;
  prescription_id: string;
  document: {
    access_type: "authorized_url" | "direct_upload";
    file_url?: string;
    file_type: IntelligenceFileType;
    original_filename?: string;
    [key: string]: unknown;
  };
  requested_analysis: {
    extract_prescription: boolean;
    match_medicines: boolean;
    find_alternatives: boolean;
    generate_recommendations: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}
export type Phase52IntelligenceRequestV1 = IntelligenceRequestV1 & {
  document: IntelligenceRequestV1["document"] & {
    access_type: "authorized_url";
    file_url: string;
  };
};

export interface IntelligenceFailureV1 {
  schema_version: typeof INTELLIGENCE_SCHEMA_VERSION;
  job_id: string;
  prescription_id: string;
  status: "failed";
  error: {
    code: "UNSUPPORTED_FILE" | "DOCUMENT_ACCESS_FAILED" | "INVALID_REQUEST" | "PROCESSING_FAILED";
    message: string;
    retryable: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface IntelligenceSuccessV1 {
  schema_version: typeof INTELLIGENCE_SCHEMA_VERSION;
  job_id: string;
  prescription_id: string;
  status: "completed" | "completed_with_warnings";
  prescription: Record<string, unknown>;
  patient: Record<string, unknown>;
  medicines: Record<string, unknown>[];
  recommendations: Record<string, unknown>[];
  warnings: Record<string, unknown>[];
  processing_metadata: {
    overall_confidence: number | null;
    dataset_version?: string;
    model_version?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export type IntelligenceResponseV1 = IntelligenceSuccessV1 | IntelligenceFailureV1;
