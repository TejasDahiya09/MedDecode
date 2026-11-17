import React, { useState, useEffect, useRef } from 'react';
import type { ReviewMedicineEntryV1 } from './types';
import { REVIEW_CONFIRMATION_STATEMENT, REVIEW_CLINICAL_DISCLAIMER } from './types';

interface ReviewConfirmationModalProps {
  isOpen: boolean;
  medicines: readonly ReviewMedicineEntryV1[];
  onConfirm: (notes?: string) => void;
  onClose: () => void;
  isSubmitting?: boolean;
}

const ReviewConfirmationDialog: React.FC<Omit<ReviewConfirmationModalProps, 'isOpen'>> = ({
  medicines,
  onConfirm,
  onClose,
  isSubmitting = false,
}) => {
  const [acknowledged, setAcknowledged] = useState<boolean>(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  const activeMedicines = medicines.filter((m) => m.status === 'active');
  const removedMedicines = medicines.filter((m) => m.status === 'removed');

  const hasMissingNames = activeMedicines.some((m) => !m.current.medicineName?.trim());
  const canConfirm = activeMedicines.length > 0 && !hasMissingNames && acknowledged && !isSubmitting;

  useEffect(() => {
    // Focus first focusable element on mount
    const firstFocusable = dialogRef.current?.querySelector<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    firstFocusable?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && !isSubmitting) {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === 'Tab' && dialogRef.current) {
      const focusables = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
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

  return (
    <div
      className="review-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
      onKeyDown={handleKeyDown}
    >
      <div className="review-modal-dialog" ref={dialogRef}>
        <header className="review-modal-header">
          <div className="modal-title-group">
            <span className="modal-icon" aria-hidden="true">📋</span>
            <h3 id="confirm-modal-title" className="modal-heading">
              Confirm Prescription Review
            </h3>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close confirmation dialog"
          >
            ✕
          </button>
        </header>

        <div className="review-modal-body">
          <p className="modal-lead-text">
            Please verify your transcription summary below before confirming this review revision.
          </p>

          <div className="summary-section">
            <div className="summary-stat-row">
              <span className="summary-stat-label">Active Medicines to Save:</span>
              <span className="summary-stat-value count-active">{activeMedicines.length}</span>
            </div>
            {removedMedicines.length > 0 && (
              <div className="summary-stat-row">
                <span className="summary-stat-label">Excluded / Removed Medicines:</span>
                <span className="summary-stat-value count-removed">{removedMedicines.length}</span>
              </div>
            )}
          </div>

          <div className="medicine-summary-list-card">
            <h4 className="summary-list-heading">Medication Summary</h4>
            {activeMedicines.length === 0 ? (
              <p className="warning-text">No active medicines found. You cannot confirm an empty prescription.</p>
            ) : (
              <ul className="summary-med-items" aria-label="Summary list of medicines to confirm">
                {activeMedicines.map((m) => {
                  const strengthStr = m.current.strength.value
                    ? ` (${m.current.strength.value} ${m.current.strength.unit || ''})`
                    : '';
                  const freqStr = m.current.frequency ? ` • ${m.current.frequency}` : '';
                  return (
                    <li key={m.medicineId} className="summary-med-item">
                      <span className="med-pos">#{m.position}</span>
                      <strong className="med-name">{m.current.medicineName || 'Unnamed Medicine'}</strong>
                      <span className="med-details">{strengthStr}{freqStr}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {hasMissingNames && (
            <div className="alert-banner alert-danger" role="alert">
              One or more active medicines has a blank medicine name. Please provide names before confirming.
            </div>
          )}

          <div className="modal-notes-section">
            <p className="field-label">Review notes</p>
            <p>Add notes in each medicine's Notes field before confirmation. Separate review-level notes are not supported by this service.</p>
          </div>

          {/* EXACT REQUIRED CLINICAL DISCLAIMER */}
          <div className="modal-disclaimer-box" role="note">
            <strong className="disclaimer-title">Clinical Disclaimer:</strong>
            <p className="disclaimer-statement">
              {REVIEW_CLINICAL_DISCLAIMER}
            </p>
          </div>

          {/* EXACT REQUIRED CONFIRMATION STATEMENT */}
          <div className="modal-statement-box">
            <label className="checkbox-control-label">
              <input
                type="checkbox"
                className="checkbox-input"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                disabled={isSubmitting || activeMedicines.length === 0 || hasMissingNames}
                aria-label="Confirmation statement checkbox"
              />
              <span className="statement-text">
                {REVIEW_CONFIRMATION_STATEMENT}
              </span>
            </label>
          </div>
        </div>

        <footer className="review-modal-footer">
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => onConfirm()}
            disabled={!canConfirm}
          >
            {isSubmitting ? 'Confirming...' : 'Confirm Review'}
          </button>
        </footer>
      </div>
    </div>
  );
};

export const ReviewConfirmationModal: React.FC<ReviewConfirmationModalProps> = (props) => {
  if (!props.isOpen) return null;
  return <ReviewConfirmationDialog {...props} />;
};
