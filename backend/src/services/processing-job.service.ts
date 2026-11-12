import { AppError } from "../middleware/error.middleware.js";
import {
  ProcessingJobStoreUnavailableError,
  type ProcessingJobStore
} from "../repositories/processing-job.store.js";
import {
  DEFAULT_REQUESTED_ANALYSIS,
  INTELLIGENCE_JOB_TYPE,
  type IntelligenceJobRecord
} from "../types/intelligence-jobs.js";
import type {
  ProcessingStatusResponse,
  ProcessingSubmissionResponse
} from "../types/processing-jobs.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = new Set(["queued", "processing", "completed", "failed"]);

function invalidId(): AppError {
  return new AppError(
    400,
    "INVALID_PRESCRIPTION_ID",
    "Prescription ID must be a valid UUID."
  );
}

function notFound(): AppError {
  return new AppError(404, "PRESCRIPTION_NOT_FOUND", "Prescription not found.");
}

function unavailable(): AppError {
  return new AppError(
    503,
    "PROCESSING_SERVICE_UNAVAILABLE",
    "Prescription processing is not configured."
  );
}

function validatePrescriptionId(prescriptionId: string): void {
  if (!UUID_PATTERN.test(prescriptionId)) throw invalidId();
}

function validateJob(
  job: IntelligenceJobRecord,
  userId: string,
  prescriptionId: string
): void {
  if (
    job.userId !== userId ||
    job.prescriptionId !== prescriptionId ||
    job.jobType !== INTELLIGENCE_JOB_TYPE ||
    !UUID_PATTERN.test(job.id) ||
    !STATUSES.has(job.status) ||
    typeof job.createdAt !== "string" ||
    (job.startedAt !== null && typeof job.startedAt !== "string") ||
    (job.completedAt !== null && typeof job.completedAt !== "string")
  ) {
    throw new Error("Processing store returned an invalid job record.");
  }
}

async function safely<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof ProcessingJobStoreUnavailableError) throw unavailable();
    throw unavailable();
  }
}

export class ProcessingJobService {
  constructor(private readonly store: ProcessingJobStore) {}

  async submit(
    userId: string,
    prescriptionId: string
  ): Promise<{ readonly statusCode: 200 | 202; readonly body: ProcessingSubmissionResponse }> {
    validatePrescriptionId(prescriptionId);
    const result = await safely(() => this.store.submitOwned({
      userId,
      prescriptionId,
      requestedAnalysis: DEFAULT_REQUESTED_ANALYSIS
    }));

    if (result.kind === "prescription_not_found") throw notFound();
    if (result.kind === "not_processable") {
      throw new AppError(
        409,
        "PRESCRIPTION_NOT_PROCESSABLE",
        "Prescription cannot be submitted for processing in its current state."
      );
    }
    if (result.kind === "result_exists") {
      throw new AppError(
        409,
        "PROCESSING_ALREADY_COMPLETED",
        "A final intelligence result already exists for this prescription."
      );
    }

    validateJob(result.job, userId, prescriptionId);
    if (result.job.status !== "queued" && result.job.status !== "processing") {
      throw new Error("Processing store returned a terminal active job.");
    }

    return {
      statusCode: result.kind === "created" ? 202 : 200,
      body: {
        prescription_id: prescriptionId,
        job: {
          id: result.job.id,
          status: result.job.status,
          created_at: result.job.createdAt
        },
        submission: { created: result.kind === "created" }
      }
    };
  }

  async status(userId: string, prescriptionId: string): Promise<ProcessingStatusResponse> {
    validatePrescriptionId(prescriptionId);
    const result = await safely(() =>
      this.store.findOwnedStatus(userId, prescriptionId)
    );

    if (result.kind === "prescription_not_found") throw notFound();
    if (result.kind === "none") {
      return { prescription_id: prescriptionId, processing: null };
    }

    validateJob(result.job, userId, prescriptionId);
    return {
      prescription_id: prescriptionId,
      processing: {
        job_id: result.job.id,
        status: result.job.status,
        created_at: result.job.createdAt,
        started_at: result.job.startedAt,
        completed_at: result.job.completedAt
      }
    };
  }
}
