import type {
  ProcessingJobStore,
  SubmitProcessingJobInput
} from "../../src/repositories/processing-job.store.js";
import { INTELLIGENCE_JOB_TYPE, type IntelligenceJobRecord } from "../../src/types/intelligence-jobs.js";
import type {
  ProcessingStatusResult,
  ProcessingSubmissionResult
} from "../../src/types/processing-jobs.js";

const copy = <T>(value: T): T => structuredClone(value);

export class InMemoryProcessingJobStore implements ProcessingJobStore {
  readonly submissions: SubmitProcessingJobInput[] = [];
  readonly statusReads: Array<{ userId: string; prescriptionId: string }> = [];
  readonly ownedPrescriptions = new Set<string>();
  readonly resultPrescriptions = new Set<string>();
  private readonly jobs = new Map<string, IntelligenceJobRecord>();
  failure: Error | null = null;

  constructor(private readonly options: { readonly now: () => string; readonly uuid: () => string }) {}

  private key(userId: string, prescriptionId: string): string {
    return `${userId}:${prescriptionId}`;
  }

  own(userId: string, prescriptionId: string): void {
    this.ownedPrescriptions.add(this.key(userId, prescriptionId));
  }

  markResult(userId: string, prescriptionId: string): void {
    this.resultPrescriptions.add(this.key(userId, prescriptionId));
  }

  setStatus(userId: string, prescriptionId: string, status: IntelligenceJobRecord["status"]): void {
    const key = this.key(userId, prescriptionId);
    const existing = this.jobs.get(key);
    if (!existing) throw new Error("Synthetic job is missing.");
    this.jobs.set(key, {
      ...existing,
      status,
      startedAt: status === "processing" ? this.options.now() : existing.startedAt,
      completedAt: status === "completed" || status === "failed" ? this.options.now() : existing.completedAt
    });
  }

  async submitOwned(input: SubmitProcessingJobInput): Promise<ProcessingSubmissionResult> {
    this.submissions.push(copy(input));
    if (this.failure) throw this.failure;
    const key = this.key(input.userId, input.prescriptionId);
    if (!this.ownedPrescriptions.has(key)) return { kind: "prescription_not_found" };
    if (this.resultPrescriptions.has(key)) return { kind: "result_exists" };
    const existing = this.jobs.get(key);
    if (existing && (existing.status === "queued" || existing.status === "processing")) {
      return { kind: "active", job: copy(existing) };
    }
    const job: IntelligenceJobRecord = {
      id: this.options.uuid(), userId: input.userId, prescriptionId: input.prescriptionId,
      jobType: INTELLIGENCE_JOB_TYPE, requestedAnalysis: copy(input.requestedAnalysis),
      status: "queued", createdAt: this.options.now(), startedAt: null,
      completedAt: null, failure: null
    };
    this.jobs.set(key, copy(job));
    return { kind: "created", job: copy(job) };
  }

  async findOwnedStatus(userId: string, prescriptionId: string): Promise<ProcessingStatusResult> {
    this.statusReads.push({ userId, prescriptionId });
    if (this.failure) throw this.failure;
    const key = this.key(userId, prescriptionId);
    if (!this.ownedPrescriptions.has(key)) return { kind: "prescription_not_found" };
    const job = this.jobs.get(key);
    return job ? { kind: "job", job: copy(job) } : { kind: "none" };
  }
}
