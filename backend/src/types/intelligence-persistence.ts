import type { IntelligenceResponseV1 } from "./intelligence-contract-v1.js";
import type { IntelligenceJobRecord } from "./intelligence-jobs.js";

export type PersistedIntelligenceStatus = "completed" | "completed_with_warnings" | "failed";

/** Existing SQL-backed fields from public.prescription_intelligence_results. */
export interface RawIntelligenceResultInsert {
  readonly prescription_id: string;
  readonly job_id: string;
  readonly schema_version: "1.0";
  readonly status: PersistedIntelligenceStatus;
  readonly result_json: IntelligenceResponseV1;
  readonly error_json: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
  } | null;
}

/** Existing SQL-backed mutable fields from public.prescriptions. */
export interface PrescriptionIntelligencePatch {
  readonly status: PersistedIntelligenceStatus;
  readonly prescription_date?: string | null;
  readonly doctor_name?: string | null;
  readonly doctor_registration_number?: string | null;
  readonly facility_name?: string | null;
  readonly facility_address?: string | null;
  readonly facility_phone?: string | null;
  readonly patient_name?: string | null;
  readonly patient_age?: number | null;
  readonly patient_gender?: string | null;
  readonly intelligence_schema_version: "1.0";
  readonly intelligence_dataset_version?: string;
  readonly intelligence_model_version?: string;
  readonly overall_confidence?: number | null;
  readonly processed_at: string;
}

/** Existing SQL-backed fields from public.prescription_medicines. */
export interface PrescriptionMedicineProjectionInsert {
  readonly prescription_id: string;
  readonly sequence_number: number;
  readonly raw_text: string;
  readonly medicine_name: string | null;
  readonly medicine_name_normalized: string | null;
  readonly strength_value: number | null;
  readonly strength_unit: string | null;
  readonly dosage_form: string | null;
  readonly frequency_type: "scheduled" | "as_needed" | "unknown";
  readonly frequency_morning: number | null;
  readonly frequency_afternoon: number | null;
  readonly frequency_night: number | null;
  readonly frequency_times_per_day: number | null;
  readonly timing: string | null;
  readonly duration_value: number | null;
  readonly duration_unit: string | null;
  readonly quantity_value: number | null;
  readonly quantity_unit: string | null;
  readonly instructions: string | null;
  readonly extraction_confidence: number | null;
  readonly medicine_name_confidence: number | null;
  readonly dosage_confidence: number | null;
  readonly match_status: "matched" | "probable_match" | "ambiguous" | "unmatched" | "not_attempted";
  readonly match_confidence: number | null;
  readonly units_per_day: number | null;
  readonly estimated_total_units: number | null;
}

export interface PrescriptionRecommendationProjectionInsert {
  readonly prescription_id: string;
  readonly type: string;
  readonly title: string;
  readonly message: string;
  readonly related_medicine_sequence_number: number | null;
  readonly confidence: number | null;
}

export interface PrescriptionWarningProjectionInsert {
  readonly prescription_id: string;
  readonly code: string;
  readonly severity: "info" | "low" | "medium" | "high";
  readonly message: string;
  readonly related_medicine_sequence_number: number | null;
}

export type UnsupportedNormalizedField =
  | "medicines[].medicine_match.medicine_external_id"
  | "medicines[].medicine_match.brand_name"
  | "medicines[].medicine_match.dosage_form"
  | "medicines[].medicine_match.ingredients";

export interface IntelligencePersistencePlan {
  readonly rawResult: RawIntelligenceResultInsert;
  readonly prescriptionPatch: PrescriptionIntelligencePatch;
  readonly medicines: readonly PrescriptionMedicineProjectionInsert[];
  readonly recommendations: readonly PrescriptionRecommendationProjectionInsert[];
  readonly warnings: readonly PrescriptionWarningProjectionInsert[];
  readonly unsupportedNormalizedFields: readonly UnsupportedNormalizedField[];
}

export type IntelligenceFinalizationStage =
  | "raw_result"
  | "projections"
  | "prescription_update"
  | "job_transition";

export interface IntelligenceFinalizationInput {
  readonly expectedUserId: string;
  readonly prescriptionOwnerId: string;
  readonly job: IntelligenceJobRecord;
  readonly response: IntelligenceResponseV1;
  readonly finalizedAt: string;
}

export interface IntelligenceFinalizationOutcome {
  readonly jobId: string;
  readonly prescriptionId: string;
  readonly status: PersistedIntelligenceStatus;
  readonly replayed: boolean;
}

/**
 * Production implementations must provide one real atomic database operation.
 * Callers must not emulate atomicity by issuing the logical writes separately.
 */
export interface IntelligenceResultFinalizationTransaction {
  finalizeAtomically(input: IntelligenceFinalizationInput): Promise<IntelligenceFinalizationOutcome>;
}
