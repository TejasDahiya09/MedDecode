import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('../../src/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    status: 'authenticated',
    user: { id: 'test-user-id', email: 'test@example.com' },
    getAccessToken: () => 'test-bearer-token',
  }),
}));
import {
  createInitialReviewDraft,
  editMedicineFields,
  addMedicine,
  removeMedicine,
  restoreMedicine,
  restoreOriginalMedicineValues,
  restoreOriginalFieldValue,
  reorderMedicines,
  saveReviewDraft,
  confirmReview,
  createDraftFromConfirmed,
  defaultProvenance,
  deriveMedicineWarnings,
  deriveUnresolvedFields,
} from '../../src/features/prescription-review/review-domain';
import {
  MockPrescriptionReviewAdapter,
  HttpPrescriptionReviewAdapter,
  PrescriptionReviewApiError,
  isPrescriptionReviewFeatureEnabled,
  isFictionalDemoScenario,
} from '../../src/features/prescription-review/prescription-review-api';
import {
  isPrescriptionReviewAvailable,
  getPrescriptionReviewAvailability,
} from '../../src/features/prescription-review/review-availability';
import { ReviewAndEditButton } from '../../src/features/prescription-review/ReviewActionControl';
import { PrescriptionReviewWorkspace } from '../../src/features/prescription-review/PrescriptionReviewWorkspace';
import { PrescriptionDocumentPreview } from '../../src/features/prescription-review/PrescriptionDocumentPreview';
import { ReviewConfirmationModal } from '../../src/features/prescription-review/ReviewConfirmationModal';
import {
  REVIEW_CONTRACT_VERSION,
  REVIEW_CONFIRMATION_STATEMENT,
  REVIEW_CLINICAL_DISCLAIMER,
  type ReviewMedicineFieldsV1,
  type ReviewMedicineEntryV1,
  type PrescriptionReviewContractV1,
} from '../../src/features/prescription-review/types';

function createMockFields(name = 'Amoxicillin'): ReviewMedicineFieldsV1 {
  return {
    medicineName: name,
    brandName: 'Amoxil',
    genericName: 'Amoxicillin',
    strength: { value: '500', unit: 'mg' },
    dosageForm: 'capsule',
    dose: { value: '1', unit: 'capsule' },
    frequency: 'Three times daily',
    timing: 'With water',
    route: 'oral',
    duration: { value: '7', unit: 'days' },
    quantity: { value: '21', unit: 'capsules' },
    notes: 'Finish full course',
  };
}

