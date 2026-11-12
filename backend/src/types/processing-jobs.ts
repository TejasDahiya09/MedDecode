import type { IntelligenceJobRecord } from "./intelligence-jobs.js";

export type ProcessingSubmissionResult =
  | { readonly kind: "created"; readonly job: IntelligenceJobRecord }
  | { readonly kind: "active"; readonly job: IntelligenceJobRecord }
  | { readonly kind: "prescription_not_found" }
  | { readonly kind: "not_processable" }
  | { readonly kind: "result_exists" };

export type ProcessingStatusResult =
  | { readonly kind: "job"; readonly job: IntelligenceJobRecord }
  | { readonly kind: "none" }
  | { readonly kind: "prescription_not_found" };

export interface ProcessingSubmissionResponse {
  readonly prescription_id: string;
  readonly job: {
    readonly id: string;
    readonly status: "queued" | "processing";
    readonly created_at: string;
  };
  readonly submission: {
    readonly created: boolean;
  };
}

export interface ProcessingStatusResponse {
  readonly prescription_id: string;
  readonly processing: null | {
    readonly job_id: string;
    readonly status: "queued" | "processing" | "completed" | "failed";
    readonly created_at: string;
    readonly started_at: string | null;
    readonly completed_at: string | null;
  };
}
