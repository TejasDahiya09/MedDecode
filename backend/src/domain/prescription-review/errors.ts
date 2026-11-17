export type PrescriptionReviewErrorCode =
  | "REVIEW_INVALID"
  | "REVIEW_STALE"
  | "REVIEW_IMMUTABLE"
  | "REVIEW_INVALID_TRANSITION"
  | "REVIEW_MEDICINE_NOT_FOUND"
  | "REVIEW_DUPLICATE_MEDICINE"
  | "REVIEW_COMMAND_CONFLICT";

export class PrescriptionReviewError extends Error {
  constructor(
    readonly code: PrescriptionReviewErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PrescriptionReviewError";
  }
}
