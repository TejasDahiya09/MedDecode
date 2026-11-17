import { useMemo } from 'react';
import {
  isPrescriptionReviewFeatureEnabled,
  isFictionalDemoScenario,
} from './prescription-review-api';

/**
 * Contract describing the availability state of the Prescription Review feature.
 */
export interface PrescriptionReviewAvailability {
  readonly isEnabled: boolean;
  readonly isAvailable: boolean;
  readonly isDemo: boolean;
  readonly badgeText: string;
  readonly disabledTooltip: string;
  readonly reviewUrl: string;
}

/**
 * Checks whether Prescription Review is available for a given prescription.
 *
 * Rules:
 * 1. Fictional demo scenarios ('scenario-*') are available in development/demo mode.
 * 2. Real prescriptions require the V3 review feature flag to be explicitly enabled (VITE_PRESCRIPTION_REVIEW_ENABLED=true).
 * 3. In normal production builds, review is disabled pending hosted V3 database migration deployment.
 */
export function isPrescriptionReviewAvailable(prescriptionId?: string): boolean {
  if (!prescriptionId) return false;
  if (isFictionalDemoScenario(prescriptionId)) return true;
  return isPrescriptionReviewFeatureEnabled();
}

/**
 * Derives comprehensive availability metadata for a prescription review action.
 */
export function getPrescriptionReviewAvailability(
  prescriptionId?: string
): PrescriptionReviewAvailability {
  const isDemo = Boolean(prescriptionId && isFictionalDemoScenario(prescriptionId));
  const isEnabled = isPrescriptionReviewFeatureEnabled();
  const isAvailable = isDemo || isEnabled;

  return {
    isEnabled,
    isAvailable,
    isDemo,
    badgeText: isAvailable ? (isDemo ? 'Demo' : 'Active') : 'Pending V3',
    disabledTooltip:
      'Prescription review is disabled in this application configuration. Contact the project operator to enable the reviewed V3 workflow.',
    reviewUrl: prescriptionId
      ? `/prescriptions/${prescriptionId}/review${isDemo ? '?mock=true&review=true' : ''}`
      : '/prescriptions',
  };
}

/**
 * Hook for consuming prescription review availability in React components.
 */
export function usePrescriptionReviewAvailability(
  prescriptionId?: string
): PrescriptionReviewAvailability {
  return useMemo(
    () => getPrescriptionReviewAvailability(prescriptionId),
    [prescriptionId]
  );
}
