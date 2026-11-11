import type { VerifiedIdentity } from "./auth.service.js";
import type { IntelligenceClient } from "./intelligence-client.js";
import {
  IntelligenceContractValidationError,
  validateIntelligenceRequestV1,
  validateIntelligenceResponseV1,
} from "./intelligence-contract-v1.validator.js";
import type { DocumentReferenceProvider } from "./document-reference.provider.js";
import type { IntelligenceResultPersistence } from "./intelligence-result.persistence.js";
import type {
  IntelligenceJobRepository,
  PrescriptionOwnershipRepository,
} from "../repositories/intelligence-job.repository.js";
import type { IntelligenceRequestV1 } from "../types/intelligence-contract-v1.js";
import type {
  IntelligenceJobFailure,
  IntelligenceJobRecord,
  RequestedAnalysis,
} from "../types/intelligence-jobs.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class PrescriptionProcessingError extends Error {
  constructor(readonly code:
    | "AUTHENTICATION_REQUIRED"
    | "INVALID_PRESCRIPTION_ID"
    | "INVALID_REQUESTED_ANALYSIS"
    | "PRESCRIPTION_NOT_FOUND"
    | "JOB_NOT_FOUND"
    | "JOB_CLAIM_FAILED"
    | "PROCESSING_FAILED") {
    super("Prescription processing operation failed safely.");
    this.name = "PrescriptionProcessingError";
  }
}

export interface PrescriptionProcessingDependencies {
  readonly prescriptions: PrescriptionOwnershipRepository;
  readonly jobs: IntelligenceJobRepository;
  readonly documents: DocumentReferenceProvider;
  readonly intelligence: IntelligenceClient;
  readonly results: IntelligenceResultPersistence;
}

function validUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

function validateIdentity(identity: Readonly<VerifiedIdentity> | undefined): string {
  if (!identity || !validUuid(identity.userId)) {
    throw new PrescriptionProcessingError("AUTHENTICATION_REQUIRED");
  }
  return identity.userId;
}

function validateRequestedAnalysis(value: RequestedAnalysis): RequestedAnalysis {
  const keys = ["extract_prescription", "match_medicines", "find_alternatives", "generate_recommendations"] as const;
  if (typeof value !== "object" || value === null ||
      keys.some((key) => typeof value[key] !== "boolean") ||
      value.find_alternatives !== false) {
    throw new PrescriptionProcessingError("INVALID_REQUESTED_ANALYSIS");
  }
  return Object.freeze({ ...value });
}

async function safelyFail(
  jobs: IntelligenceJobRepository,
  jobId: string,
  failure: IntelligenceJobFailure,
): Promise<void> {
  try {
    await jobs.fail(jobId, failure);
  } catch {
    // Preserve the original safe processing failure. Production reconciliation
    // requires a durable transaction/worker design and is outside Phase 5.5a.
  }
}

export class PrescriptionProcessingService {
  constructor(private readonly dependencies: PrescriptionProcessingDependencies) {}

  async submitProcessingRequest(input: {
    readonly identity: Readonly<VerifiedIdentity> | undefined;
    readonly prescriptionId: string;
    readonly requestedAnalysis: RequestedAnalysis;
  }): Promise<IntelligenceJobRecord> {
    const userId = validateIdentity(input.identity);
    if (!validUuid(input.prescriptionId)) {
      throw new PrescriptionProcessingError("INVALID_PRESCRIPTION_ID");
    }
    const requestedAnalysis = validateRequestedAnalysis(input.requestedAnalysis);
    const prescription = await this.dependencies.prescriptions.findOwnedProcessable(
      userId,
      input.prescriptionId,
    );
    if (!prescription || prescription.userId !== userId ||
        !prescription.storageBucket.trim() || !prescription.objectKey.trim()) {
      throw new PrescriptionProcessingError("PRESCRIPTION_NOT_FOUND");
    }
    return this.dependencies.jobs.createOrGetActive({
      userId,
      prescriptionId: prescription.id,
      requestedAnalysis,
    });
  }

  async executeJob(jobId: string): Promise<IntelligenceJobRecord> {
    if (!validUuid(jobId)) throw new PrescriptionProcessingError("JOB_NOT_FOUND");
    let job: IntelligenceJobRecord;
    try {
      job = await this.dependencies.jobs.claim(jobId);
    } catch {
      throw new PrescriptionProcessingError("JOB_CLAIM_FAILED");
    }

    const prescription = await this.dependencies.prescriptions.findOwnedProcessable(
      job.userId,
      job.prescriptionId,
    );
    if (!prescription || prescription.userId !== job.userId || prescription.id !== job.prescriptionId) {
      await safelyFail(this.dependencies.jobs, job.id, { category: "PRESCRIPTION_UNAVAILABLE" });
      throw new PrescriptionProcessingError("PROCESSING_FAILED");
    }

    let document: Awaited<ReturnType<DocumentReferenceProvider["createReference"]>>;
    try {
      document = await this.dependencies.documents.createReference(prescription);
    } catch {
      await safelyFail(this.dependencies.jobs, job.id, { category: "DOCUMENT_REFERENCE_FAILED" });
      throw new PrescriptionProcessingError("PROCESSING_FAILED");
    }

    const request: IntelligenceRequestV1 = {
      schema_version: "1.0",
      job_id: job.id,
      prescription_id: job.prescriptionId,
      document,
      requested_analysis: { ...job.requestedAnalysis },
    };
    validateIntelligenceRequestV1(request);

    let response;
    try {
      const candidate = await this.dependencies.intelligence.analyze(request);
      response = validateIntelligenceResponseV1(candidate, {
        jobId: job.id,
        prescriptionId: job.prescriptionId,
      });
      if (response.status !== "failed" &&
          job.requestedAnalysis.find_alternatives === false &&
          response.medicines.some((medicine) =>
            Array.isArray(medicine.alternatives) && medicine.alternatives.length > 0)) {
        throw new IntelligenceContractValidationError(
          "response alternatives were returned when they were not requested.",
        );
      }
    } catch (error) {
      const category = error instanceof IntelligenceContractValidationError
        ? "INTELLIGENCE_RESPONSE_INVALID"
        : "INTELLIGENCE_TRANSPORT_FAILED";
      await safelyFail(this.dependencies.jobs, job.id, { category });
      throw new PrescriptionProcessingError("PROCESSING_FAILED");
    }

    try {
      await this.dependencies.results.persistValidated(job, response);
    } catch {
      await safelyFail(this.dependencies.jobs, job.id, { category: "RESULT_PERSISTENCE_FAILED" });
      throw new PrescriptionProcessingError("PROCESSING_FAILED");
    }

    if (response.status === "failed") {
      try {
        return await this.dependencies.jobs.fail(job.id, {
          category: "INTELLIGENCE_REJECTED",
          contractCode: response.error.code,
        });
      } catch {
        // The validated failure is already persisted. Leave the job unchanged
        // for explicit reconciliation rather than pretending finalization was atomic.
        throw new PrescriptionProcessingError("PROCESSING_FAILED");
      }
    }
    try {
      return await this.dependencies.jobs.complete(job.id);
    } catch {
      // The validated result is already persisted. Leave the job unchanged for
      // explicit reconciliation rather than deleting or overwriting the result.
      throw new PrescriptionProcessingError("PROCESSING_FAILED");
    }
  }
}
