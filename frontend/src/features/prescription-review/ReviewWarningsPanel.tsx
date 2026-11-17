import React from 'react';
import type { ReviewWarningItem } from './types';

interface ReviewWarningsPanelProps {
  warnings: ReviewWarningItem[];
  unresolvedCount?: number;
  onFocusMedicine?: (medicineId: string) => void;
}

export const ReviewWarningsPanel: React.FC<ReviewWarningsPanelProps> = ({
  warnings,
  unresolvedCount = 0,
  onFocusMedicine,
}) => {
  return (
    <div className="review-warnings-container" role="region" aria-label="Review warnings and guidance">
      <div className="review-warnings-header">
        <div className="warnings-title-row">
          <span className="warning-icon-pill" aria-hidden="true">⚠️</span>
          <h3 className="warnings-heading">Review Guidance & Warnings</h3>
        </div>
        <div className="warnings-badge-group">
          {warnings.length > 0 && (
            <span className="warnings-count-pill warning" aria-label={`${warnings.length} warnings detected`}>
              {warnings.length} {warnings.length === 1 ? 'Warning' : 'Warnings'}
            </span>
          )}
          {unresolvedCount > 0 && (
            <span className="unresolved-count-pill" aria-label={`${unresolvedCount} fields need attention`}>
              {unresolvedCount} Incomplete {unresolvedCount === 1 ? 'Field' : 'Fields'}
            </span>
          )}
        </div>
      </div>

      <div className="clinical-disclaimer-card" role="note">
        <span className="disclaimer-badge">Clinical Notice</span>
        <p className="disclaimer-text">
          Reviewing ensures digitized text faithfully mirrors your prescription slip. MedDecode does{' '}
          <strong>not</strong> evaluate clinical safety, drug interactions, or dosage suitability. Always consult your
          prescribing clinician or pharmacist with clinical questions.
        </p>
      </div>

      {warnings.length > 0 ? (
        <ul className="review-warnings-list" aria-label="List of prescription review warnings">
          {warnings.map((warn, idx) => (
            <li
              key={`${warn.code}-${idx}`}
              className={`review-warning-item severity-${warn.severity}`}
              onClick={() => warn.medicineId && onFocusMedicine && onFocusMedicine(warn.medicineId)}
            >
              <div className="warning-indicator-bar" />
              <div className="warning-content">
                <div className="warning-message-row">
                  <span className="warning-severity-tag">{warn.severity.toUpperCase()}</span>
                  <p className="warning-message">{warn.message}</p>
                </div>
                {warn.field && (
                  <span className="warning-field-tag">
                    Affected field: <strong>{warn.field}</strong>
                  </span>
                )}
              </div>
              {warn.medicineId && onFocusMedicine && (
                <button
                  type="button"
                  className="jump-to-med-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onFocusMedicine(warn.medicineId!);
                  }}
                  aria-label={`Jump to medicine for warning: ${warn.message}`}
                >
                  Locate
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <div className="warnings-empty-state">
          <span className="all-clear-icon">✓</span>
          <p className="all-clear-text">No critical warnings flagged. All active medicines have high OCR confidence and core dosage instructions.</p>
        </div>
      )}
    </div>
  );
};