describe('Prescription Review - Domain Logic & Mutations', () => {
  it('creates initial review draft with immutable baseline copies', () => {
    const draft = createInitialReviewDraft({
      prescriptionId: '00000000-0000-4000-8000-000000000123',
      revisionId: '00000000-0000-4000-8000-0000000000r1',
      evidence: {
        evidenceSetId: '00000000-0000-4000-8000-0000000000e1',
        schemaVersion: '1.0',
        fileName: 'rx.pdf',
        pageCount: 1,
      },
      medicines: [
        { medicineId: '00000000-0000-4000-8000-0000000000m1', fields: createMockFields('Amoxicillin') },
        { medicineId: '00000000-0000-4000-8000-0000000000m2', fields: createMockFields('Ibuprofen') },
      ],
    });

    expect(draft.schemaVersion).toBe(REVIEW_CONTRACT_VERSION);
    expect(draft.prescriptionId).toBe('00000000-0000-4000-8000-000000000123');
    expect(draft.status).toBe('draft');
    expect(draft.revisionNumber).toBe(1);
    expect(draft.lockVersion).toBe(0);
    expect(draft.medicines).toHaveLength(2);
    expect(draft.medicines[0].original).toBeDefined();
    expect(draft.medicines[0].original?.medicineName).toBe('Amoxicillin');
    expect(draft.medicines[0].current.medicineName).toBe('Amoxicillin');
  });

  it('updates structured fields preserving unset fields without fabricating defaults', () => {
    const draft = createInitialReviewDraft({
      prescriptionId: '00000000-0000-4000-8000-000000000123',
      revisionId: '00000000-0000-4000-8000-0000000000r1',
      evidence: { evidenceSetId: '00000000-0000-4000-8000-0000000000e1', schemaVersion: '1.0' },
      medicines: [{ medicineId: '00000000-0000-4000-8000-0000000000m1', fields: createMockFields('Amoxicillin') }],
    });

    const updated = editMedicineFields(draft, {
      expectedLockVersion: 0,
      medicineId: '00000000-0000-4000-8000-0000000000m1',
      updates: {
        strengthValue: '875',
        notes: 'Take with food',
      },
    });

    const target = updated.medicines.find((m) => m.medicineId === '00000000-0000-4000-8000-0000000000m1');
    expect(target?.current.strength.value).toBe('875');
    expect(target?.current.notes).toBe('Take with food');
    expect(target?.current.medicineName).toBe('Amoxicillin'); // Unmodified
    expect(updated.lockVersion).toBe(1);
  });

  it('adds a new medicine manually with user_added origin', () => {
    const draft = createInitialReviewDraft({
      prescriptionId: '00000000-0000-4000-8000-000000000123',
      revisionId: '00000000-0000-4000-8000-0000000000r1',
      evidence: { evidenceSetId: '00000000-0000-4000-8000-0000000000e1', schemaVersion: '1.0' },
      medicines: [{ medicineId: '00000000-0000-4000-8000-0000000000m1', fields: createMockFields('Amoxicillin') }],
    });

    const updated = addMedicine(draft, {
      expectedLockVersion: 0,
      medicineId: '00000000-0000-4000-8000-0000000000m2',
      fields: {
        ...createMockFields('Omeprazole'),
        strength: { value: '20', unit: 'mg' },
      },
    });

    expect(updated.medicines).toHaveLength(2);
    const added = updated.medicines.find((m) => m.medicineId === '00000000-0000-4000-8000-0000000000m2');
    expect(added?.origin).toBe('user_added');
    expect(added?.position).toBe(2);
    expect(added?.current.medicineName).toBe('Omeprazole');
    expect(added?.original).toBeNull();
  });

  it('soft-deletes medicine by marking status removed', () => {
    const draft = createInitialReviewDraft({
      prescriptionId: '00000000-0000-4000-8000-000000000123',
      revisionId: '00000000-0000-4000-8000-0000000000r1',
      evidence: { evidenceSetId: '00000000-0000-4000-8000-0000000000e1', schemaVersion: '1.0' },
      medicines: [
        { medicineId: '00000000-0000-4000-8000-0000000000m1', fields: createMockFields('Amoxicillin') },
        { medicineId: '00000000-0000-4000-8000-0000000000m2', fields: createMockFields('Watermark Note') },
      ],
    });

    const updated = removeMedicine(draft, {
      expectedLockVersion: 0,
      medicineId: '00000000-0000-4000-8000-0000000000m2',
    });

    const target = updated.medicines.find((m) => m.medicineId === '00000000-0000-4000-8000-0000000000m2');
    expect(target?.status).toBe('removed');
    expect(target?.removedAt).toBeDefined();
  });

  it('restores a previously removed medicine', () => {
    const draft = createInitialReviewDraft({
      prescriptionId: '00000000-0000-4000-8000-000000000123',
      revisionId: '00000000-0000-4000-8000-0000000000r1',
      evidence: { evidenceSetId: '00000000-0000-4000-8000-0000000000e1', schemaVersion: '1.0' },
      medicines: [{ medicineId: '00000000-0000-4000-8000-0000000000m1', fields: createMockFields('Amoxicillin') }],
    });

    const removed = removeMedicine(draft, {
      expectedLockVersion: 0,
      medicineId: '00000000-0000-4000-8000-0000000000m1',
    });
    const restored = restoreMedicine(removed, {
      expectedLockVersion: removed.lockVersion,
      medicineId: '00000000-0000-4000-8000-0000000000m1',
    });

    const target = restored.medicines.find((m) => m.medicineId === '00000000-0000-4000-8000-0000000000m1');
    expect(target?.status).toBe('active');
    expect(target?.removedAt).toBeNull();
  });

  it('restores all original values for an edited medicine', () => {
    const draft = createInitialReviewDraft({
      prescriptionId: '00000000-0000-4000-8000-000000000123',
      revisionId: '00000000-0000-4000-8000-0000000000r1',
      evidence: { evidenceSetId: '00000000-0000-4000-8000-0000000000e1', schemaVersion: '1.0' },
      medicines: [{ medicineId: '00000000-0000-4000-8000-0000000000m1', fields: createMockFields('Amoxicillin') }],
    });

    const edited = editMedicineFields(draft, {
      expectedLockVersion: 0,
      medicineId: '00000000-0000-4000-8000-0000000000m1',
      updates: {
        medicineName: 'Wrong Name',
        strengthValue: '999',
      },
    });

    const restored = restoreOriginalMedicineValues(edited, {
      expectedLockVersion: edited.lockVersion,
      medicineId: '00000000-0000-4000-8000-0000000000m1',
    });
    const target = restored.medicines.find((m) => m.medicineId === '00000000-0000-4000-8000-0000000000m1');
    expect(target?.current.medicineName).toBe('Amoxicillin');
    expect(target?.current.strength.value).toBe('500');
  });

  it('restores a single original field without reverting other modifications', () => {
    const draft = createInitialReviewDraft({
      prescriptionId: '00000000-0000-4000-8000-000000000123',
      revisionId: '00000000-0000-4000-8000-0000000000r1',
      evidence: { evidenceSetId: '00000000-0000-4000-8000-0000000000e1', schemaVersion: '1.0' },
      medicines: [{ medicineId: '00000000-0000-4000-8000-0000000000m1', fields: createMockFields('Amoxicillin') }],
    });

    const edited = editMedicineFields(draft, {
      expectedLockVersion: 0,
      medicineId: '00000000-0000-4000-8000-0000000000m1',
      updates: {
        medicineName: 'Amoxicillin Trihydrate',
        notes: 'New note',
      },
    });

    const restored = restoreOriginalFieldValue(edited, {
      expectedLockVersion: edited.lockVersion,
      medicineId: '00000000-0000-4000-8000-0000000000m1',
      field: 'medicineName',
    });

    const target = restored.medicines.find((m) => m.medicineId === '00000000-0000-4000-8000-0000000000m1');
    expect(target?.current.medicineName).toBe('Amoxicillin'); // Reverted
    expect(target?.current.notes).toBe('New note'); // Preserved
  });

  it('reorders medicines properly updating position sequential indices', () => {
    const draft = createInitialReviewDraft({
      prescriptionId: '00000000-0000-4000-8000-000000000123',
      revisionId: '00000000-0000-4000-8000-0000000000r1',
      evidence: { evidenceSetId: '00000000-0000-4000-8000-0000000000e1', schemaVersion: '1.0' },
      medicines: [
        { medicineId: '00000000-0000-4000-8000-0000000000m1', fields: createMockFields('Amoxicillin') },
        { medicineId: '00000000-0000-4000-8000-0000000000m2', fields: createMockFields('Ibuprofen') },
      ],
    });

    const reordered = reorderMedicines(draft, {
      expectedLockVersion: 0,
      orderedMedicineIds: ['00000000-0000-4000-8000-0000000000m2', '00000000-0000-4000-8000-0000000000m1'],
    });

    expect(reordered.medicines[0].medicineId).toBe('00000000-0000-4000-8000-0000000000m2');
    expect(reordered.medicines[0].position).toBe(1);
    expect(reordered.medicines[1].medicineId).toBe('00000000-0000-4000-8000-0000000000m1');
    expect(reordered.medicines[1].position).toBe(2);
  });

  it('enforces optimistic concurrency locking on save draft', () => {
    const draft = createInitialReviewDraft({
      prescriptionId: '00000000-0000-4000-8000-000000000123',
      revisionId: '00000000-0000-4000-8000-0000000000r1',
      evidence: { evidenceSetId: '00000000-0000-4000-8000-0000000000e1', schemaVersion: '1.0' },
      medicines: [{ medicineId: '00000000-0000-4000-8000-0000000000m1', fields: createMockFields('Amoxicillin') }],
    });

    // Save with correct lock version
    const saved = saveReviewDraft(draft, { expectedLockVersion: 0 });
    expect(saved.lockVersion).toBe(0);

    // Attempt mutation with stale lock version
    expect(() =>
      editMedicineFields(saved, {
        expectedLockVersion: 99, // Stale!
        medicineId: '00000000-0000-4000-8000-0000000000m1',
        updates: { notes: 'hello' },
      })
    ).toThrow('The review was updated by another session');
  });

  it('confirms review updating confirmation block and status', () => {
    const draft = createInitialReviewDraft({
      prescriptionId: '00000000-0000-4000-8000-000000000123',
      revisionId: '00000000-0000-4000-8000-0000000000r1',
      evidence: { evidenceSetId: '00000000-0000-4000-8000-0000000000e1', schemaVersion: '1.0' },
      medicines: [{ medicineId: '00000000-0000-4000-8000-0000000000m1', fields: createMockFields('Amoxicillin') }],
    });

    const confirmed = confirmReview(draft, {
      expectedLockVersion: 0,
      idempotencyKey: 'idemp-1',
    });

    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.confirmation.status).toBe('confirmed');
    expect(confirmed.confirmation.confirmedAt).toBeDefined();
    expect(confirmed.confirmation.idempotencyKey).toBe('idemp-1');
  });

  it('cannot confirm a review if all medicines are removed', () => {
    const draft = createInitialReviewDraft({
      prescriptionId: '00000000-0000-4000-8000-000000000123',
      revisionId: '00000000-0000-4000-8000-0000000000r1',
      evidence: { evidenceSetId: '00000000-0000-4000-8000-0000000000e1', schemaVersion: '1.0' },
      medicines: [{ medicineId: '00000000-0000-4000-8000-0000000000m1', fields: createMockFields('Amoxicillin') }],
    });

    const removed = removeMedicine(draft, {
      expectedLockVersion: 0,
      medicineId: '00000000-0000-4000-8000-0000000000m1',
    });

    expect(() =>
      confirmReview(removed, {
        expectedLockVersion: removed.lockVersion,
        idempotencyKey: 'idemp-2',
      })
    ).toThrow('At least one active medicine is required for confirmation');
  });

  it('reopens confirmed review creating Revision 2 draft referencing superseded revision', () => {
    const draft = createInitialReviewDraft({
      prescriptionId: '00000000-0000-4000-8000-000000000123',
      revisionId: '00000000-0000-4000-8000-0000000000r1',
      evidence: { evidenceSetId: '00000000-0000-4000-8000-0000000000e1', schemaVersion: '1.0' },
      medicines: [{ medicineId: '00000000-0000-4000-8000-0000000000m1', fields: createMockFields('Amoxicillin') }],
    });

    const confirmed = confirmReview(draft, {
      expectedLockVersion: 0,
      idempotencyKey: 'idemp-1',
    });

    const reopened = createDraftFromConfirmed(confirmed, { revisionId: '00000000-0000-4000-8000-0000000000r2' });
    expect(reopened.revisionNumber).toBe(2);
    expect(reopened.status).toBe('draft');
    expect(reopened.baseRevisionId).toBe('00000000-0000-4000-8000-0000000000r1');
    expect(reopened.lockVersion).toBe(0);
  });

  it('derives clinical review warnings for uncertain medicines and missing fields', () => {
    const draft = createInitialReviewDraft({
      prescriptionId: '00000000-0000-4000-8000-000000000123',
      revisionId: '00000000-0000-4000-8000-0000000000r1',
      evidence: { evidenceSetId: '00000000-0000-4000-8000-0000000000e1', schemaVersion: '1.0' },
      medicines: [
        {
          medicineId: '00000000-0000-4000-8000-0000000000m1',
          fields: {
            ...createMockFields(''),
            medicineName: null, // missing name
          },
        },
      ],
    });

    const target = draft.medicines[0];
    const warnings = deriveMedicineWarnings(target);
    expect(warnings.length).toBeGreaterThan(0);
    const missingNameWarn = warnings.find((w) => w.code === 'MISSING_MEDICINE_NAME');
    expect(missingNameWarn).toBeDefined();

    const unresolved = deriveUnresolvedFields(draft.medicines);
    expect(unresolved.length).toBeGreaterThan(0);
  });
});

