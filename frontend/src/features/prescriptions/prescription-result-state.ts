import type { PrescriptionReviewContractV1 } from '../prescription-review/types';
import type { AnalysisResultOutcome, ProcessingJobInfo } from './prescription-api';

export function isResultCurrentForReview(
  outcome: AnalysisResultOutcome | null,
  reviewStatus: PrescriptionReviewContractV1['status'] | null | undefined,
  processing: ProcessingJobInfo | null,
): boolean {
  if (outcome?.kind !== 'available') return false;
  if (reviewStatus !== 'confirmed') return true;
  return processing !== null && outcome.result.job_id === processing.job_id;
}
