import {
  createReviewFingerprint,
  validatePrescriptionReviewContractV1,
  type PrescriptionReviewContractV1,
} from "../domain/prescription-review/index.js";
import type { IntelligenceSuccessV1 } from "../types/intelligence-contract-v1.js";
import { validateIntelligenceResponseV1 } from "./intelligence-contract-v1.validator.js";
import { runJsonSubprocess, type CatalogueEnvironment } from "./local-python-intelligence.client.js";

export interface ConfirmedReviewIntelligenceInput {
  readonly jobId: string;
  readonly prescriptionId: string;
  readonly review: PrescriptionReviewContractV1;
}

export interface ConfirmedReviewIntelligenceClient {
  analyzeConfirmed(input: ConfirmedReviewIntelligenceInput, signal?: AbortSignal): Promise<IntelligenceSuccessV1>;
}

export class ConfirmedReviewIntelligenceError extends Error {
  constructor(readonly code: "INVALID_REVIEW" | "STALE_FINGERPRINT" | "PROCESSING_FAILED") {
    super("Confirmed review intelligence failed safely.");
    this.name = "ConfirmedReviewIntelligenceError";
  }
}

export class LocalConfirmedReviewIntelligenceClient implements ConfirmedReviewIntelligenceClient {
  constructor(private readonly options: {
    pythonExecutable: string;
    intelligenceDirectory: string;
    officialCatalogue?: boolean;
    catalogueEnvironment?: CatalogueEnvironment;
    timeoutMs?: number;
    run?: typeof runJsonSubprocess;
  }) {}

  async analyzeConfirmed(input: ConfirmedReviewIntelligenceInput, signal?: AbortSignal): Promise<IntelligenceSuccessV1> {
    let review: PrescriptionReviewContractV1;
    try { review = validatePrescriptionReviewContractV1(input.review); }
    catch { throw new ConfirmedReviewIntelligenceError("INVALID_REVIEW"); }
    if (review.status !== "confirmed" || review.prescriptionId !== input.prescriptionId ||
        review.canonicalInputFingerprint === null) {
      throw new ConfirmedReviewIntelligenceError("INVALID_REVIEW");
    }
    if (createReviewFingerprint(review).value !== review.canonicalInputFingerprint.value) {
      throw new ConfirmedReviewIntelligenceError("STALE_FINGERPRINT");
    }
    const request = {
      schema_version: "meddecode.confirmed-review-intelligence.v1",
      job_id: input.jobId,
      prescription_id: input.prescriptionId,
      revision_id: review.revisionId,
      input_fingerprint: review.canonicalInputFingerprint.value,
      medicines: review.medicines.filter((medicine) => medicine.status === "active")
        .sort((left, right) => left.position - right.position)
        .map((medicine) => ({ medicine_id: medicine.medicineId, position: medicine.position, fields: medicine.current })),
    };
    let output: string;
    try {
      output = await (this.options.run ?? runJsonSubprocess)({
        executable: this.options.pythonExecutable,
        args: ["-m", "app.integration.confirmed_review_worker", ...(this.options.officialCatalogue ? ["--official-catalogue"] : [])],
        cwd: this.options.intelligenceDirectory,
        input: JSON.stringify(request),
        ...(signal === undefined ? {} : { signal }),
        ...(this.options.timeoutMs === undefined ? { timeoutMs: 30_000 } : { timeoutMs: this.options.timeoutMs }),
        ...(this.options.catalogueEnvironment === undefined ? {} : { catalogueEnvironment: this.options.catalogueEnvironment }),
      });
    } catch { throw new ConfirmedReviewIntelligenceError("PROCESSING_FAILED"); }
    try {
      const result = validateIntelligenceResponseV1(JSON.parse(output), { jobId: input.jobId, prescriptionId: input.prescriptionId });
      if (result.status === "failed") throw new Error("failed result");
      return result;
    } catch { throw new ConfirmedReviewIntelligenceError("PROCESSING_FAILED"); }
  }
}
