import React from 'react';
import { Link } from 'react-router-dom';
import { usePrescriptionReviewAvailability } from './review-availability';

export interface ReviewAndEditButtonProps {
  readonly prescriptionId: string;
  readonly className?: string;
  readonly disabledClassName?: string;
  readonly showBadge?: boolean;
  readonly onClick?: () => void;
}

/**
 * Reusable Review & Edit Action Button component.
 *
 * Behavior:
 * - When available: Renders an active, accessible Link to the review workspace.
 * - When unavailable: Renders a clean disabled button with a "Pending V3" badge and explanatory tooltip,
 *   preventing misleading navigation to a locked page.
 */
export const ReviewAndEditButton: React.FC<ReviewAndEditButtonProps> = ({
  prescriptionId,
  className = 'cc-button cc-button--secondary text-xs',
  disabledClassName = 'cc-button cc-button--secondary text-xs opacity-60 cursor-not-allowed',
  showBadge = true,
  onClick,
}) => {
  const availability = usePrescriptionReviewAvailability(prescriptionId);

  if (!availability.isAvailable) {
    return (
      <div
        className="inline-flex items-center gap-1.5 review-action-control disabled"
        title={availability.disabledTooltip}
      >
        <button
          type="button"
          disabled
          aria-disabled="true"
          className={disabledClassName}
          style={{ pointerEvents: 'auto' }}
        >
          Review &amp; Edit
        </button>
        {showBadge && (
          <span
            className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-amber-500/15 text-amber-400 border border-amber-500/30 review-pending-badge"
            title="V3 review is disabled in this application configuration"
          >
            V3 disabled
          </span>
        )}
      </div>
    );
  }

  return (
    <Link
      to={availability.reviewUrl}
      className={className}
      title="Review, edit, and confirm prescription transcription"
      onClick={onClick}
    >
      Review &amp; Edit
    </Link>
  );
};
