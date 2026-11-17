import type {
  PrescriptionReviewContractV1,
  ReviewMedicineFieldsV1,
  DocumentPreviewData,
  ReviewDocumentPreviewSource,
  ReviewEvidenceReferenceV1,
  ApplyDraftPayload,
  ConfirmReviewPayload,
  ReopenReviewPayload,
  ReviewConfirmationResponse,
  ReviewRevisionListResponse,
} from './types';
import {
  createInitialReviewDraft,
  editMedicineFields,
  addMedicine,
  removeMedicine,
  restoreMedicine,
  restoreOriginalMedicineValues,
  reorderMedicines,
  saveReviewDraft,
  confirmReview,
  createDraftFromConfirmed,
} from './review-domain';
import { endpointFor } from '../../services/api-client';

export class PrescriptionReviewApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'PrescriptionReviewApiError';
  }
}

/**
 * Hardened feature flag check.
 *
 * Requirements:
 * 1. Normal production users MUST NOT activate the review workflow through URL parameters (?review=true).
 * 2. Normal production users MUST NOT activate the review workflow through localStorage.
 * 3. The frontend build-time feature flag must be disabled by default (VITE_PRESCRIPTION_REVIEW_ENABLED=true required).
 * 4. The backend feature flag remains independently authoritative.
 */
export function isPrescriptionReviewFeatureEnabled(): boolean {
  // Production environment: Strictly rely on build-time environment variable.
  if (import.meta.env.PROD) {
    return import.meta.env.VITE_PRESCRIPTION_REVIEW_ENABLED === 'true';
  }

  // Development/Test environment:
  if (import.meta.env.VITE_PRESCRIPTION_REVIEW_ENABLED === 'true') {
    return true;
  }

  // Isolated developer override (development mode only):
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    const searchParams = new URLSearchParams(window.location.search);
    if (searchParams.get('dev_review') === 'true') {
      return true;
    }
    if (window.localStorage.getItem('meddecode_dev_review_enabled') === 'true') {
      return true;
    }
  }

  return false;
}

/**
 * Backwards-compatible alias for existing imports.
 */
export const isPrescriptionReviewEnabled = isPrescriptionReviewFeatureEnabled;

/**
 * Checks whether a given prescription ID is an isolated fictional demo scenario.
 */
export function isFictionalDemoScenario(prescriptionId: string): boolean {
  return prescriptionId.startsWith('scenario-');
}

export interface PrescriptionReviewAdapter {
  fetchReview(prescriptionId: string, signal?: AbortSignal): Promise<PrescriptionReviewContractV1>;
  fetchRevisionHistory(prescriptionId: string, signal?: AbortSignal): Promise<ReviewRevisionListResponse>;
  fetchEvidenceMetadata(prescriptionId: string, signal?: AbortSignal): Promise<ReviewEvidenceReferenceV1>;
  applyDraftOperation(
    prescriptionId: string,
    payload: ApplyDraftPayload,
    signal?: AbortSignal
  ): Promise<PrescriptionReviewContractV1>;
  confirmReview(
    prescriptionId: string,
    payload: ConfirmReviewPayload,
    signal?: AbortSignal
  ): Promise<ReviewConfirmationResponse>;
  reopenReview(
    prescriptionId: string,
    payload: ReopenReviewPayload,
    signal?: AbortSignal
  ): Promise<PrescriptionReviewContractV1>;
  fetchDocumentPreview(prescriptionId: string, signal?: AbortSignal): Promise<DocumentPreviewData>;
  fetchDocumentBlob?(prescriptionId: string, signal?: AbortSignal): Promise<ReviewDocumentPreviewSource>;
  resetMockData?(prescriptionId?: string): void;
  simulateConflict?(prescriptionId: string): void;
}

export type MockScenarioId =
  | 'scenario-a' // One clean printed medicine
  | 'scenario-b' // Three medicines with different instructions
  | 'scenario-c' // Five medicines requiring corrections
  | 'scenario-d' // One medicine with uncertain strength
  | 'scenario-e' // Missing medicine added manually
  | 'scenario-f' // Incorrect OCR medicine removed
  | 'scenario-g' // Previously confirmed review reopened
  | 'scenario-h' // Conflicting revisions
  | 'scenario-i' // Document preview unavailable
  | 'scenario-j'; // Partial OCR processing with warnings

function emptyFields(): ReviewMedicineFieldsV1 {
  return {
    medicineName: null,
    brandName: null,
    genericName: null,
    strength: { value: null, unit: null },
    dosageForm: null,
    dose: { value: null, unit: null },
    frequency: null,
    timing: null,
    route: null,
    duration: { value: null, unit: null },
    quantity: { value: null, unit: null },
    notes: null,
  };
}

