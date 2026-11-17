/**
 * Prescription Review & Confirmation Types
 * Aligned with MedDecode Review Contract v1 and Architecture V3.
 */

export const REVIEW_CONTRACT_VERSION = '1.0' as const;
export const REVIEW_FINGERPRINT_SCHEMA = 'meddecode.review-input.v1' as const;
export const REVIEW_CONFIRMATION_STATEMENT =
  'I have reviewed the extracted transcription and corrected it where necessary.' as const;
export const REVIEW_CLINICAL_DISCLAIMER =
  'This confirmation does not verify that the prescription or dosage is medically appropriate.' as const;

export type ReviewRevisionStatus = 'draft' | 'confirmed';
export type ReviewMedicineStatus = 'active' | 'removed';
export type ReviewMedicineOrigin = 'extracted' | 'user_added';
export type ReviewFieldSourceKind =
  | 'ocr_observed'
  | 'automatically_interpreted'
  | 'user_corrected'
  | 'unresolved';

export interface ReviewEvidenceReferenceV1 {
  readonly evidenceSetId: string;
  readonly schemaVersion: string;
  readonly documentSha256?: string;
  readonly fileName?: string;
  readonly pageCount?: number;
  readonly documentUrl?: string;
  readonly fileType?: string;
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
  | 'medicineName'
  | 'brandName'
  | 'genericName'
  | 'strengthValue'
  | 'strengthUnit'
  | 'dosageForm'
  | 'doseValue'
  | 'doseUnit'
  | 'frequency'
  | 'timing'
  | 'route'
  | 'durationValue'
  | 'durationUnit'
  | 'quantityValue'
  | 'quantityUnit'
  | 'notes';

export const REVIEW_EDITABLE_FIELDS: readonly ReviewEditableField[] = [
  'medicineName',
  'brandName',
  'genericName',
  'strengthValue',
  'strengthUnit',
  'dosageForm',
  'doseValue',
  'doseUnit',
  'frequency',
  'timing',
  'route',
  'durationValue',
  'durationUnit',
  'quantityValue',
  'quantityUnit',
  'notes',
] as const;

export interface ReviewFieldProvenanceV1 {
  readonly source: ReviewFieldSourceKind;
  readonly evidenceReference: string | null;
  readonly rawText?: string | null;
  readonly confidenceScore?: number | null;
  readonly isUncertain?: boolean;
}

export type ReviewFieldProvenanceMapV1 = Readonly<Record<ReviewEditableField, ReviewFieldProvenanceV1>>;

export interface SourceCoordinateHighlight {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly pageNumber: number;
  readonly fieldName?: ReviewEditableField;
  readonly textSnippet?: string;
}

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
  readonly highlights?: readonly SourceCoordinateHighlight[];
  readonly reviewWarnings?: readonly ReviewWarningItem[];
}

export interface ReviewWarningItem {
  readonly code: string;
  readonly message: string;
  readonly field?: ReviewEditableField;
  readonly severity: 'warning' | 'info' | 'danger';
  readonly medicineId?: string;
}

export interface ReviewFingerprintV1 {
  readonly schema: typeof REVIEW_FINGERPRINT_SCHEMA;
  readonly algorithm: 'sha256';
  readonly value: string;
}

export interface ReviewConfirmationV1 {
  readonly status: 'pending' | 'confirmed';
  readonly statement: string;
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

// Backend Operation & Request Types (matching backend/src/services/prescription-review.service.ts)
export type ReviewDraftOperation =
  | { readonly type: 'edit_fields'; readonly medicineId: string; readonly updates: Partial<Record<ReviewEditableField, string | null>> }
  | { readonly type: 'add_medicine'; readonly commandId: string; readonly medicineId: string; readonly fields: ReviewMedicineFieldsV1; readonly position?: number }
  | { readonly type: 'remove_medicine'; readonly medicineId: string }
  | { readonly type: 'restore_medicine'; readonly medicineId: string }
  | { readonly type: 'restore_original'; readonly medicineId: string }
  | { readonly type: 'reorder_medicines'; readonly orderedMedicineIds: readonly string[] }
  | { readonly type: 'save_draft' };

export interface ApplyDraftPayload {
  readonly expectedRevisionNumber: number;
  readonly expectedLockVersion: number;
  readonly operation: ReviewDraftOperation;
}

export interface ConfirmReviewPayload {
  readonly expectedRevisionNumber: number;
  readonly expectedLockVersion: number;
  readonly idempotencyKey: string;
}

export interface ReopenReviewPayload {
  readonly expectedRevisionNumber: number;
  readonly expectedLockVersion: number;
}

export interface PendingReviewIntelligenceRequest {
  readonly requestKey: string;
  readonly ownerId: string;
  readonly prescriptionId: string;
  readonly confirmedRevisionId: string;
  readonly inputFingerprint: string;
  readonly processingJobId: string | null;
  readonly state: 'pending' | 'processing' | 'completed' | 'failed' | 'stale';
  readonly createdAt: string;
}

export interface ReviewConfirmationResponse {
  readonly review: PrescriptionReviewContractV1;
  readonly intelligenceRequest: PendingReviewIntelligenceRequest | null;
}

export interface ReviewRevisionListResponse {
  readonly revisions: readonly PrescriptionReviewContractV1[];
}

export type ReviewPreviewSourceKind =
  | 'authorized_blob'
  | 'authorized_stream'
  | 'fictional_demo'
  | 'unavailable';

export interface ReviewDocumentPreviewSource {
  readonly kind?: ReviewPreviewSourceKind;
  readonly available: boolean;
  readonly url?: string;
  readonly fileType?: string;
  readonly fileName?: string;
  readonly totalPages: number;
  readonly coordinatesAvailable: boolean;
  readonly message?: string;
  readonly isDemoMock?: boolean;
  readonly revokeOnUnmount?: boolean;
}

export type DocumentPreviewData = ReviewDocumentPreviewSource;