describe('Prescription Review - Mock Adapter Scenarios (A through J)', () => {
  let adapter: MockPrescriptionReviewAdapter;

  beforeEach(() => {
    adapter = new MockPrescriptionReviewAdapter();
  });

  it('Scenario A: loads one clean printed medicine with document preview', async () => {
    const review = await adapter.fetchReview('scenario-a');
    const preview = await adapter.fetchDocumentPreview('scenario-a');

    expect(review.medicines).toHaveLength(1);
    expect(review.medicines[0].current.medicineName).toBe('Amoxicillin');
    expect(review.medicines[0].current.strength.value).toBe('500');
    expect(preview.available).toBe(true);
    expect(preview.fileName).toContain('prescription-amoxicillin');
  });

  it('Scenario B: loads three medicines with distinct instructions', async () => {
    const review = await adapter.fetchReview('scenario-b');
    expect(review.medicines).toHaveLength(3);
    const names = review.medicines.map((m) => m.current.medicineName);
    expect(names).toContain('Metformin HCl');
    expect(names).toContain('Lisinopril');
    expect(names).toContain('Atorvastatin Calcium');
  });

  it('Scenario C: loads five medicines requiring corrections', async () => {
    const review = await adapter.fetchReview('scenario-c');
    expect(review.medicines).toHaveLength(5);
  });

  it('Scenario D: loads medicine with uncertain strength (confidence 0.42)', async () => {
    const review = await adapter.fetchReview('scenario-d');
    expect(review.medicines).toHaveLength(1);
    expect(review.medicines[0].provenance.strengthValue.confidenceScore).toBe(0.42);
    expect(review.medicines[0].provenance.strengthValue.isUncertain).toBe(true);
  });

  it('Scenario E: loads user-added medicine with audit trail', async () => {
    const review = await adapter.fetchReview('scenario-e');
    expect(review.medicines).toHaveLength(2);
    const userMed = review.medicines.find((m) => m.origin === 'user_added');
    expect(userMed).toBeDefined();
    expect(userMed?.current.medicineName).toBe('Phenazopyridine HCl');
    expect(userMed?.addedByCommandId).toBe('cmd-e-add-1');
  });

  it('Scenario F: loads soft-deleted OCR watermark artifact', async () => {
    const review = await adapter.fetchReview('scenario-f');
    expect(review.medicines).toHaveLength(2);
    const removedMed = review.medicines.find((m) => m.status === 'removed');
    expect(removedMed).toBeDefined();
    expect(removedMed?.current.medicineName).toContain('Watermark Artifact');
  });

  it('Scenario G: loads reopened confirmed review at Revision 2', async () => {
    const review = await adapter.fetchReview('scenario-g');
    expect(review.revisionNumber).toBe(2);
    expect(review.status).toBe('draft');
    expect(review.baseRevisionId).toBe('g0000000-0000-4000-8000-0000000000r1');
  });

  it('Scenario H: handles simulated concurrency conflict', async () => {
    const review = await adapter.fetchReview('scenario-h');
    adapter.simulateConflict('scenario-h');

    await expect(
      adapter.applyDraftOperation('scenario-h', {
        expectedRevisionNumber: review.revisionNumber,
        expectedLockVersion: review.lockVersion, // Stale!
        operation: { type: 'save_draft' },
      })
    ).rejects.toThrow();
  });

  it('Scenario I: handles document preview unavailable with honest reason', async () => {
    const preview = await adapter.fetchDocumentPreview('scenario-i');
    expect(preview.available).toBe(false);
    expect(preview.message).toBeDefined();
  });

  it('Scenario J: loads partial OCR processing with smudged warnings', async () => {
    const review = await adapter.fetchReview('scenario-j');
    expect(review.medicines).toHaveLength(1);
    expect(review.medicines[0].current.medicineName).toContain('Augmentin (partial reading)');
  });
});

