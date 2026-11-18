import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import type {
  PrescriptionReviewContractV1,
  ReviewEditableField,
  DocumentPreviewData,
  ReviewWarningItem,
  ReviewDraftOperation,
  PendingReviewIntelligenceRequest,
} from './types';
import {
  editMedicineFields,
  addMedicine,
  removeMedicine,
  restoreMedicine,
  restoreOriginalMedicineValues,
  restoreOriginalFieldValue,
  reorderMedicines,
  getFieldValue,
} from './review-domain';
import {
  getPrescriptionReviewAdapter,
  isPrescriptionReviewFeatureEnabled,
  isFictionalDemoScenario,
  PrescriptionReviewApiError,
  type MockScenarioId,
} from './prescription-review-api';
import { useAuth } from '../auth/AuthProvider';
import { PrescriptionDocumentPreview } from './PrescriptionDocumentPreview';
import { ReviewMedicineCard } from './ReviewMedicineCard';
import { ReviewWarningsPanel } from './ReviewWarningsPanel';
import { ReviewConfirmationModal } from './ReviewConfirmationModal';
import './prescription-review.css';

function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function toErrorMessage(err: unknown, fallback = 'An unexpected error occurred'): string {
  if (err instanceof PrescriptionReviewApiError) {
    return err.message;
  }
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return fallback;
}

function isStaleRevisionError(err: unknown): boolean {
  if (err instanceof PrescriptionReviewApiError && (err.code === 'REVIEW_STALE' || err.status === 409)) {
    return true;
  }
  if (err && typeof err === 'object' && 'code' in err && (err as { code?: string }).code === 'REVIEW_STALE') {
    return true;
  }
  if (err instanceof Error && err.message.toLowerCase().includes('stale')) {
    return true;
  }
  return false;
}

