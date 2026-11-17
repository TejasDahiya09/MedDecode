import React, { useState } from 'react';
import type {
  ReviewMedicineEntryV1,
  ReviewEditableField,
} from './types';
import { getFieldValue } from './review-domain';

interface ReviewMedicineCardProps {
  medicine: ReviewMedicineEntryV1;
  index: number;
  totalMedicines: number;
  isSelected?: boolean;
  onSelect?: () => void;
  onUpdateField: (medicineId: string, field: ReviewEditableField, value: string | null) => void;
  onRemoveMedicine: (medicineId: string) => void;
  onRestoreMedicine: (medicineId: string) => void;
  onRestoreOriginalValues: (medicineId: string) => void;
  onRestoreOriginalField: (medicineId: string, field: ReviewEditableField) => void;
  onMoveUp: (medicineId: string) => void;
  onMoveDown: (medicineId: string) => void;
  readOnly?: boolean;
}

export const ReviewMedicineCard: React.FC<ReviewMedicineCardProps> = ({
  medicine,
  index,
  totalMedicines,
  isSelected = false,
  onSelect,
  onUpdateField,
  onRemoveMedicine,
  onRestoreMedicine,
  onRestoreOriginalValues,
  onRestoreOriginalField,
  onMoveUp,
  onMoveDown,
  readOnly = false,
}) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  const [showRemovalPrompt, setShowRemovalPrompt] = useState<boolean>(false);

  const isRemoved = medicine.status === 'removed';
  const isUserAdded = medicine.origin === 'user_added';
  const current = medicine.current;
  const original = medicine.original;

  const handleInputChange = (field: ReviewEditableField, rawVal: string) => {
    const val = rawVal.trim() === '' ? null : rawVal;
    onUpdateField(medicine.medicineId, field, val);
  };

  const isFieldChanged = (field: ReviewEditableField): boolean => {
    if (!original) return false;
    const origVal = getFieldValue(original, field);
    const currVal = getFieldValue(current, field);
    return origVal !== currVal;
  };

  const hasModifications =
    !isUserAdded &&
    original !== null &&
    (isFieldChanged('medicineName') ||
      isFieldChanged('brandName') ||
      isFieldChanged('genericName') ||
      isFieldChanged('strengthValue') ||
      isFieldChanged('strengthUnit') ||
      isFieldChanged('dosageForm') ||
      isFieldChanged('doseValue') ||
      isFieldChanged('doseUnit') ||
      isFieldChanged('frequency') ||
      isFieldChanged('timing') ||
      isFieldChanged('route') ||
      isFieldChanged('durationValue') ||
      isFieldChanged('durationUnit') ||
      isFieldChanged('quantityValue') ||
      isFieldChanged('quantityUnit') ||
      isFieldChanged('notes'));

  return (
    <article
      className={`review-medicine-card ${isRemoved ? 'removed' : ''} ${isSelected ? 'selected' : ''}`}
      onClick={onSelect}
      aria-label={`Medicine entry ${index + 1}: ${current.medicineName || 'Unnamed medicine'}`}
      data-medicine-id={medicine.medicineId}
    >
      <header className="card-top-bar">
        <div className="card-header-left">
          <span className="card-position-badge">#{medicine.position}</span>
          <h4 className="card-medicine-title">
            {current.medicineName || <span className="empty-name-placeholder">Untitled Medicine</span>}
          </h4>

          <div className="card-badges">
            {isUserAdded ? (
              <span className="badge badge-user-added" title="Manually added by user">User Added</span>
            ) : (
              <span className="badge badge-extracted" title="Extracted by OCR pipeline">OCR Extracted</span>
            )}

            {isRemoved ? (
              <span className="badge badge-status-removed" title="This medicine will not be included in confirmation">Removed</span>
            ) : hasModifications ? (
              <span className="badge badge-modified" title="Contains user modifications">Edited</span>
            ) : (
              <span className="badge badge-unmodified">Unedited</span>
            )}
          </div>
        </div>

        <div className="card-header-actions" onClick={(e) => e.stopPropagation()}>
          {!readOnly && (
            <div className="reorder-btn-group" role="group" aria-label="Reorder medicine">
              <button
                type="button"
                className="btn-icon"
                onClick={() => onMoveUp(medicine.medicineId)}
                disabled={index === 0}
                aria-label="Move medicine up"
                title="Move up"
              >
                ▲
              </button>
              <button
                type="button"
                className="btn-icon"
                onClick={() => onMoveDown(medicine.medicineId)}
                disabled={index === totalMedicines - 1}
                aria-label="Move medicine down"
                title="Move down"
              >
                ▼
              </button>
            </div>
          )}

          <button
            type="button"
            className="btn-toggle-expand"
            onClick={() => setIsExpanded(!isExpanded)}
            aria-expanded={isExpanded}
            aria-label={isExpanded ? 'Collapse medicine details' : 'Expand medicine details'}
          >
            {isExpanded ? '▲ Collapse' : '▼ Details'}
          </button>
        </div>
      </header>

      {isRemoved && (
        <div className="card-removed-banner">
          <p className="removed-notice-text">
            This medicine entry was marked as removed. It will be excluded from the confirmed prescription.
          </p>
          {!readOnly && (
            <button
              type="button"
              className="btn-restore-medicine"
              onClick={() => onRestoreMedicine(medicine.medicineId)}
              aria-label="Restore this removed medicine"
            >
              ↺ Restore Medicine
            </button>
          )}
        </div>
      )}

      {showRemovalPrompt && !isRemoved && (
        <div className="removal-prompt-inline" onClick={(e) => e.stopPropagation()}>
          <p className="prompt-title">Remove this medicine from prescription transcription?</p>
          <div className="prompt-actions">
            <button type="button" className="btn-secondary btn-sm" onClick={() => setShowRemovalPrompt(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-danger btn-sm"
              onClick={() => {
                onRemoveMedicine(medicine.medicineId);
                setShowRemovalPrompt(false);
              }}
            >
              Confirm Remove
            </button>
          </div>
        </div>
      )}

      {isExpanded && !isRemoved && (
        <div className="card-fields-body" onClick={(e) => e.stopPropagation()}>
          {/* Row 1: Medicine Name, Brand, Generic */}
          <div className="fields-grid-3">
            <div className="field-control">
              <label htmlFor={`med-name-${medicine.medicineId}`} className="field-label required">
                Medicine Name *
              </label>
              <input
                id={`med-name-${medicine.medicineId}`}
                type="text"
                className={`form-input ${!current.medicineName?.trim() ? 'input-error' : ''}`}
                value={current.medicineName || ''}
                onChange={(e) => handleInputChange('medicineName', e.target.value)}
                placeholder="e.g. Amoxicillin"
                disabled={readOnly}
                required
              />
              {isFieldChanged('medicineName') && (
                <div className="original-diff-indicator">
                  <span className="diff-label">OCR:</span>
                  <span className="diff-val">{original?.medicineName || '(empty)'}</span>
                  {!readOnly && (
                    <button
                      type="button"
                      className="btn-link-restore"
                      onClick={() => onRestoreOriginalField(medicine.medicineId, 'medicineName')}
                      aria-label="Restore original medicine name"
                    >
                      Restore
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="field-control">
              <label htmlFor={`brand-name-${medicine.medicineId}`} className="field-label">
                Brand Name
              </label>
              <input
                id={`brand-name-${medicine.medicineId}`}
                type="text"
                className="form-input"
                value={current.brandName || ''}
                onChange={(e) => handleInputChange('brandName', e.target.value)}
                placeholder="e.g. Amoxil"
                disabled={readOnly}
              />
              {isFieldChanged('brandName') && (
                <div className="original-diff-indicator">
                  <span className="diff-label">OCR:</span>
                  <span className="diff-val">{original?.brandName || '(empty)'}</span>
                  {!readOnly && (
                    <button
                      type="button"
                      className="btn-link-restore"
                      onClick={() => onRestoreOriginalField(medicine.medicineId, 'brandName')}
                    >
                      Restore
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="field-control">
              <label htmlFor={`generic-name-${medicine.medicineId}`} className="field-label">
                Generic Name
              </label>
              <input
                id={`generic-name-${medicine.medicineId}`}
                type="text"
                className="form-input"
                value={current.genericName || ''}
                onChange={(e) => handleInputChange('genericName', e.target.value)}
                placeholder="e.g. Amoxicillin Trihydrate"
                disabled={readOnly}
              />
              {isFieldChanged('genericName') && (
                <div className="original-diff-indicator">
                  <span className="diff-label">OCR:</span>
                  <span className="diff-val">{original?.genericName || '(empty)'}</span>
                  {!readOnly && (
                    <button
                      type="button"
                      className="btn-link-restore"
                      onClick={() => onRestoreOriginalField(medicine.medicineId, 'genericName')}
                    >
                      Restore
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Row 2: Strength, Dosage Form, Dose */}
          <div className="fields-grid-3">
            <div className="field-control">
              <label className="field-label">Strength</label>
              <div className="input-compound">
                <input
                  type="text"
                  className="form-input input-num"
                  placeholder="e.g. 500"
                  value={current.strength.value || ''}
                  onChange={(e) => handleInputChange('strengthValue', e.target.value)}
                  disabled={readOnly}
                  aria-label="Strength value"
                />
                <input
                  type="text"
                  className="form-input input-unit"
                  placeholder="unit (mg)"
                  value={current.strength.unit || ''}
                  onChange={(e) => handleInputChange('strengthUnit', e.target.value)}
                  disabled={readOnly}
                  aria-label="Strength unit"
                />
              </div>
              {(isFieldChanged('strengthValue') || isFieldChanged('strengthUnit')) && (
                <div className="original-diff-indicator">
                  <span className="diff-label">OCR:</span>
                  <span className="diff-val">
                    {original?.strength.value
                      ? `${original.strength.value} ${original.strength.unit || ''}`
                      : '(empty)'}
                  </span>
                  {!readOnly && (
                    <button
                      type="button"
                      className="btn-link-restore"
                      onClick={() => {
                        onRestoreOriginalField(medicine.medicineId, 'strengthValue');
                        onRestoreOriginalField(medicine.medicineId, 'strengthUnit');
                      }}
                    >
                      Restore
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="field-control">
              <label htmlFor={`dosage-form-${medicine.medicineId}`} className="field-label">
                Dosage Form
              </label>
              <input
                id={`dosage-form-${medicine.medicineId}`}
                type="text"
                className="form-input"
                placeholder="e.g. tablet, capsule, syrup"
                value={current.dosageForm || ''}
                onChange={(e) => handleInputChange('dosageForm', e.target.value)}
                disabled={readOnly}
              />
              {isFieldChanged('dosageForm') && (
                <div className="original-diff-indicator">
                  <span className="diff-label">OCR:</span>
                  <span className="diff-val">{original?.dosageForm || '(empty)'}</span>
                  {!readOnly && (
                    <button
                      type="button"
                      className="btn-link-restore"
                      onClick={() => onRestoreOriginalField(medicine.medicineId, 'dosageForm')}
                    >
                      Restore
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="field-control">
              <label className="field-label">Dose (Per Intake)</label>
              <div className="input-compound">
                <input
                  type="text"
                  className="form-input input-num"
                  placeholder="e.g. 1"
                  value={current.dose.value || ''}
                  onChange={(e) => handleInputChange('doseValue', e.target.value)}
                  disabled={readOnly}
                  aria-label="Dose amount"
                />
                <input
                  type="text"
                  className="form-input input-unit"
                  placeholder="unit (tablet)"
                  value={current.dose.unit || ''}
                  onChange={(e) => handleInputChange('doseUnit', e.target.value)}
                  disabled={readOnly}
                  aria-label="Dose unit"
                />
              </div>
              {(isFieldChanged('doseValue') || isFieldChanged('doseUnit')) && (
                <div className="original-diff-indicator">
                  <span className="diff-label">OCR:</span>
                  <span className="diff-val">
                    {original?.dose.value ? `${original.dose.value} ${original.dose.unit || ''}` : '(empty)'}
                  </span>
                  {!readOnly && (
                    <button
                      type="button"
                      className="btn-link-restore"
                      onClick={() => {
                        onRestoreOriginalField(medicine.medicineId, 'doseValue');
                        onRestoreOriginalField(medicine.medicineId, 'doseUnit');
                      }}
                    >
                      Restore
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Row 3: Frequency, Timing, Route */}
          <div className="fields-grid-3">
            <div className="field-control">
              <label htmlFor={`frequency-${medicine.medicineId}`} className="field-label">
                Frequency
              </label>
              <input
                id={`frequency-${medicine.medicineId}`}
                type="text"
                className="form-input"
                placeholder="e.g. Twice daily, Once daily, TID"
                value={current.frequency || ''}
                onChange={(e) => handleInputChange('frequency', e.target.value)}
                disabled={readOnly}
              />
              {isFieldChanged('frequency') && (
                <div className="original-diff-indicator">
                  <span className="diff-label">OCR:</span>
                  <span className="diff-val">{original?.frequency || '(empty)'}</span>
                  {!readOnly && (
                    <button
                      type="button"
                      className="btn-link-restore"
                      onClick={() => onRestoreOriginalField(medicine.medicineId, 'frequency')}
                    >
                      Restore
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="field-control">
              <label htmlFor={`timing-${medicine.medicineId}`} className="field-label">
                Timing
              </label>
              <input
                id={`timing-${medicine.medicineId}`}
                type="text"
                className="form-input"
                placeholder="e.g. After meals, In the morning"
                value={current.timing || ''}
                onChange={(e) => handleInputChange('timing', e.target.value)}
                disabled={readOnly}
              />
              {isFieldChanged('timing') && (
                <div className="original-diff-indicator">
                  <span className="diff-label">OCR:</span>
                  <span className="diff-val">{original?.timing || '(empty)'}</span>
                  {!readOnly && (
                    <button
                      type="button"
                      className="btn-link-restore"
                      onClick={() => onRestoreOriginalField(medicine.medicineId, 'timing')}
                    >
                      Restore
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="field-control">
              <label htmlFor={`route-${medicine.medicineId}`} className="field-label">
                Route
              </label>
              <input
                id={`route-${medicine.medicineId}`}
                type="text"
                className="form-input"
                placeholder="e.g. oral, topical, inhalation"
                value={current.route || ''}
                onChange={(e) => handleInputChange('route', e.target.value)}
                disabled={readOnly}
              />
              {isFieldChanged('route') && (
                <div className="original-diff-indicator">
                  <span className="diff-label">OCR:</span>
                  <span className="diff-val">{original?.route || '(empty)'}</span>
                  {!readOnly && (
                    <button
                      type="button"
                      className="btn-link-restore"
                      onClick={() => onRestoreOriginalField(medicine.medicineId, 'route')}
                    >
                      Restore
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Row 4: Duration, Quantity, Notes */}
          <div className="fields-grid-3">
            <div className="field-control">
              <label className="field-label">Duration</label>
              <div className="input-compound">
                <input
                  type="text"
                  className="form-input input-num"
                  placeholder="e.g. 7"
                  value={current.duration.value || ''}
                  onChange={(e) => handleInputChange('durationValue', e.target.value)}
                  disabled={readOnly}
                  aria-label="Duration value"
                />
                <input
                  type="text"
                  className="form-input input-unit"
                  placeholder="unit (days)"
                  value={current.duration.unit || ''}
                  onChange={(e) => handleInputChange('durationUnit', e.target.value)}
                  disabled={readOnly}
                  aria-label="Duration unit"
                />
              </div>
              {(isFieldChanged('durationValue') || isFieldChanged('durationUnit')) && (
                <div className="original-diff-indicator">
                  <span className="diff-label">OCR:</span>
                  <span className="diff-val">
                    {original?.duration.value
                      ? `${original.duration.value} ${original.duration.unit || ''}`
                      : '(empty)'}
                  </span>
                  {!readOnly && (
                    <button
                      type="button"
                      className="btn-link-restore"
                      onClick={() => {
                        onRestoreOriginalField(medicine.medicineId, 'durationValue');
                        onRestoreOriginalField(medicine.medicineId, 'durationUnit');
                      }}
                    >
                      Restore
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="field-control">
              <label className="field-label">Quantity</label>
              <div className="input-compound">
                <input
                  type="text"
                  className="form-input input-num"
                  placeholder="e.g. 21"
                  value={current.quantity.value || ''}
                  onChange={(e) => handleInputChange('quantityValue', e.target.value)}
                  disabled={readOnly}
                  aria-label="Quantity value"
                />
                <input
                  type="text"
                  className="form-input input-unit"
                  placeholder="unit (capsules)"
                  value={current.quantity.unit || ''}
                  onChange={(e) => handleInputChange('quantityUnit', e.target.value)}
                  disabled={readOnly}
                  aria-label="Quantity unit"
                />
              </div>
              {(isFieldChanged('quantityValue') || isFieldChanged('quantityUnit')) && (
                <div className="original-diff-indicator">
                  <span className="diff-label">OCR:</span>
                  <span className="diff-val">
                    {original?.quantity.value
                      ? `${original.quantity.value} ${original.quantity.unit || ''}`
                      : '(empty)'}
                  </span>
                  {!readOnly && (
                    <button
                      type="button"
                      className="btn-link-restore"
                      onClick={() => {
                        onRestoreOriginalField(medicine.medicineId, 'quantityValue');
                        onRestoreOriginalField(medicine.medicineId, 'quantityUnit');
                      }}
                    >
                      Restore
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="field-control">
              <label htmlFor={`notes-${medicine.medicineId}`} className="field-label">
                Instructions / Notes
              </label>
              <input
                id={`notes-${medicine.medicineId}`}
                type="text"
                className="form-input"
                placeholder="e.g. Finish full course"
                value={current.notes || ''}
                onChange={(e) => handleInputChange('notes', e.target.value)}
                disabled={readOnly}
              />
              {isFieldChanged('notes') && (
                <div className="original-diff-indicator">
                  <span className="diff-label">OCR:</span>
                  <span className="diff-val">{original?.notes || '(empty)'}</span>
                  {!readOnly && (
                    <button
                      type="button"
                      className="btn-link-restore"
                      onClick={() => onRestoreOriginalField(medicine.medicineId, 'notes')}
                    >
                      Restore
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Row actions */}
          {!readOnly && (
            <footer className="card-footer-actions">
              {hasModifications && (
                <button
                  type="button"
                  className="btn-text-action"
                  onClick={() => onRestoreOriginalValues(medicine.medicineId)}
                  aria-label="Restore all original values for this medicine"
                >
                  ↺ Restore Original Row Values
                </button>
              )}

              <button
                type="button"
                className="btn-danger-outline btn-sm"
                onClick={() => setShowRemovalPrompt(true)}
                aria-label="Remove this medicine entry"
              >
                ✕ Remove Medicine
              </button>
            </footer>
          )}
        </div>
      )}
    </article>
  );
};