describe('Prescription Review - Real HttpPrescriptionReviewAdapter & Contract Alignment', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.meddecode.test/base');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  it('rejects unauthenticated requests before dispatching network call', async () => {
    const adapter = new HttpPrescriptionReviewAdapter(() => null);
    await expect(adapter.fetchReview('00000000-0000-4000-8000-000000000123')).rejects.toMatchObject({
      name: 'PrescriptionReviewApiError',
      status: 401,
      code: 'UNAUTHORIZED',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('dispatches GET /api/v1/prescriptions/:id/review with Bearer token', async () => {
    const adapter = new HttpPrescriptionReviewAdapter(() => 'valid-bearer-token');
    const mockReview: Partial<PrescriptionReviewContractV1> = {
      schemaVersion: '1.0',
      prescriptionId: '00000000-0000-4000-8000-000000000123',
      revisionNumber: 1,
      lockVersion: 0,
      status: 'draft',
      medicines: [],
    };

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(mockReview), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const result = await adapter.fetchReview('00000000-0000-4000-8000-000000000123');
    expect(result.prescriptionId).toBe('00000000-0000-4000-8000-000000000123');

    const call = fetchMock.mock.calls[0];
    expect(String(call[0])).toBe('https://api.meddecode.test/base/api/v1/prescriptions/00000000-0000-4000-8000-000000000123/review');
    const headers = call[1]?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer valid-bearer-token');
    expect(call[1]?.method).toBe('GET');
  });

  it('dispatches PATCH /api/v1/prescriptions/:id/review/draft matching exact contract payload', async () => {
    const adapter = new HttpPrescriptionReviewAdapter(() => 'valid-bearer-token');
    const mockUpdatedReview: Partial<PrescriptionReviewContractV1> = {
      schemaVersion: '1.0',
      prescriptionId: '00000000-0000-4000-8000-000000000123',
      revisionNumber: 1,
      lockVersion: 1,
      status: 'draft',
    };

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(mockUpdatedReview), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const result = await adapter.applyDraftOperation('00000000-0000-4000-8000-000000000123', {
      expectedRevisionNumber: 1,
      expectedLockVersion: 0,
      operation: {
        type: 'edit_fields',
        medicineId: '00000000-0000-4000-8000-0000000000m1',
        updates: { medicineName: 'Amoxicillin Trihydrate' },
      },
    });

    expect(result.lockVersion).toBe(1);

    const call = fetchMock.mock.calls[0];
    expect(call[1]?.method).toBe('PATCH');
    const body = JSON.parse(String(call[1]?.body));
    expect(body).toEqual({
      expectedRevisionNumber: 1,
      expectedLockVersion: 0,
      operation: {
        type: 'edit_fields',
        medicineId: '00000000-0000-4000-8000-0000000000m1',
        updates: { medicineName: 'Amoxicillin Trihydrate' },
      },
    });
  });

  it('dispatches POST /api/v1/prescriptions/:id/review/confirm with idempotency key', async () => {
    const adapter = new HttpPrescriptionReviewAdapter(() => 'valid-bearer-token');
    const mockConfirmResponse = {
      review: {
        schemaVersion: '1.0',
        prescriptionId: '00000000-0000-4000-8000-000000000123',
        revisionNumber: 1,
        lockVersion: 1,
        status: 'confirmed',
      },
      intelligenceRequest: {
        requestKey: 'review:rev-1:fingerprint-abc',
        state: 'pending',
      },
    };

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(mockConfirmResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const result = await adapter.confirmReview('00000000-0000-4000-8000-000000000123', {
      expectedRevisionNumber: 1,
      expectedLockVersion: 0,
      idempotencyKey: 'idemp-confirm-12345',
    });

    expect(result.review.status).toBe('confirmed');
    expect(result.intelligenceRequest?.state).toBe('pending');

    const call = fetchMock.mock.calls[0];
    expect(call[1]?.method).toBe('POST');
    const body = JSON.parse(String(call[1]?.body));
    expect(body).toEqual({
      expectedRevisionNumber: 1,
      expectedLockVersion: 0,
      idempotencyKey: 'idemp-confirm-12345',
    });
  });

  it('maps backend 409 REVIEW_STALE to typed PrescriptionReviewApiError', async () => {
    const adapter = new HttpPrescriptionReviewAdapter(() => 'valid-bearer-token');
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: 'REVIEW_STALE',
            message: 'The review has changed. Refresh and retry.',
          },
        }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const failure = adapter.applyDraftOperation('00000000-0000-4000-8000-000000000123', {
      expectedRevisionNumber: 1,
      expectedLockVersion: 0,
      operation: { type: 'save_draft' },
    });

    await expect(failure).rejects.toBeInstanceOf(PrescriptionReviewApiError);
    await expect(failure).rejects.toMatchObject({
      name: 'PrescriptionReviewApiError',
      status: 409,
      code: 'REVIEW_STALE',
      message: 'The review has changed. Refresh and retry.',
    });
  });

  it('returns unavailable preview status in real mode (Phase 1B.2 backend blocker)', async () => {
    const adapter = new HttpPrescriptionReviewAdapter(() => 'valid-bearer-token');
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          evidenceSetId: '00000000-0000-4000-8000-0000000000e1',
          schemaVersion: '1.0',
          fileName: 'rx-real-scan.pdf',
          pageCount: 2,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const preview = await adapter.fetchDocumentPreview('00000000-0000-4000-8000-000000000123');
    expect(preview.available).toBe(false);
    expect(preview.fileName).toBe('rx-real-scan.pdf');
    expect(preview.totalPages).toBe(2);
    expect(preview.message).toContain('Phase 1B.2 backend blocker');
    expect(preview.isDemoMock).toBe(false);
  });

  it('cancels pending requests when AbortSignal triggers', async () => {
    const adapter = new HttpPrescriptionReviewAdapter(() => 'valid-bearer-token');
    const controller = new AbortController();

    fetchMock.mockImplementationOnce((_url, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The user aborted a request.', 'AbortError'));
        });
      });
    });

    const promise = adapter.fetchReview('00000000-0000-4000-8000-000000000123', controller.signal);
    controller.abort();

    await expect(promise).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('fetches document blob with Bearer token and creates local object URL', async () => {
    const adapter = new HttpPrescriptionReviewAdapter(() => 'valid-bearer-token');
    const mockBlob = new Blob(['%PDF-1.4 synthetic pdf content'], { type: 'application/pdf' });

    // Mock URL.createObjectURL
    const createObjectURLMock = vi.fn(() => 'blob:http://localhost:5174/mock-uuid-123');
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = createObjectURLMock;
    URL.revokeObjectURL = vi.fn();

    fetchMock.mockResolvedValueOnce(
      new Response(mockBlob, {
        status: 200,
        headers: { 'Content-Type': 'application/pdf' },
      })
    );

    const result = await adapter.fetchDocumentBlob('00000000-0000-4000-8000-000000000123');

    expect(result.kind).toBe('authorized_blob');
    expect(result.available).toBe(true);
    expect(result.url).toBe('blob:http://localhost:5174/mock-uuid-123');
    expect(result.fileType).toBe('application/pdf');
    expect(result.revokeOnUnmount).toBe(true);
    expect(createObjectURLMock).toHaveBeenCalledWith(mockBlob);

    const call = fetchMock.mock.calls[0];
    expect(call[1]?.headers).toMatchObject({
      Authorization: 'Bearer valid-bearer-token',
    });

    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it('returns honest unavailable preview source when document stream returns 404/503', async () => {
    const adapter = new HttpPrescriptionReviewAdapter(() => 'valid-bearer-token');
    fetchMock.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));

    const result = await adapter.fetchDocumentBlob('00000000-0000-4000-8000-000000000123');
    expect(result.kind).toBe('unavailable');
    expect(result.available).toBe(false);
    expect(result.message).toContain('HTTP 404');
  });
});

