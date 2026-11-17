export const REVIEW_CONTRACT_VERSION = "1.0" as const;
export const REVIEW_FINGERPRINT_SCHEMA = "meddecode.review-input.v1" as const;
export const REVIEW_CONFIRMATION_STATEMENT =
  "The user reviewed the extracted transcription. This is not medical verification of the medication or dosage." as const;

export type ReviewRevisionStatus = "draft" | "confirmed";
export type ReviewMedicineStatus = "active" | "removed";
export type ReviewMedicineOrigin = "extracted" | "user_added";
export type ReviewFieldSourceKind =
  | "ocr_observed"
  | "automatically_interpreted"
  | "user_corrected"
  | "unresolved";

export interface ReviewEvidenceReferenceV1 {
  readonly evidenceSetId: string;
  readonly schemaVersion: string;
  readonly documentSha256?: string;
}

export interface ReviewValueWithUnitV1 {
  readonly value: string | null;
  readonly unit: string | null;
}

export interface ReviewMedicineFieldsV1 {
  readonly medicineName: string | null;
  readonly brandName: string | null;
  readonly genericName: string | null;
  readonly strength: ReviewValueWithUnitV1;
  readonly dosageForm: string | null;
  readonly dose: ReviewValueWithUnitV1;
  readonly frequency: string | null;
  readonly timing: string | null;
  readonly route: string | null;
  readonly duration: ReviewValueWithUnitV1;
  readonly quantity: ReviewValueWithUnitV1;
  readonly notes: string | null;
}

export type ReviewEditableField =
  | "medicineName"
  | "brandName"
  | "genericName"
  | "strengthValue"
  | "strengthUnit"
  | "dosageForm"
  | "doseValue"
  | "doseUnit"
  | "frequency"
  | "timing"
  | "route"
  | "durationValue"
  | "durationUnit"
  | "quantityValue"
  | "quantityUnit"
  | "notes";

export interface ReviewFieldProvenanceV1 {
  readonly source: ReviewFieldSourceKind;
  readonly evidenceReference: string | null;
}

export type ReviewFieldProvenanceMapV1 = Readonly<Record<ReviewEditableField, ReviewFieldProvenanceV1>>;

export interface ReviewMedicineEntryV1 {
  readonly medicineId: string;
  readonly origin: ReviewMedicineOrigin;
  readonly status: ReviewMedicineStatus;
  readonly position: number;
  readonly original: ReviewMedicineFieldsV1 | null;
  readonly current: ReviewMedicineFieldsV1;
  readonly provenance: ReviewFieldProvenanceMapV1;
  readonly addedByCommandId: string | null;
  readonly removedAt: string | null;
}

export interface ReviewFingerprintV1 {
  readonly schema: typeof REVIEW_FINGERPRINT_SCHEMA;
  readonly algorithm: "sha256";
  readonly value: string;
}

export interface ReviewConfirmationV1 {
  readonly status: "pending" | "confirmed";
  readonly statement: typeof REVIEW_CONFIRMATION_STATEMENT;
  readonly confirmedAt: string | null;
  readonly idempotencyKey: string | null;
}

export interface PrescriptionReviewContractV1 {
  readonly schemaVersion: typeof REVIEW_CONTRACT_VERSION;
  readonly prescriptionId: string;
  readonly evidence: ReviewEvidenceReferenceV1;
  readonly revisionId: string;
  readonly revisionNumber: number;
  readonly baseRevisionId: string | null;
  readonly status: ReviewRevisionStatus;
  readonly lockVersion: number;
  readonly medicines: readonly ReviewMedicineEntryV1[];
  readonly unresolvedFields: readonly string[];
  readonly confirmation: ReviewConfirmationV1;
  readonly canonicalInputFingerprint: ReviewFingerprintV1 | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface InitialExtractedMedicineV1 {
  readonly medicineId: string;
  readonly fields: ReviewMedicineFieldsV1;
  readonly provenance?: Partial<ReviewFieldProvenanceMapV1>;
}

export type IntelligenceInvalidationArea =
  | "catalogue_identity"
  | "ingredient_assumptions"
  | "dose_interpretation"
  | "schedule_intelligence"
  | "recommendations"
  | "warnings"
  | "aggregate_intelligence";

export interface IntelligenceInvalidationResult {
  readonly stale: boolean;
  readonly affectedMedicineIds: readonly string[];
  readonly areas: readonly IntelligenceInvalidationArea[];
  readonly reasonCodes: readonly string[];
}