export class HttpPrescriptionReviewAdapter implements PrescriptionReviewAdapter {
  constructor(private readonly getAccessToken: () => string | null) {}

  private async request<T>(
    path: string,
    options: {
      method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
      body?: unknown;
      signal?: AbortSignal;
    } = {}
  ): Promise<T> {
    const token = this.getAccessToken();
    if (!token || !token.trim()) {
      throw new PrescriptionReviewApiError(
        'An authenticated session is required to access prescription reviews.',
        401,
        'UNAUTHORIZED'
      );
    }

    const endpoint = endpointFor(path);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token.trim()}`,
      Accept: 'application/json',
    };
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: options.method || 'GET',
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: options.signal,
      });
    } catch (networkErr: unknown) {
      if (options.signal?.aborted || (networkErr instanceof Error && networkErr.name === 'AbortError')) {
        throw networkErr;
      }
      throw new PrescriptionReviewApiError(
        'The prescription review service could not be reached.',
        0,
        'NETWORK_ERROR',
        { cause: networkErr }
      );
    }

    if (!response.ok) {
      let code: string | undefined;
      let message = `Prescription review request failed with HTTP ${response.status}.`;
      try {
        const errorJson = await response.json();
        if (errorJson && typeof errorJson === 'object') {
          if (errorJson.error && typeof errorJson.error === 'object') {
            if (typeof errorJson.error.code === 'string') code = errorJson.error.code;
            if (typeof errorJson.error.message === 'string') message = errorJson.error.message;
          } else if (typeof errorJson.code === 'string') {
            code = errorJson.code;
            if (typeof errorJson.message === 'string') message = errorJson.message;
          }
        }
      } catch {
        // Fallback to default status message
      }
      throw new PrescriptionReviewApiError(message, response.status, code);
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new PrescriptionReviewApiError(
        'The review service returned an invalid JSON response.',
        response.status,
        'MALFORMED_RESPONSE'
      );
    }
  }

  public async fetchReview(prescriptionId: string, signal?: AbortSignal): Promise<PrescriptionReviewContractV1> {
    return this.request<PrescriptionReviewContractV1>(
      `/api/v1/prescriptions/${encodeURIComponent(prescriptionId)}/review`,
      { method: 'GET', signal }
    );
  }

  public async fetchRevisionHistory(
    prescriptionId: string,
    signal?: AbortSignal
  ): Promise<ReviewRevisionListResponse> {
    return this.request<ReviewRevisionListResponse>(
      `/api/v1/prescriptions/${encodeURIComponent(prescriptionId)}/review/revisions`,
      { method: 'GET', signal }
    );
  }

  public async fetchEvidenceMetadata(
    prescriptionId: string,
    signal?: AbortSignal
  ): Promise<ReviewEvidenceReferenceV1> {
    return this.request<ReviewEvidenceReferenceV1>(
      `/api/v1/prescriptions/${encodeURIComponent(prescriptionId)}/evidence`,
      { method: 'GET', signal }
    );
  }

  public async applyDraftOperation(
    prescriptionId: string,
    payload: ApplyDraftPayload,
    signal?: AbortSignal
  ): Promise<PrescriptionReviewContractV1> {
    return this.request<PrescriptionReviewContractV1>(
      `/api/v1/prescriptions/${encodeURIComponent(prescriptionId)}/review/draft`,
      {
        method: 'PATCH',
        body: {
          expectedRevisionNumber: payload.expectedRevisionNumber,
          expectedLockVersion: payload.expectedLockVersion,
          operation: payload.operation,
        },
        signal,
      }
    );
  }

  public async confirmReview(
    prescriptionId: string,
    payload: ConfirmReviewPayload,
    signal?: AbortSignal
  ): Promise<ReviewConfirmationResponse> {
    return this.request<ReviewConfirmationResponse>(
      `/api/v1/prescriptions/${encodeURIComponent(prescriptionId)}/review/confirm`,
      {
        method: 'POST',
        body: {
          expectedRevisionNumber: payload.expectedRevisionNumber,
          expectedLockVersion: payload.expectedLockVersion,
          idempotencyKey: payload.idempotencyKey,
        },
        signal,
      }
    );
  }

  public async reopenReview(
    prescriptionId: string,
    payload: ReopenReviewPayload,
    signal?: AbortSignal
  ): Promise<PrescriptionReviewContractV1> {
    return this.request<PrescriptionReviewContractV1>(
      `/api/v1/prescriptions/${encodeURIComponent(prescriptionId)}/review/reopen`,
      {
        method: 'POST',
        body: {
          expectedRevisionNumber: payload.expectedRevisionNumber,
          expectedLockVersion: payload.expectedLockVersion,
        },
        signal,
      }
    );
  }

  public async fetchDocumentPreview(prescriptionId: string, signal?: AbortSignal): Promise<DocumentPreviewData> {
    try {
      const meta = await this.fetchEvidenceMetadata(prescriptionId, signal);
      return {
        kind: 'unavailable',
        available: false,
        fileName: meta.fileName,
        totalPages: meta.pageCount ?? 0,
        coordinatesAvailable: false,
        message:
          'Original document scan preview requires authenticated streaming (Phase 1B.2 backend blocker). Structured medicine transcription is loaded from verified review records.',
        isDemoMock: false,
      };
    } catch {
      return {
        kind: 'unavailable',
        available: false,
        totalPages: 0,
        coordinatesAvailable: false,
        message:
          'Original document scan preview is not currently available from the backend evidence service.',
        isDemoMock: false,
      };
    }
  }

  /**
   * Safe document blob stream adapter ready for authorized Phase 1B.2 backend document scan streaming.
   * Does NOT invent signed URLs or construct S3 keys.
   */
  public async fetchDocumentBlob(
    prescriptionId: string,
    signal?: AbortSignal
  ): Promise<ReviewDocumentPreviewSource> {
    const token = this.getAccessToken();
    if (!token) {
      throw new PrescriptionReviewApiError('Unauthorized: missing access token', 401, 'UNAUTHORIZED');
    }

    try {
      const url = endpointFor(`/api/v1/prescriptions/${encodeURIComponent(prescriptionId)}/document/preview`);
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/pdf, image/jpeg, image/png',
        },
        signal,
      });

      if (!response.ok) {
        return {
          kind: 'unavailable',
          available: false,
          totalPages: 0,
          coordinatesAvailable: false,
          message: `Original prescription document preview is not currently available (HTTP ${response.status}).`,
          isDemoMock: false,
        };
      }

      const contentType = response.headers.get('content-type') || 'application/pdf';
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);

      return {
        kind: 'authorized_blob',
        available: true,
        url: objectUrl,
        fileType: contentType,
        fileName: `prescription-${prescriptionId.slice(0, 8)}`,
        totalPages: 1,
        coordinatesAvailable: false,
        message: 'Secure document preview loaded via authorized session.',
        isDemoMock: false,
        revokeOnUnmount: true,
      };
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw err;
      }
      return {
        kind: 'unavailable',
        available: false,
        totalPages: 0,
        coordinatesAvailable: false,
        message:
          'Prescription document preview streaming is currently unavailable (requires Phase 1B.2 backend document scan streaming service).',
        isDemoMock: false,
      };
    }
  }
}

function generateMockScenarios(): Record<
  string,
  {
    review: PrescriptionReviewContractV1;
    revisions: PrescriptionReviewContractV1[];
    preview: DocumentPreviewData;
    evidence: ReviewEvidenceReferenceV1;
  }
> {
  // Scenario A: 1 Clean printed medicine (Amoxicillin 500mg capsule)
  const idA = 'scenario-a';
  const evidenceA: ReviewEvidenceReferenceV1 = {
    evidenceSetId: 'a0000000-0000-4000-8000-0000000000e1',
    schemaVersion: '1.0',
    documentSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    fileName: 'prescription-amoxicillin-rx.pdf',
    pageCount: 1,
  };
  const fieldsA: ReviewMedicineFieldsV1 = {
    ...emptyFields(),
    medicineName: 'Amoxicillin',
    brandName: 'Amoxil',
    genericName: 'Amoxicillin Trihydrate',
    strength: { value: '500', unit: 'mg' },
    dosageForm: 'capsule',
    dose: { value: '1', unit: 'capsule' },
    frequency: 'Three times daily',
    timing: 'With meals',
    route: 'oral',
    duration: { value: '7', unit: 'days' },
    quantity: { value: '21', unit: 'capsules' },
    notes: 'Finish full course even if feeling better',
  };
  const draftA = createInitialReviewDraft({
    prescriptionId: idA,
    revisionId: 'a0000000-0000-4000-8000-0000000000r1',
    evidence: evidenceA,
    medicines: [{ medicineId: 'a0000000-0000-4000-8000-0000000000m1', fields: fieldsA }],
  });
  const previewA: DocumentPreviewData = {
    available: true,
    fileType: 'application/pdf',
    fileName: 'prescription-amoxicillin-rx.pdf',
    totalPages: 1,
    coordinatesAvailable: true,
    url: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?auto=format&fit=crop&w=1200&q=80',
    message: 'Rx: Amoxicillin 500mg capsules #21. Sig: 1 cap PO TID x 7 days',
    isDemoMock: true,
  };

  // Scenario B: Three medicines with different instructions
  const idB = 'scenario-b';
  const evidenceB: ReviewEvidenceReferenceV1 = {
    evidenceSetId: 'b0000000-0000-4000-8000-0000000000e1',
    schemaVersion: '1.0',
    fileName: 'triple-therapy-outpatient.pdf',
    pageCount: 2,
  };
  const fieldsB1: ReviewMedicineFieldsV1 = {
    ...emptyFields(),
    medicineName: 'Metformin HCl',
    brandName: 'Glucophage',
    strength: { value: '500', unit: 'mg' },
    dosageForm: 'tablet',
    dose: { value: '1', unit: 'tablet' },
    frequency: 'Twice daily',
    timing: 'With morning and evening meals',
    route: 'oral',
    duration: { value: '30', unit: 'days' },
    quantity: { value: '60', unit: 'tablets' },
  };
  const fieldsB2: ReviewMedicineFieldsV1 = {
    ...emptyFields(),
    medicineName: 'Lisinopril',
    brandName: 'Prinivil',
    strength: { value: '10', unit: 'mg' },
    dosageForm: 'tablet',
    dose: { value: '1', unit: 'tablet' },
    frequency: 'Once daily',
    timing: 'In the morning',
    route: 'oral',
    duration: { value: '30', unit: 'days' },
    quantity: { value: '30', unit: 'tablets' },
  };
  const fieldsB3: ReviewMedicineFieldsV1 = {
    ...emptyFields(),
    medicineName: 'Atorvastatin Calcium',
    brandName: 'Lipitor',
    strength: { value: '20', unit: 'mg' },
    dosageForm: 'tablet',
    dose: { value: '1', unit: 'tablet' },
    frequency: 'Once daily',
    timing: 'At bedtime',
    route: 'oral',
    duration: { value: '90', unit: 'days' },
    quantity: { value: '90', unit: 'tablets' },
  };
  const draftB = createInitialReviewDraft({
    prescriptionId: idB,
    revisionId: 'b0000000-0000-4000-8000-0000000000r1',
    evidence: evidenceB,
    medicines: [
      { medicineId: 'b0000000-0000-4000-8000-0000000000m1', fields: fieldsB1 },
      { medicineId: 'b0000000-0000-4000-8000-0000000000m2', fields: fieldsB2 },
      { medicineId: 'b0000000-0000-4000-8000-0000000000m3', fields: fieldsB3 },
    ],
  });
  const previewB: DocumentPreviewData = {
    available: true,
    fileType: 'application/pdf',
    fileName: 'triple-therapy-outpatient.pdf',
    totalPages: 2,
    coordinatesAvailable: true,
    url: 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?auto=format&fit=crop&w=1200&q=80',
    isDemoMock: true,
  };

  // Scenario C: Five medicines requiring corrections
  const idC = 'scenario-c';
  const evidenceC: ReviewEvidenceReferenceV1 = {
    evidenceSetId: 'c0000000-0000-4000-8000-0000000000e1',
    schemaVersion: '1.0',
    fileName: 'multidrug-clinic-visit.jpg',
    pageCount: 1,
  };
  const medsC: { medicineId: string; fields: ReviewMedicineFieldsV1 }[] = [
    { medicineId: 'c0000000-0000-4000-8000-0000000000m1', fields: { ...emptyFields(), medicineName: 'Levothyroxine', strength: { value: '50', unit: 'mcg' } } },
    { medicineId: 'c0000000-0000-4000-8000-0000000000m2', fields: { ...emptyFields(), medicineName: 'Omeprazole', strength: { value: '20', unit: 'mg' } } },
    { medicineId: 'c0000000-0000-4000-8000-0000000000m3', fields: { ...emptyFields(), medicineName: 'Amlodipine', strength: { value: '5', unit: 'mg' } } },
    { medicineId: 'c0000000-0000-4000-8000-0000000000m4', fields: { ...emptyFields(), medicineName: 'Hydrochlorothiazide', strength: { value: '25', unit: 'mg' } } },
    { medicineId: 'c0000000-0000-4000-8000-0000000000m5', fields: { ...emptyFields(), medicineName: 'Sertraline', strength: { value: '50', unit: 'mg' } } },
  ];
  const draftC = createInitialReviewDraft({
    prescriptionId: idC,
    revisionId: 'c0000000-0000-4000-8000-0000000000r1',
    evidence: evidenceC,
    medicines: medsC,
  });
  const previewC: DocumentPreviewData = {
    available: true,
    fileType: 'image/jpeg',
    fileName: 'multidrug-clinic-visit.jpg',
    totalPages: 1,
    coordinatesAvailable: false,
    url: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?auto=format&fit=crop&w=1200&q=80',
    isDemoMock: true,
  };

  // Scenario D: One medicine with uncertain strength
  const idD = 'scenario-d';
  const evidenceD: ReviewEvidenceReferenceV1 = {
    evidenceSetId: 'd0000000-0000-4000-8000-0000000000e1',
    schemaVersion: '1.0',
    fileName: 'handwritten-azithromycin.png',
    pageCount: 1,
  };
  const fieldsD: ReviewMedicineFieldsV1 = {
    ...emptyFields(),
    medicineName: 'Azithromycin',
    strength: { value: '250', unit: 'mg' },
    dosageForm: 'tablet',
    dose: { value: '2', unit: 'tablets' },
    frequency: 'Once daily',
  };
  const draftD = createInitialReviewDraft({
    prescriptionId: idD,
    revisionId: 'd0000000-0000-4000-8000-0000000000r1',
    evidence: evidenceD,
    medicines: [
      {
        medicineId: 'd0000000-0000-4000-8000-0000000000m1',
        fields: fieldsD,
        provenance: {
          strengthValue: {
            source: 'ocr_observed',
            evidenceReference: evidenceD.evidenceSetId,
            confidenceScore: 0.42,
            isUncertain: true,
            rawText: '250mg (or 500mg?)',
          },
        },
      },
    ],
  });
  const previewD: DocumentPreviewData = {
    available: true,
    fileType: 'image/png',
    fileName: 'handwritten-azithromycin.png',
    totalPages: 1,
    coordinatesAvailable: true,
    url: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?auto=format&fit=crop&w=1200&q=80',
    message: 'Handwritten strength appears ambiguous between 250mg and 500mg.',
    isDemoMock: true,
  };

  // Scenario E: Missing medicine added manually
  const idE = 'scenario-e';
  const evidenceE: ReviewEvidenceReferenceV1 = {
    evidenceSetId: 'e0000000-0000-4000-8000-0000000000e1',
    schemaVersion: '1.0',
    fileName: 'uti-treatment-rx.pdf',
    pageCount: 1,
  };
  const draftEInitial = createInitialReviewDraft({
    prescriptionId: idE,
    revisionId: 'e0000000-0000-4000-8000-0000000000r1',
    evidence: evidenceE,
    medicines: [
      {
        medicineId: 'e0000000-0000-4000-8000-0000000000m1',
        fields: {
          ...emptyFields(),
          medicineName: 'Ciprofloxacin',
          strength: { value: '500', unit: 'mg' },
          dosageForm: 'tablet',
          dose: { value: '1', unit: 'tablet' },
          frequency: 'Twice daily',
        },
      },
    ],
  });
  const draftE = addMedicine(draftEInitial, {
    expectedLockVersion: draftEInitial.lockVersion,
    medicineId: 'e0000000-0000-4000-8000-0000000000m2',
    fields: {
      ...emptyFields(),
      medicineName: 'Phenazopyridine HCl',
      brandName: 'Pyridium',
      strength: { value: '200', unit: 'mg' },
      dosageForm: 'tablet',
      dose: { value: '1', unit: 'tablet' },
      frequency: 'Three times daily',
    },
    commandId: 'cmd-e-add-1',
  });
  const previewE: DocumentPreviewData = {
    available: true,
    fileType: 'application/pdf',
    fileName: 'uti-treatment-rx.pdf',
    totalPages: 1,
    coordinatesAvailable: false,
    isDemoMock: true,
  };

  // Scenario F: Incorrect OCR medicine removed
  const idF = 'scenario-f';
  const evidenceF: ReviewEvidenceReferenceV1 = {
    evidenceSetId: 'f0000000-0000-4000-8000-0000000000e1',
    schemaVersion: '1.0',
    fileName: 'gabapentin-rx-clinic.pdf',
    pageCount: 1,
  };
  const draftFInitial = createInitialReviewDraft({
    prescriptionId: idF,
    revisionId: 'f0000000-0000-4000-8000-0000000000r1',
    evidence: evidenceF,
    medicines: [
      {
        medicineId: 'f0000000-0000-4000-8000-0000000000m1',
        fields: {
          ...emptyFields(),
          medicineName: 'Gabapentin',
          strength: { value: '300', unit: 'mg' },
          dosageForm: 'capsule',
          frequency: 'Three times daily',
        },
      },
      {
        medicineId: 'f0000000-0000-4000-8000-0000000000m2',
        fields: {
          ...emptyFields(),
          medicineName: 'Watermark Artifact Note',
        },
      },
    ],
  });
  const draftF = removeMedicine(draftFInitial, {
    expectedLockVersion: draftFInitial.lockVersion,
    medicineId: 'f0000000-0000-4000-8000-0000000000m2',
  });
  const previewF: DocumentPreviewData = {
    available: true,
    fileType: 'application/pdf',
    fileName: 'gabapentin-rx-clinic.pdf',
    totalPages: 1,
    coordinatesAvailable: false,
    isDemoMock: true,
  };

  // Scenario G: Previously confirmed review reopened at Revision 2
  const idG = 'scenario-g';
  const evidenceG: ReviewEvidenceReferenceV1 = {
    evidenceSetId: 'g0000000-0000-4000-8000-0000000000e1',
    schemaVersion: '1.0',
    fileName: 'rx-prev-confirmed.pdf',
    pageCount: 1,
  };
  const draftGInitial = createInitialReviewDraft({
    prescriptionId: idG,
    revisionId: 'g0000000-0000-4000-8000-0000000000r1',
    evidence: evidenceG,
    medicines: [{ medicineId: 'g0000000-0000-4000-8000-0000000000m1', fields: fieldsA }],
  });
  const confirmedG = confirmReview(draftGInitial, {
    expectedLockVersion: draftGInitial.lockVersion,
    idempotencyKey: 'idemp-g-1',
  });
  const reopenedG = createDraftFromConfirmed(confirmedG, { revisionId: 'g0000000-0000-4000-8000-0000000000r2' });
  const previewG: DocumentPreviewData = { ...previewA, fileName: 'rx-prev-confirmed.pdf', isDemoMock: true };

  // Scenario H: Conflicting revisions
  const idH = 'scenario-h';
  const evidenceH: ReviewEvidenceReferenceV1 = {
    evidenceSetId: 'h0000000-0000-4000-8000-0000000000e1',
    schemaVersion: '1.0',
    fileName: 'concurrent-session.pdf',
    pageCount: 1,
  };
  const draftH = createInitialReviewDraft({
    prescriptionId: idH,
    revisionId: 'h0000000-0000-4000-8000-0000000000r1',
    evidence: evidenceH,
    medicines: [{ medicineId: 'h0000000-0000-4000-8000-0000000000m1', fields: fieldsA }],
  });
  const previewH: DocumentPreviewData = { ...previewA, fileName: 'concurrent-session.pdf', isDemoMock: true };

  // Scenario I: Document preview unavailable
  const idI = 'scenario-i';
  const evidenceI: ReviewEvidenceReferenceV1 = {
    evidenceSetId: 'i0000000-0000-4000-8000-0000000000e1',
    schemaVersion: '1.0',
    fileName: 'archived-storage.pdf',
    pageCount: 0,
  };
  const draftI = createInitialReviewDraft({
    prescriptionId: idI,
    revisionId: 'i0000000-0000-4000-8000-0000000000r1',
    evidence: evidenceI,
    medicines: [{ medicineId: 'i0000000-0000-4000-8000-0000000000m1', fields: fieldsA }],
  });
  const previewI: DocumentPreviewData = {
    available: false,
    totalPages: 0,
    coordinatesAvailable: false,
    message: 'The original prescription document file is temporarily unavailable or storage access is restricted.',
    isDemoMock: true,
  };

  // Scenario J: Partial OCR processing with warnings
  const idJ = 'scenario-j';
  const evidenceJ: ReviewEvidenceReferenceV1 = {
    evidenceSetId: 'j0000000-0000-4000-8000-0000000000e1',
    schemaVersion: '1.0',
    fileName: 'smudged-augmentin-slip.jpg',
    pageCount: 1,
  };
  const draftJ = createInitialReviewDraft({
    prescriptionId: idJ,
    revisionId: 'j0000000-0000-4000-8000-0000000000r1',
    evidence: evidenceJ,
    medicines: [
      {
        medicineId: 'j0000000-0000-4000-8000-0000000000m1',
        fields: {
          ...emptyFields(),
          medicineName: 'Augmentin (partial reading)',
          strength: { value: '625', unit: 'mg' },
          dosageForm: 'tablet',
          dose: { value: '1', unit: 'tablet' },
        },
      },
    ],
  });
  const previewJ: DocumentPreviewData = {
    available: true,
    fileType: 'image/jpeg',
    fileName: 'smudged-augmentin-slip.jpg',
    totalPages: 1,
    coordinatesAvailable: false,
    url: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?auto=format&fit=crop&w=1200&q=80',
    message: 'Augmentin 625 mg tab ... [smudged ink: sig unclear] x 5d',
    isDemoMock: true,
  };

  return {
    [idA]: { review: draftA, revisions: [draftA], preview: previewA, evidence: evidenceA },
    [idB]: { review: draftB, revisions: [draftB], preview: previewB, evidence: evidenceB },
    [idC]: { review: draftC, revisions: [draftC], preview: previewC, evidence: evidenceC },
    [idD]: { review: draftD, revisions: [draftD], preview: previewD, evidence: evidenceD },
    [idE]: { review: draftE, revisions: [draftE], preview: previewE, evidence: evidenceE },
    [idF]: { review: draftF, revisions: [draftF], preview: previewF, evidence: evidenceF },
    [idG]: { review: reopenedG, revisions: [reopenedG, confirmedG], preview: previewG, evidence: evidenceG },
    [idH]: { review: draftH, revisions: [draftH], preview: previewH, evidence: evidenceH },
    [idI]: { review: draftI, revisions: [draftI], preview: previewI, evidence: evidenceI },
    [idJ]: { review: draftJ, revisions: [draftJ], preview: previewJ, evidence: evidenceJ },
  };
}

export class MockPrescriptionReviewAdapter implements PrescriptionReviewAdapter {
  private readonly automaticConflictConsumed = new Set<string>();
  private scenarios: Record<
    string,
    {
      review: PrescriptionReviewContractV1;
      revisions: PrescriptionReviewContractV1[];
      preview: DocumentPreviewData;
      evidence: ReviewEvidenceReferenceV1;
    }
  >;

  constructor() {
    this.scenarios = generateMockScenarios();
  }

  public resetMockData(prescriptionId?: string): void {
    const fresh = generateMockScenarios();
    if (prescriptionId) {
      if (fresh[prescriptionId]) {
        this.scenarios[prescriptionId] = fresh[prescriptionId];
      }
    } else {
      this.scenarios = fresh;
    }
  }

  public simulateConflict(prescriptionId: string): void {
    const item = this.getOrCreate(prescriptionId);
    (item.review as { lockVersion: number }).lockVersion += 1;
  }

  private getOrCreate(prescriptionId: string): {
    review: PrescriptionReviewContractV1;
    revisions: PrescriptionReviewContractV1[];
    preview: DocumentPreviewData;
    evidence: ReviewEvidenceReferenceV1;
  } {
    if (this.scenarios[prescriptionId]) {
      return this.scenarios[prescriptionId];
    }
    const base = this.scenarios['scenario-a'];
    const customReview: PrescriptionReviewContractV1 = {
      ...base.review,
      prescriptionId,
    };
    const customPreview: DocumentPreviewData = {
      ...base.preview,
      isDemoMock: true,
    };
    this.scenarios[prescriptionId] = {
      review: customReview,
      revisions: [customReview],
      preview: customPreview,
      evidence: base.evidence,
    };
    return this.scenarios[prescriptionId];
  }

  public async fetchReview(prescriptionId: string): Promise<PrescriptionReviewContractV1> {
    const item = this.getOrCreate(prescriptionId);
    return JSON.parse(JSON.stringify(item.review));
  }

  public async fetchRevisionHistory(prescriptionId: string): Promise<ReviewRevisionListResponse> {
    const item = this.getOrCreate(prescriptionId);
    return JSON.parse(JSON.stringify({ revisions: item.revisions }));
  }

  public async fetchEvidenceMetadata(prescriptionId: string): Promise<ReviewEvidenceReferenceV1> {
    const item = this.getOrCreate(prescriptionId);
    return JSON.parse(JSON.stringify(item.evidence));
  }

  public async applyDraftOperation(
    prescriptionId: string,
    payload: ApplyDraftPayload
  ): Promise<PrescriptionReviewContractV1> {
    const item = this.getOrCreate(prescriptionId);
    if (prescriptionId === 'scenario-h' && !this.automaticConflictConsumed.has(prescriptionId)) {
      this.automaticConflictConsumed.add(prescriptionId);
      (item.review as { lockVersion: number }).lockVersion += 1;
    }
    const current = item.review;

    if (current.revisionNumber !== payload.expectedRevisionNumber) {
      throw new PrescriptionReviewApiError('Revision number is stale.', 409, 'REVIEW_STALE');
    }
    if (current.lockVersion !== payload.expectedLockVersion) {
      throw new PrescriptionReviewApiError('The review has changed. Refresh and retry.', 409, 'REVIEW_STALE');
    }

    const common = { expectedLockVersion: payload.expectedLockVersion };
    let next: PrescriptionReviewContractV1;

    switch (payload.operation.type) {
      case 'edit_fields':
        next = editMedicineFields(current, {
          ...common,
          medicineId: payload.operation.medicineId,
          updates: payload.operation.updates,
        });
        break;
      case 'add_medicine':
        next = addMedicine(current, {
          ...common,
          medicineId: payload.operation.medicineId,
          commandId: payload.operation.commandId,
          fields: payload.operation.fields,
          position: payload.operation.position,
        });
        break;
      case 'remove_medicine':
        next = removeMedicine(current, {
          ...common,
          medicineId: payload.operation.medicineId,
        });
        break;
      case 'restore_medicine':
        next = restoreMedicine(current, {
          ...common,
          medicineId: payload.operation.medicineId,
        });
        break;
      case 'restore_original':
        next = restoreOriginalMedicineValues(current, {
          ...common,
          medicineId: payload.operation.medicineId,
        });
        break;
      case 'reorder_medicines':
        next = reorderMedicines(current, {
          ...common,
          orderedMedicineIds: payload.operation.orderedMedicineIds,
        });
        break;
      case 'save_draft':
        next = saveReviewDraft(current, common);
        break;
      default:
        throw new PrescriptionReviewApiError('Unsupported review draft operation.', 400, 'INVALID_REVIEW_REQUEST');
    }

    item.review = next;
    // Update current in revisions history
    const existingIdx = item.revisions.findIndex((r) => r.revisionId === next.revisionId);
    if (existingIdx >= 0) {
      item.revisions[existingIdx] = next;
    } else {
      item.revisions.unshift(next);
    }

    return JSON.parse(JSON.stringify(next));
  }

  public async confirmReview(
    prescriptionId: string,
    payload: ConfirmReviewPayload
  ): Promise<ReviewConfirmationResponse> {
    const item = this.getOrCreate(prescriptionId);
    const current = item.review;

    if (current.revisionNumber !== payload.expectedRevisionNumber) {
      throw new PrescriptionReviewApiError('Revision number is stale.', 409, 'REVIEW_STALE');
    }
    if (current.lockVersion !== payload.expectedLockVersion) {
      throw new PrescriptionReviewApiError('The review has changed. Refresh and retry.', 409, 'REVIEW_STALE');
    }

    const next = confirmReview(current, {
      expectedLockVersion: payload.expectedLockVersion,
      idempotencyKey: payload.idempotencyKey,
    });

    item.review = next;
    const existingIdx = item.revisions.findIndex((r) => r.revisionId === next.revisionId);
    if (existingIdx >= 0) {
      item.revisions[existingIdx] = next;
    } else {
      item.revisions.unshift(next);
    }

    const fingerprint = next.canonicalInputFingerprint?.value ?? 'fingerprint-mock';
    const intelligenceRequest = {
      requestKey: `review:${next.revisionId}:${fingerprint}`,
      ownerId: 'mock-owner',
      prescriptionId,
      confirmedRevisionId: next.revisionId,
      inputFingerprint: fingerprint,
      processingJobId: null,
      state: 'pending' as const,
      createdAt: new Date().toISOString(),
    };

    return JSON.parse(JSON.stringify({ review: next, intelligenceRequest }));
  }

  public async reopenReview(
    prescriptionId: string,
    payload: ReopenReviewPayload
  ): Promise<PrescriptionReviewContractV1> {
    const item = this.getOrCreate(prescriptionId);
    const current = item.review;

    if (
      current.revisionNumber !== payload.expectedRevisionNumber ||
      current.lockVersion !== payload.expectedLockVersion
    ) {
      throw new PrescriptionReviewApiError('Revision is stale.', 409, 'REVIEW_STALE');
    }

    const next = createDraftFromConfirmed(current, {
      revisionId: `mock-rev-${current.revisionNumber + 1}-${Date.now().toString(16).slice(-8)}`,
    });

    item.review = next;
    item.revisions.unshift(next);

    return JSON.parse(JSON.stringify(next));
  }

  public async fetchDocumentPreview(prescriptionId: string): Promise<DocumentPreviewData> {
    const item = this.getOrCreate(prescriptionId);
    return JSON.parse(JSON.stringify(item.preview));
  }
}

let defaultMockAdapter: MockPrescriptionReviewAdapter | null = null;

export function getMockPrescriptionReviewAdapter(): MockPrescriptionReviewAdapter {
  if (!defaultMockAdapter) {
    defaultMockAdapter = new MockPrescriptionReviewAdapter();
  }
  return defaultMockAdapter;
}

export function getPrescriptionReviewAdapter(
  prescriptionId: string,
  getAccessToken?: () => string | null
): PrescriptionReviewAdapter {
  if (isFictionalDemoScenario(prescriptionId)) {
    return getMockPrescriptionReviewAdapter();
  }
  return new HttpPrescriptionReviewAdapter(getAccessToken || (() => null));
}