describe('Prescription Review - Feature Flag Hardening', () => {
  it('correctly identifies fictional demo scenario IDs', () => {
    expect(isFictionalDemoScenario('scenario-a')).toBe(true);
    expect(isFictionalDemoScenario('scenario-j')).toBe(true);
    expect(isFictionalDemoScenario('00000000-0000-4000-8000-000000000123')).toBe(false);
  });

  it('enforces feature flag disabled by default in test/production environment', () => {
    vi.stubEnv('VITE_PRESCRIPTION_REVIEW_ENABLED', '');
    expect(isPrescriptionReviewFeatureEnabled()).toBe(false);

    vi.stubEnv('VITE_PRESCRIPTION_REVIEW_ENABLED', 'false');
    expect(isPrescriptionReviewFeatureEnabled()).toBe(false);

    vi.stubEnv('VITE_PRESCRIPTION_REVIEW_ENABLED', 'true');
    expect(isPrescriptionReviewFeatureEnabled()).toBe(true);
  });
});

describe('Prescription Review - UI Components', () => {
  it('renders document preview controls and handles honest fallback', () => {
    const { rerender } = render(
      <PrescriptionDocumentPreview
        preview={{
          available: false,
          totalPages: 0,
          coordinatesAvailable: false,
          message: 'File storage unavailable',
        }}
      />
    );

    expect(screen.getByText('Document Preview Unavailable')).toBeDefined();
    expect(screen.getByText('File storage unavailable')).toBeDefined();

    // Rerender with available preview
    rerender(
      <PrescriptionDocumentPreview
        preview={{
          available: true,
          fileType: 'application/pdf',
          fileName: 'rx-doc.pdf',
          totalPages: 2,
          coordinatesAvailable: true,
          url: 'https://example.com/test.jpg',
          isDemoMock: true,
        }}
      />
    );

    expect(screen.getByText('rx-doc.pdf')).toBeDefined();
    expect(screen.getByText('DEMO SAMPLE')).toBeDefined();
    expect(screen.getByText('Page 1 of 2')).toBeDefined();
    expect(screen.getByLabelText('Zoom in')).toBeDefined();
    expect(screen.getByLabelText('Zoom out')).toBeDefined();
    expect(screen.getByLabelText('Rotate document 90 degrees')).toBeDefined();
  });

  it('renders confirmation modal with exact statement and disclaimer', async () => {
    const mockMedicines: ReviewMedicineEntryV1[] = [
      {
        medicineId: '00000000-0000-4000-8000-0000000000m1',
        origin: 'extracted',
        status: 'active',
        position: 1,
        original: createMockFields('Amoxicillin'),
        current: createMockFields('Amoxicillin'),
        provenance: defaultProvenance(createMockFields('Amoxicillin'), 'ocr_observed'),
        addedByCommandId: null,
        removedAt: null,
      },
    ];

    let confirmedNotes: string | undefined = undefined;
    const onConfirm = (notes?: string) => {
      confirmedNotes = notes;
    };

    render(
      <ReviewConfirmationModal
        isOpen={true}
        medicines={mockMedicines}
        onConfirm={onConfirm}
        onClose={() => {}}
      />
    );

    // Exact Clinical Disclaimer check
    expect(screen.getByText(REVIEW_CLINICAL_DISCLAIMER)).toBeDefined();

    // Exact Confirmation Statement check
    const checkbox = screen.getByLabelText('Confirmation statement checkbox') as HTMLInputElement;
    expect(screen.getByText(REVIEW_CONFIRMATION_STATEMENT)).toBeDefined();

    const confirmBtn = screen.getByRole('button', { name: 'Confirm Review' }) as HTMLButtonElement;
    // Disabled before acknowledging
    expect(confirmBtn.disabled).toBe(true);

    // Check statement checkbox
    fireEvent.click(checkbox);
    expect(confirmBtn.disabled).toBe(false);

    expect(screen.getByText(/Separate review-level notes are not supported/)).toBeDefined();

    fireEvent.click(confirmBtn);
    expect(confirmedNotes).toBeUndefined();
  });

  it('renders full workspace for Scenario A and allows editing fields', async () => {
    render(
      <MemoryRouter initialEntries={['/prescriptions/scenario-a/review?mock=true&review=true']}>
        <Routes>
          <Route path="/prescriptions/:id/review" element={<PrescriptionReviewWorkspace />} />
        </Routes>
      </MemoryRouter>
    );

    // Wait for scenario to load
    await waitFor(() => {
      expect(screen.getByText('Review & Edit Prescription')).toBeDefined();
    });

    // Check presence of demo mode alert bar
    expect(screen.getByText(/DEVELOPMENT DEMO MODE/i)).toBeDefined();

    // Check presence of Amoxicillin
    expect(screen.getByDisplayValue('Amoxicillin')).toBeDefined();

    // Edit strength value
    const strengthInput = screen.getByLabelText('Strength value');
    fireEvent.change(strengthInput, { target: { value: '875' } });

    // Assert unsaved changes indicator appears
    expect(screen.getByText(/You have unsaved changes in this review draft/i)).toBeDefined();

    // Check OCR diff indicator displays original value
    expect(screen.getByText('500 mg')).toBeDefined();
  });

  describe('Phase 1C.3: Secure Preview, Staleness & Accessibility', () => {
    it('renders PDF iframe with accessible title and sandbox for PDF documents', () => {
      render(
        <PrescriptionDocumentPreview
          preview={{
            kind: 'authorized_blob',
            available: true,
            url: 'blob:http://localhost:5174/sample-pdf',
            fileType: 'application/pdf',
            fileName: 'prescription-scan.pdf',
            totalPages: 1,
            coordinatesAvailable: false,
          }}
        />
      );

      const iframe = screen.getByTitle('Prescription document PDF preview for prescription-scan.pdf');
      expect(iframe).toBeDefined();
      expect(iframe.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
    });

    it('blocks untrusted URL origins and displays security warning', () => {
      render(
        <PrescriptionDocumentPreview
          preview={{
            kind: 'unavailable',
            available: true,
            url: 'https://evil-untrusted-domain.test/exploit.png',
            fileType: 'image/png',
            fileName: 'untrusted.png',
            totalPages: 1,
            coordinatesAvailable: false,
          }}
        />
      );

      expect(
        screen.getByText('The document preview URL is invalid or uses an untrusted origin.')
      ).toBeDefined();
    });

    it('validates coordinate bounds and ignores invalid or out-of-bounds coordinates', () => {
      render(
        <PrescriptionDocumentPreview
          preview={{
            kind: 'fictional_demo',
            available: true,
            url: 'data:image/svg+xml;utf8,<svg></svg>',
            fileType: 'image/png',
            fileName: 'sample.png',
            totalPages: 1,
            coordinatesAvailable: true,
          }}
          activeHighlight={{
            x: -10, // Invalid negative coordinate
            y: 150, // Invalid > 100%
            width: 20,
            height: 10,
            pageNumber: 1,
          }}
          activeMedicineName="Invalid Medicine"
        />
      );

      // Does not render invented highlight box
      expect(screen.queryByLabelText(/Source OCR region for Invalid Medicine/i)).toBeNull();
      // Displays coordinate notice
      expect(
        screen.getByText(/Source OCR bounding box coordinates unavailable/i)
      ).toBeDefined();
    });

    it('closes confirmation modal when Escape key is pressed', () => {
      let closed = false;
      const mockFields = createMockFields('Metformin');
      render(
        <ReviewConfirmationModal
          isOpen={true}
          medicines={[
            {
              medicineId: '00000000-0000-4000-8000-000000000001',
              origin: 'extracted',
              status: 'active',
              position: 1,
              original: mockFields,
              current: mockFields,
              provenance: defaultProvenance(mockFields, 'ocr_observed'),
              addedByCommandId: null,
              removedAt: null,
            },
          ]}
          onConfirm={() => {}}
          onClose={() => {
            closed = true;
          }}
        />
      );

      const dialog = screen.getByRole('dialog');
      fireEvent.keyDown(dialog, { key: 'Escape' });
      expect(closed).toBe(true);
    });

    it('renders superseded draft notice when reviewing a reopened Revision 2 draft', async () => {
      render(
        <MemoryRouter initialEntries={['/prescriptions/scenario-g/review?mock=true&review=true']}>
          <Routes>
            <Route path="/prescriptions/:id/review" element={<PrescriptionReviewWorkspace />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText(/You are editing a reopened prescription/i)).toBeDefined();
      });

      expect(
        screen.getByText(/Earlier intelligence insights for Revision 1 are superseded/i)
      ).toBeDefined();
    });

    it('derives correct review availability and prevents active link when disabled', () => {
      vi.stubEnv('VITE_PRESCRIPTION_REVIEW_ENABLED', 'false');

      // Real prescription when flag disabled
      expect(isPrescriptionReviewAvailable('00000000-0000-4000-8000-000000000123')).toBe(false);
      const meta = getPrescriptionReviewAvailability('00000000-0000-4000-8000-000000000123');
      expect(meta.isAvailable).toBe(false);
      expect(meta.badgeText).toBe('Pending V3');

      // Fictional demo scenario
      expect(isPrescriptionReviewAvailable('scenario-a')).toBe(true);
      const demoMeta = getPrescriptionReviewAvailability('scenario-a');
      expect(demoMeta.isAvailable).toBe(true);
      expect(demoMeta.isDemo).toBe(true);
    });

    it('renders disabled button with Pending V3 badge when review feature is unavailable', () => {
      vi.stubEnv('VITE_PRESCRIPTION_REVIEW_ENABLED', 'false');

      render(
        <MemoryRouter>
          <ReviewAndEditButton prescriptionId="00000000-0000-4000-8000-000000000123" />
        </MemoryRouter>
      );

      const button = screen.getByRole('button', { name: /Review & Edit/i }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      expect(button.getAttribute('aria-disabled')).toBe('true');
      expect(screen.getByText('V3 disabled')).toBeDefined();
      expect(screen.queryByRole('link', { name: /Review & Edit/i })).toBeNull();
    });

    it('renders active Link to review workspace when review feature is available', () => {
      vi.stubEnv('VITE_PRESCRIPTION_REVIEW_ENABLED', 'true');

      render(
        <MemoryRouter>
          <ReviewAndEditButton prescriptionId="00000000-0000-4000-8000-000000000123" />
        </MemoryRouter>
      );

      const link = screen.getByRole('link', { name: /Review & Edit/i }) as HTMLAnchorElement;
      expect(link).toBeDefined();
      expect(link.getAttribute('href')).toBe('/prescriptions/00000000-0000-4000-8000-000000000123/review');
    });

    it('renders honest V3 schema pending notice when navigating directly to disabled review', async () => {
      vi.stubEnv('VITE_PRESCRIPTION_REVIEW_ENABLED', 'false');

      render(
        <MemoryRouter initialEntries={['/prescriptions/00000000-0000-4000-8000-000000000123/review']}>
          <Routes>
            <Route path="/prescriptions/:id/review" element={<PrescriptionReviewWorkspace />} />
          </Routes>
        </MemoryRouter>
      );

      expect(screen.getByText('V3 Review Schema Pending Deployment')).toBeDefined();
      expect(screen.getByText(/202611150001/i)).toBeDefined();
      expect(screen.getByText(/202611150002/i)).toBeDefined();
      expect(screen.getByRole('link', { name: /Return to Prescription Results/i })).toBeDefined();
      expect(screen.getByRole('link', { name: /Explore Demo Scenario/i })).toBeDefined();
    });
  });
});