export const PrescriptionReviewWorkspace: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const auth = useAuth();

  const prescriptionId = id || 'scenario-a';
  const isDemo = isFictionalDemoScenario(prescriptionId);
  const featureEnabled = isPrescriptionReviewFeatureEnabled();

  // State
  const [serverReview, setServerReview] = useState<PrescriptionReviewContractV1 | null>(null);
  const [workingReview, setWorkingReview] = useState<PrescriptionReviewContractV1 | null>(null);
  const [preview, setPreview] = useState<DocumentPreviewData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [confirming, setConfirming] = useState<boolean>(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState<boolean>(false);
  const [selectedMedicineId, setSelectedMedicineId] = useState<string | null>(null);
  const [showAddMedicineModal, setShowAddMedicineModal] = useState<boolean>(false);
  const [newMedicineName, setNewMedicineName] = useState<string>('');
  const [showConfirmModal, setShowConfirmModal] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isConflictStale, setIsConflictStale] = useState<boolean>(false);
  const [statusNotification, setStatusNotification] = useState<{ type: 'success' | 'info'; message: string } | null>(
    null
  );
  const [intelligenceRequest, setIntelligenceRequest] = useState<PendingReviewIntelligenceRequest | null>(null);

  // Revision History state
  const [showRevisionHistory, setShowRevisionHistory] = useState<boolean>(false);
  const [revisionsList, setRevisionsList] = useState<readonly PrescriptionReviewContractV1[]>([]);
  const [loadingHistory, setLoadingHistory] = useState<boolean>(false);
  const historyModalRef = useRef<HTMLDivElement>(null);

  const handleHistoryKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      setShowRevisionHistory(false);
      return;
    }
    if (e.key === 'Tab' && historyModalRef.current) {
      const focusables = Array.from(
        historyModalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
  };

  // Stable confirmation idempotency key (per confirmation attempt)
  const confirmationIdempotencyKeyRef = useRef<string | null>(null);
  const [reloadKey, setReloadKey] = useState<number>(0);

  // Adapter instance
  const adapter = useMemo(() => {
    return getPrescriptionReviewAdapter(prescriptionId, () => auth.getAccessToken());
  }, [auth, prescriptionId]);

  // Fetch initial review data
  useEffect(() => {
    let active = true;
    const controller = new AbortController();

    void Promise.all([
      adapter.fetchReview(prescriptionId, controller.signal),
      (adapter.fetchDocumentBlob
        ? adapter.fetchDocumentBlob(prescriptionId, controller.signal)
        : adapter.fetchDocumentPreview(prescriptionId, controller.signal)).catch(() => ({
        available: false,
        totalPages: 0,
        coordinatesAvailable: false,
        message: 'Preview data could not be retrieved from evidence service.',
        isDemoMock: isDemo,
      })),
    ])
      .then(([reviewData, previewData]) => {
        if (!active || controller.signal.aborted) return;
        if (prescriptionId === 'scenario-h') adapter.simulateConflict?.(prescriptionId);
        setServerReview(reviewData);
        setWorkingReview(reviewData);
        setPreview(previewData);
        setHasUnsavedChanges(false);
        if (reviewData.medicines.length > 0) {
          setSelectedMedicineId(reviewData.medicines[0].medicineId);
        }
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active || controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) return;
        setErrorMessage(toErrorMessage(err, 'Failed to load prescription review workspace.'));
        setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [adapter, prescriptionId, isDemo, reloadKey]);

  // Fetch revision history
  const handleOpenRevisionHistory = async () => {
    setShowRevisionHistory(true);
    setLoadingHistory(true);
    try {
      const history = await adapter.fetchRevisionHistory(prescriptionId);
      setRevisionsList(history.revisions);
    } catch (err: unknown) {
      setErrorMessage(toErrorMessage(err, 'Failed to fetch revision history.'));
    } finally {
      setLoadingHistory(false);
    }
  };

  // Track active coordinates for highlighted document overlay
  const medicines = workingReview?.medicines || [];
  const activeSelectedMedicine = medicines.find((m) => m.medicineId === selectedMedicineId);
  const activeHighlight = activeSelectedMedicine?.highlights?.[0] || null;

  // Flattened warnings
  const warnings: ReviewWarningItem[] = useMemo(() => {
    if (!workingReview) return [];
    const list: ReviewWarningItem[] = [];
    for (const med of workingReview.medicines) {
      if (med.reviewWarnings) {
        list.push(...med.reviewWarnings);
      }
    }
    return list;
  }, [workingReview]);

  const unresolvedCount = workingReview?.unresolvedFields?.length || 0;

  // Local mutations in workingReview
  const handleUpdateField = (medicineId: string, field: ReviewEditableField, value: string | null) => {
    if (!workingReview || workingReview.status === 'confirmed') return;
    try {
      const updated = editMedicineFields(workingReview, {
        expectedLockVersion: workingReview.lockVersion,
        medicineId,
        updates: { [field]: value },
      });
      setWorkingReview(updated);
      setHasUnsavedChanges(true);
    } catch (err: unknown) {
      setErrorMessage(toErrorMessage(err));
    }
  };

  const handleAddMedicine = (medicineName: string) => {
    if (!workingReview || workingReview.status === 'confirmed') return;
    try {
      const newMedId = generateUuid();
      const newCommandId = `cmd-add-${newMedId.slice(0, 8)}`;
      const updated = addMedicine(workingReview, {
        expectedLockVersion: workingReview.lockVersion,
        medicineId: newMedId,
        commandId: newCommandId,
        fields: {
          medicineName: medicineName.trim(),
          brandName: null,
          genericName: null,
          strength: { value: null, unit: 'mg' },
          dosageForm: null,
          dose: { value: null, unit: null },
          frequency: null,
          timing: null,
          route: null,
          duration: { value: null, unit: 'days' },
          quantity: { value: null, unit: 'tablets' },
          notes: null,
        },
      });
      setWorkingReview(updated);
      setSelectedMedicineId(newMedId);
      setHasUnsavedChanges(true);
      setNewMedicineName('');
      setShowAddMedicineModal(false);
    } catch (err: unknown) {
      setErrorMessage(toErrorMessage(err));
    }
  };

  const handleRemoveMedicine = (medicineId: string) => {
    if (!workingReview || workingReview.status === 'confirmed') return;
    try {
      const updated = removeMedicine(workingReview, {
        expectedLockVersion: workingReview.lockVersion,
        medicineId,
      });
      setWorkingReview(updated);
      setHasUnsavedChanges(true);
    } catch (err: unknown) {
      setErrorMessage(toErrorMessage(err));
    }
  };

  const handleRestoreMedicine = (medicineId: string) => {
    if (!workingReview || workingReview.status === 'confirmed') return;
    try {
      const updated = restoreMedicine(workingReview, {
        expectedLockVersion: workingReview.lockVersion,
        medicineId,
      });
      setWorkingReview(updated);
      setHasUnsavedChanges(true);
    } catch (err: unknown) {
      setErrorMessage(toErrorMessage(err));
    }
  };

  const handleRestoreOriginalValues = (medicineId: string) => {
    if (!workingReview || workingReview.status === 'confirmed') return;
    try {
      const updated = restoreOriginalMedicineValues(workingReview, {
        expectedLockVersion: workingReview.lockVersion,
        medicineId,
      });
      setWorkingReview(updated);
      setHasUnsavedChanges(true);
    } catch (err: unknown) {
      setErrorMessage(toErrorMessage(err));
    }
  };

  const handleRestoreOriginalField = (medicineId: string, field: ReviewEditableField) => {
    if (!workingReview || workingReview.status === 'confirmed') return;
    try {
      const updated = restoreOriginalFieldValue(workingReview, {
        expectedLockVersion: workingReview.lockVersion,
        medicineId,
        field,
      });
      setWorkingReview(updated);
      setHasUnsavedChanges(true);
    } catch (err: unknown) {
      setErrorMessage(toErrorMessage(err));
    }
  };

  const handleMoveUp = (medicineId: string) => {
    if (!workingReview || workingReview.status === 'confirmed') return;
    const active = workingReview.medicines.filter((m) => m.status === 'active');
    const idx = active.findIndex((m) => m.medicineId === medicineId);
    if (idx <= 0) return;
    const newOrder = [...active.map((m) => m.medicineId)];
    const temp = newOrder[idx - 1];
    newOrder[idx - 1] = newOrder[idx];
    newOrder[idx] = temp;
    try {
      const updated = reorderMedicines(workingReview, {
        expectedLockVersion: workingReview.lockVersion,
        orderedMedicineIds: newOrder,
      });
      setWorkingReview(updated);
      setHasUnsavedChanges(true);
    } catch (err: unknown) {
      setErrorMessage(toErrorMessage(err));
    }
  };

  const handleMoveDown = (medicineId: string) => {
    if (!workingReview || workingReview.status === 'confirmed') return;
    const active = workingReview.medicines.filter((m) => m.status === 'active');
    const idx = active.findIndex((m) => m.medicineId === medicineId);
    if (idx < 0 || idx >= active.length - 1) return;
    const newOrder = [...active.map((m) => m.medicineId)];
    const temp = newOrder[idx + 1];
    newOrder[idx + 1] = newOrder[idx];
    newOrder[idx] = temp;
    try {
      const updated = reorderMedicines(workingReview, {
        expectedLockVersion: workingReview.lockVersion,
        orderedMedicineIds: newOrder,
      });
      setWorkingReview(updated);
      setHasUnsavedChanges(true);
    } catch (err: unknown) {
      setErrorMessage(toErrorMessage(err));
    }
  };

  const handleDiscardChanges = () => {
    if (serverReview) {
      setWorkingReview(serverReview);
      setHasUnsavedChanges(false);
      setStatusNotification({ type: 'info', message: 'All unsaved local changes were discarded.' });
      setTimeout(() => setStatusNotification(null), 3000);
    }
  };

  // Derive changes between serverReview and workingReview to build exact PATCH operations
  const buildPatchOperations = (): ReviewDraftOperation[] => {
    if (!serverReview || !workingReview) return [{ type: 'save_draft' }];

    const ops: ReviewDraftOperation[] = [];
    const serverMap = new Map(serverReview.medicines.map((m) => [m.medicineId, m]));
    const workingMap = new Map(workingReview.medicines.map((m) => [m.medicineId, m]));

    // Check additions
    for (const [id, med] of workingMap.entries()) {
      if (!serverMap.has(id)) {
        ops.push({
          type: 'add_medicine',
          commandId: med.addedByCommandId || `cmd-add-${id.slice(0, 8)}`,
          medicineId: id,
          fields: med.current,
          position: med.position,
        });
      }
    }

    // Check removals and status changes
    for (const [id, serverMed] of serverMap.entries()) {
      const workingMed = workingMap.get(id);
      if (workingMed && serverMed.status === 'active' && workingMed.status === 'removed') {
        ops.push({ type: 'remove_medicine', medicineId: id });
      } else if (workingMed && serverMed.status === 'removed' && workingMed.status === 'active') {
        ops.push({ type: 'restore_medicine', medicineId: id });
      }
    }

    // Check field modifications on shared active medicines
    for (const [id, serverMed] of serverMap.entries()) {
      const workingMed = workingMap.get(id);
      if (!workingMed || workingMed.status !== 'active' || serverMed.status !== 'active') continue;

      const updates: Partial<Record<ReviewEditableField, string | null>> = {};
      const fields: readonly ReviewEditableField[] = [
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
      ];

      for (const f of fields) {
        const sVal = getFieldValue(serverMed.current, f);
        const wVal = getFieldValue(workingMed.current, f);
        if (sVal !== wVal) {
          updates[f] = wVal;
        }
      }

      if (Object.keys(updates).length > 0) {
        ops.push({ type: 'edit_fields', medicineId: id, updates });
      }
    }

    // Check reordering of active medicines
    const serverActive = serverReview.medicines.filter((m) => m.status === 'active').map((m) => m.medicineId);
    const workingActive = workingReview.medicines.filter((m) => m.status === 'active').map((m) => m.medicineId);
    if (
      serverActive.length === workingActive.length &&
      serverActive.some((id, idx) => workingActive[idx] !== id) &&
      new Set(workingActive).size === workingActive.length
    ) {
      ops.push({ type: 'reorder_medicines', orderedMedicineIds: workingActive });
    }

    if (ops.length === 0) {
      ops.push({ type: 'save_draft' });
    }

    return ops;
  };

  // Save draft through backend PATCH /api/v1/prescriptions/:id/review/draft
  const handleSaveDraft = async () => {
    if (!workingReview || !serverReview) return;
    try {
      setSaving(true);
      setErrorMessage(null);

      const operations = buildPatchOperations();
      let currentRevision = serverReview;

      for (const op of operations) {
        currentRevision = await adapter.applyDraftOperation(prescriptionId, {
          expectedRevisionNumber: currentRevision.revisionNumber,
          expectedLockVersion: currentRevision.lockVersion,
          operation: op,
        });
      }

      setServerReview(currentRevision);
      setWorkingReview(currentRevision);
      setHasUnsavedChanges(false);
      setStatusNotification({
        type: 'success',
        message: `Review draft saved (Revision ${currentRevision.revisionNumber}, lock v${currentRevision.lockVersion}).`,
      });
      setTimeout(() => setStatusNotification(null), 3000);
    } catch (err: unknown) {
      if (isStaleRevisionError(err)) {
        setIsConflictStale(true);
      } else {
        setErrorMessage(toErrorMessage(err, 'Failed to save review draft.'));
      }
    } finally {
      setSaving(false);
    }
  };

  // Open confirm modal with stable idempotency key
  const handleOpenConfirmModal = () => {
    if (!confirmationIdempotencyKeyRef.current && workingReview) {
      confirmationIdempotencyKeyRef.current = `confirm-${workingReview.revisionId}-${generateUuid().slice(0, 8)}`;
    }
    setShowConfirmModal(true);
  };

  // Confirm review through POST /api/v1/prescriptions/:id/review/confirm
  const confirmationInFlight = useRef(false);
  const handleConfirmReview = async () => {
    if (!workingReview || !serverReview || confirmationInFlight.current) return;
    confirmationInFlight.current = true;
    try {
      setConfirming(true);
      setErrorMessage(null);

      // If unsaved local edits exist, commit them first
      let currentRevision = serverReview;
      if (hasUnsavedChanges) {
        const operations = buildPatchOperations();
        for (const op of operations) {
          currentRevision = await adapter.applyDraftOperation(prescriptionId, {
            expectedRevisionNumber: currentRevision.revisionNumber,
            expectedLockVersion: currentRevision.lockVersion,
            operation: op,
          });
        }
      }

      const idempotencyKey =
        confirmationIdempotencyKeyRef.current || `confirm-${currentRevision.revisionId}-${generateUuid().slice(0, 8)}`;

      const result = await adapter.confirmReview(prescriptionId, {
        expectedRevisionNumber: currentRevision.revisionNumber,
        expectedLockVersion: currentRevision.lockVersion,
        idempotencyKey,
      });

      setServerReview(result.review);
      setWorkingReview(result.review);
      setHasUnsavedChanges(false);
      setShowConfirmModal(false);
      setIntelligenceRequest(result.intelligenceRequest);
      if (!isDemo) navigate(`/prescriptions/${prescriptionId}`, { state: { confirmedReview: result.review } });

      setStatusNotification({
        type: 'success',
        message: `Prescription transcription confirmed (Revision ${result.review.revisionNumber}).`,
      });
    } catch (err: unknown) {
      if (isStaleRevisionError(err)) {
        setIsConflictStale(true);
        setShowConfirmModal(false);
      } else {
        setErrorMessage(toErrorMessage(err, 'Failed to confirm prescription review.'));
      }
    } finally {
      confirmationInFlight.current = false;
      setConfirming(false);
    }
  };

  // Reopen confirmed review to make edits through POST /api/v1/prescriptions/:id/review/reopen
  const handleReopenReview = async () => {
    if (!serverReview) return;
    try {
      setSaving(true);
      setErrorMessage(null);

      const reopened = await adapter.reopenReview(prescriptionId, {
        expectedRevisionNumber: serverReview.revisionNumber,
        expectedLockVersion: serverReview.lockVersion,
      });

      setServerReview(reopened);
      setWorkingReview(reopened);
      setHasUnsavedChanges(false);
      confirmationIdempotencyKeyRef.current = null;
      setIntelligenceRequest(null);

      setStatusNotification({
        type: 'info',
        message: `Created Revision ${reopened.revisionNumber} draft. Previous Revision ${reopened.baseRevisionId ?? '1'} is now superseded.`,
      });
      setTimeout(() => setStatusNotification(null), 4000);
    } catch (err: unknown) {
      if (isStaleRevisionError(err)) {
        setIsConflictStale(true);
      } else {
        setErrorMessage(toErrorMessage(err, 'Failed to reopen review.'));
      }
    } finally {
      setSaving(false);
    }
  };

  // Quick scenario switcher for evaluation (Demo mode only)
  const handleScenarioChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value as MockScenarioId;
    if (val) {
      navigate(`/prescriptions/${val}/review?mock=true`);
    }
  };

  // Hardened Feature Flag Guard: Normal production users cannot bypass with URL or localStorage
  if (!featureEnabled && !isDemo) {
    return (
      <main className="review-workspace-page">
        <div className="review-disabled-banner" role="alert">
          <div className="disabled-card">
            <span className="disabled-icon" aria-hidden="true">🔒</span>
            <div className="disabled-badge-wrapper">
              <span className="disabled-status-badge">V3 Review Schema Pending Deployment</span>
            </div>
            <h3>Prescription Review Feature Inactive</h3>
            <p>
              The interactive Prescription Review &amp; Verification workspace is currently restricted on this environment.
            </p>
            <p className="disabled-subtext">
              The backend Review Contract v1 database migrations (<code>202611150001</code> and <code>202611150002</code>) have passed local verification and are awaiting hosted deployment approval.
            </p>
            <div className="disabled-actions" style={{ marginTop: '1.5rem', display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              <Link to={`/prescriptions/${prescriptionId}`} className="btn-primary">
                Return to Prescription Results
              </Link>
              <Link
                to="/prescriptions/scenario-a/review?mock=true&review=true"
                className="btn-secondary"
                title="View clean fictional clinical review scenario"
              >
                Explore Demo Scenario
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  // Authentication Guard for Real Mode
  if (!isDemo && auth.status === 'unauthenticated') {
    return (
      <main className="review-workspace-page">
        <div className="review-disabled-banner" role="alert">
          <div className="disabled-card">
            <span className="disabled-icon" aria-hidden="true">🔑</span>
            <h3>Authentication Required</h3>
            <p>You must be signed in with a verified MedDecode account to inspect and review prescriptions.</p>
            <div style={{ marginTop: '1.5rem' }}>
              <Link to="/sign-in" className="btn-primary">
                Sign In to MedDecode
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  const isConfirmed = workingReview?.status === 'confirmed';
  const activeCount = medicines.filter((m) => m.status === 'active').length;
  const removedCount = medicines.filter((m) => m.status === 'removed').length;

  return (
    <main className="review-workspace-page" aria-label="Prescription Review and Correction Workspace">
      {/* Demo / Fictional Isolation Notice Banner */}
      {isDemo && (
        <div className="demo-mode-alert-bar" role="status">
          <span className="demo-alert-icon" aria-hidden="true">🧪</span>
          <div className="demo-alert-text">
            <strong>DEVELOPMENT DEMO MODE:</strong> Viewing fictional clinical test scenario (<code>{prescriptionId}</code>). No real patient records or backend database records are altered.
          </div>
        </div>
      )}

      {/* Top Application Bar */}
      <header className="review-top-bar">
        <div className="review-top-left">
          <Link
            to={`/prescriptions/${prescriptionId}`}
            className="btn-back-link"
            aria-label="Back to prescription results"
          >
            ← Back to Results
          </Link>

          <div className="workspace-title-block">
            <h1 className="workspace-main-title">Review &amp; Edit Prescription</h1>
            <span className="workspace-sub-title">Verify OCR transcription before saving to medical profile</span>
          </div>

          <div className="workspace-meta-badges">
            {workingReview && (
              <>
                <span className="meta-badge revision-badge" title="Revision counter">
                  Rev {workingReview.revisionNumber}
                </span>
                <span
                  className={`meta-badge status-badge ${isConfirmed ? 'status-confirmed' : 'status-draft'}`}
                  title="Revision lifecycle status"
                >
                  {isConfirmed ? '✓ Confirmed' : 'Draft in Progress'}
                </span>
                <span className="meta-badge lock-badge" title="Concurrency lock version">
                  v{workingReview.lockVersion}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="review-top-right">
          {/* Quick Scenario Selector for evaluation (Isolated in Demo Mode Only) */}
          {isDemo && (
            <div className="scenario-selector-group">
              <label htmlFor="scenario-select" className="scenario-label">
                Demo Scenario:
              </label>
              <select
                id="scenario-select"
                className="scenario-dropdown"
                value={prescriptionId}
                onChange={handleScenarioChange}
                aria-label="Select mock test scenario"
              >
                <option value="scenario-a">A: 1 Clean Medicine (Amoxicillin)</option>
                <option value="scenario-b">B: 3 Medicines with Doses</option>
                <option value="scenario-c">C: 5 Medicines (Needs Edits)</option>
                <option value="scenario-d">D: Uncertain Strength (250 vs 500mg)</option>
                <option value="scenario-e">E: User-Added Medicine</option>
                <option value="scenario-f">F: Removed OCR Artifact</option>
                <option value="scenario-g">G: Confirmed &amp; Reopened</option>
                <option value="scenario-h">H: Concurrency Conflict</option>
                <option value="scenario-i">I: Preview Unavailable</option>
                <option value="scenario-j">J: Partial OCR Smudged</option>
              </select>
            </div>
          )}

          <div className="top-action-group">
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={handleOpenRevisionHistory}
              aria-label="View prescription revision history"
              title="Inspect confirmed revisions"
            >
              📜 Revisions History
            </button>

            {!isConfirmed ? (
              <>
                <button
                  type="button"
                  className="btn-save-draft"
                  onClick={handleSaveDraft}
                  disabled={saving || !hasUnsavedChanges}
                  aria-label="Save review draft via PATCH"
                >
                  {saving ? 'Saving...' : 'Save Draft'}
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleOpenConfirmModal}
                  disabled={activeCount === 0 || confirming}
                  aria-label="Confirm prescription review"
                >
                  Confirm Review
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn-primary"
                onClick={handleReopenReview}
                disabled={saving}
                aria-label="Reopen this confirmed review to create a new revision"
              >
                ✎ Edit / Reopen Review
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Notifications and Alerts */}
      {statusNotification && (
        <div className={`notification-banner ${statusNotification.type}`} role="status">
          <span>{statusNotification.message}</span>
        </div>
      )}

      {errorMessage && (
        <div className="notification-banner error" role="alert">
          <span>{errorMessage}</span>
          <button type="button" className="btn-link" onClick={() => setErrorMessage(null)}>
            Dismiss
          </button>
        </div>
      )}

      {/* Intelligence Analysis Pending Notice (after genuine confirmation) */}
      {intelligenceRequest && (
        <div className="intelligence-pending-card" role="status">
          <div className="intelligence-card-header">
            <span className="intelligence-icon" aria-hidden="true">⚙️</span>
            <strong>Automated Medicine Intelligence Pending</strong>
          </div>
          <p className="intelligence-card-body">
            Your confirmed transcription (Revision {serverReview?.revisionNumber}) was submitted for intelligence analysis.
            Processing uses your confirmed transcription to produce catalogue-backed information and analysis notes, with uncertainty preserved.
            <span className="request-key-code"> Request Key: {intelligenceRequest.requestKey}</span>
          </p>
        </div>
      )}

      {/* Concurrency Conflict Banner (409 REVIEW_STALE) */}
      {isConflictStale && (
        <div className="conflict-stale-banner" role="alert">
          <div className="conflict-content">
            <span className="conflict-icon" aria-hidden="true">⚠️</span>
            <div className="conflict-text">
              <strong>Revision Conflict Detected:</strong> The review was updated by another session on the server.
              Your local unsaved edits are preserved in this tab so you do not lose any typed information.
            </div>
          </div>
          <div className="conflict-actions">
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => {
                setLoading(true);
                setErrorMessage(null);
                setIsConflictStale(false);
                setReloadKey((k) => k + 1);
              }}
              title="Reload the latest revision from the server"
            >
              Reload Latest Server Revision
            </button>
          </div>
        </div>
      )}

      {/* Reopened Draft Superseded Notice */}
      {!loading && workingReview && workingReview.status === 'draft' && workingReview.revisionNumber > 1 && (
        <div className="superseded-draft-notice" role="status">
          <span className="notice-icon" aria-hidden="true">ℹ️</span>
          <div className="notice-text">
            <strong>Revision {workingReview.revisionNumber} (Draft):</strong> You are editing a reopened prescription.
            Earlier intelligence insights for Revision {workingReview.revisionNumber - 1} are superseded.
            A fresh clinical re-evaluation will be queued upon confirmation.
          </div>
        </div>
      )}

      {/* Loading State */}
      {loading ? (
        <div className="workspace-loading-state" aria-busy="true">
          <div className="preview-spinner" />
          <p>Loading prescription transcription workspace from authenticated review service...</p>
        </div>
      ) : (
        /* Workspace Main Body: Desktop Split / Mobile Stacked */
        <div className="review-layout-split">
          {/* Left Column: Original Document Preview */}
          <aside className="review-layout-preview-column" aria-label="Prescription document preview column">
            <PrescriptionDocumentPreview
              preview={preview}
              activeHighlight={activeHighlight}
              activeMedicineName={activeSelectedMedicine?.current.medicineName}
            />
          </aside>

          {/* Right Column: Medicine Editing Workspace */}
          <section className="review-layout-medicines-column" aria-label="Medicine transcription review and editing">
            {/* Warnings and Clinical Disclaimers */}
            <ReviewWarningsPanel
              warnings={warnings}
              unresolvedCount={unresolvedCount}
              onFocusMedicine={(medId) => {
                setSelectedMedicineId(medId);
                const el = document.querySelector(`[data-medicine-id="${medId}"]`);
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }}
            />

            {/* Medicines List Header & Action Toolbar */}
            <div className="medicines-toolbar">
              <div className="toolbar-stats">
                <h3 className="section-title">Prescribed Medications</h3>
                <span className="meds-count-badge">
                  {activeCount} {activeCount === 1 ? 'Medicine' : 'Medicines'}
                  {removedCount > 0 && ` (${removedCount} removed)`}
                </span>
              </div>

              {!isConfirmed && (
                <div className="toolbar-actions">
                  <button
                    type="button"
                    className="btn-add-medicine"
                    onClick={() => setShowAddMedicineModal(true)}
                    aria-label="Add a new medication row manually"
                  >
                    ＋ Add Missing Medicine
                  </button>
                </div>
              )}
            </div>

            {/* Confirmed Banner if in read-only confirmed state */}
            {isConfirmed && (
              <div className="confirmed-view-banner">
                <div className="confirmed-banner-text">
                  <strong>Revision {workingReview?.revisionNumber} is Confirmed</strong>
                  <p>
                    Confirmed on{' '}
                    {workingReview?.confirmation.confirmedAt
                      ? new Date(workingReview.confirmation.confirmedAt).toLocaleDateString()
                      : 'recent date'}
                    . To make further corrections, click &quot;Edit / Reopen Review&quot; above to begin a new revision.
                  </p>
                </div>
              </div>
            )}

            {/* Medicine Cards List */}
            <div className="medicine-cards-list" role="list">
              {medicines.length === 0 ? (
                <div className="empty-medicines-card">
                  <p>No medicines recorded for this prescription.</p>
                  {!isConfirmed && (
                    <button type="button" className="btn-primary btn-sm" onClick={() => setShowAddMedicineModal(true)}>
                      Add First Medicine
                    </button>
                  )}
                </div>
              ) : (
                medicines.map((med, index) => (
                  <ReviewMedicineCard
                    key={med.medicineId}
                    medicine={med}
                    index={index}
                    totalMedicines={medicines.length}
                    isSelected={med.medicineId === selectedMedicineId}
                    onSelect={() => setSelectedMedicineId(med.medicineId)}
                    onUpdateField={handleUpdateField}
                    onRemoveMedicine={handleRemoveMedicine}
                    onRestoreMedicine={handleRestoreMedicine}
                    onRestoreOriginalValues={handleRestoreOriginalValues}
                    onRestoreOriginalField={handleRestoreOriginalField}
                    onMoveUp={handleMoveUp}
                    onMoveDown={handleMoveDown}
                    readOnly={isConfirmed}
                  />
                ))
              )}
            </div>

            {/* Floating / Sticky Bottom Bar for Unsaved Changes */}
            {!isConfirmed && (
              <footer className="review-bottom-dock">
                <div className="dock-status">
                  {hasUnsavedChanges ? (
                    <span className="unsaved-indicator">● You have unsaved changes in this review draft</span>
                  ) : (
                    <span className="saved-indicator">✓ All changes synchronized with server draft</span>
                  )}
                </div>

                <div className="dock-actions">
                  {hasUnsavedChanges && (
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={handleDiscardChanges}
                      disabled={saving}
                    >
                      Discard Changes
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={handleSaveDraft}
                    disabled={saving || !hasUnsavedChanges}
                  >
                    {saving ? 'Saving...' : 'Save Draft'}
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={handleOpenConfirmModal}
                    disabled={activeCount === 0 || confirming}
                  >
                    Confirm Review
                  </button>
                </div>
              </footer>
            )}
          </section>
        </div>
      )}

      {/* Revision History Modal */}
      {showRevisionHistory && (
        <div
          className="review-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="history-modal-title"
          onClick={() => setShowRevisionHistory(false)}
          onKeyDown={handleHistoryKeyDown}
        >
          <div className="review-modal-dialog" ref={historyModalRef} onClick={(e) => e.stopPropagation()}>
            <header className="review-modal-header">
              <div className="modal-title-group">
                <span className="modal-icon" aria-hidden="true">📜</span>
                <h3 id="history-modal-title" className="modal-heading">
                  Prescription Revision History
                </h3>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowRevisionHistory(false)}
                aria-label="Close revision history dialog"
              >
                ✕
              </button>
            </header>

            <div className="review-modal-body">
              {loadingHistory ? (
                <div className="history-loading-indicator">
                  <div className="preview-spinner" />
                  <p>Loading revision records from server...</p>
                </div>
              ) : revisionsList.length === 0 ? (
                <p>No revision history records available.</p>
              ) : (
                <ul className="revision-history-list" aria-label="List of revisions for this prescription">
                  {revisionsList.map((rev) => {
                    const isCurrent = rev.revisionId === workingReview?.revisionId;
                    const isSuperseded =
                      serverReview &&
                      rev.revisionNumber < serverReview.revisionNumber &&
                      rev.status === 'confirmed';

                    return (
                      <li key={rev.revisionId} className={`revision-history-item ${isCurrent ? 'current' : ''}`}>
                        <div className="revision-item-header">
                          <span className="revision-number-tag">Revision {rev.revisionNumber}</span>
                          <span
                            className={`badge ${rev.status === 'confirmed' ? 'badge-confidence high' : 'badge-modified'}`}
                          >
                            {rev.status === 'confirmed' ? 'Confirmed' : 'Draft'}
                          </span>
                          {isCurrent && <span className="current-view-badge">Active in Workspace</span>}
                          {isSuperseded && <span className="superseded-badge">Superseded</span>}
                        </div>

                        <div className="revision-item-meta">
                          <span>Created: {new Date(rev.createdAt).toLocaleString()}</span>
                          <span>Lock: v{rev.lockVersion}</span>
                          {rev.baseRevisionId && <span>Base Rev ID: {rev.baseRevisionId.slice(0, 8)}…</span>}
                        </div>

                        <div className="revision-item-summary">
                          <span>Active medicines: {rev.medicines.filter((m) => m.status === 'active').length}</span>
                          {rev.confirmation.status === 'confirmed' && rev.confirmation.confirmedAt && (
                            <span className="confirmed-at-note">
                              Confirmed at: {new Date(rev.confirmation.confirmedAt).toLocaleTimeString()}
                            </span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <footer className="review-modal-footer">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowRevisionHistory(false)}
              >
                Close
              </button>
            </footer>
          </div>
        </div>
      )}

      {showAddMedicineModal && (
        <div className="review-modal-backdrop" role="presentation">
          <div
            className="review-modal-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-medicine-modal-title"
          >
            <header className="review-modal-header">
              <h3 id="add-medicine-modal-title" className="modal-heading">Add Missing Medicine</h3>
              <button
                type="button"
                className="modal-close-btn"
                aria-label="Close add medicine dialog"
                onClick={() => { setNewMedicineName(''); setShowAddMedicineModal(false); }}
              >
                X
              </button>
            </header>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (newMedicineName.trim()) handleAddMedicine(newMedicineName);
              }}
            >
              <div className="review-modal-body">
                <label htmlFor="new-medicine-name" className="field-label">Medicine Name</label>
                <input
                  id="new-medicine-name"
                  className="form-input"
                  value={newMedicineName}
                  onChange={(event) => setNewMedicineName(event.target.value)}
                  autoFocus
                  required
                  maxLength={200}
                  placeholder="Enter the name shown on the prescription"
                />
                <p className="field-help">Enter only the medicine identity you can verify from the prescription. Other details can remain unresolved.</p>
              </div>
              <footer className="review-modal-footer">
                <button type="button" className="btn-secondary" onClick={() => { setNewMedicineName(''); setShowAddMedicineModal(false); }}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={!newMedicineName.trim()}>
                  Add Medicine
                </button>
              </footer>
            </form>
          </div>
        </div>
      )}

      {/* Confirmation Modal with Required Exact Clinical Disclaimers */}
      <ReviewConfirmationModal
        isOpen={showConfirmModal}
        medicines={medicines}
        onConfirm={handleConfirmReview}
        onClose={() => setShowConfirmModal(false)}
        isSubmitting={confirming}
      />
    </main>
  );
};
