import type {
  CreateIntelligenceJobInput,
  IntelligenceJobRepository,
  PrescriptionOwnershipRepository,
} from "../../src/repositories/intelligence-job.repository.js";
import {
  IntelligenceResultPersistenceError,
  type IntelligenceResultPersistence,
} from "../../src/services/intelligence-result.persistence.js";
import { validateIntelligenceResponseV1 } from "../../src/services/intelligence-contract-v1.validator.js";
import type { IntelligenceResponseV1 } from "../../src/types/intelligence-contract-v1.js";
import {
  INTELLIGENCE_JOB_TYPE,
  type IntelligenceJobFailure,
  type IntelligenceJobRecord,
  type OwnedProcessablePrescription,
  type StoredIntelligenceResult,
} from "../../src/types/intelligence-jobs.js";

const clone = <T>(value: T): T => structuredClone(value);
const snapshot = <T extends object>(value: T): Readonly<T> => Object.freeze(clone(value));

export class InMemoryPrescriptionOwnershipRepository implements PrescriptionOwnershipRepository {
  readonly calls: Array<{ userId: string; prescriptionId: string }> = [];
  constructor(private readonly records: readonly OwnedProcessablePrescription[]) {}
  async findOwnedProcessable(userId: string, prescriptionId: string) {
    this.calls.push({ userId, prescriptionId });
    const record = this.records.find((item) => item.id === prescriptionId && item.userId === userId);
    return record ? snapshot(record) : null;
  }
}

export class InMemoryIntelligenceJobRepository implements IntelligenceJobRepository {
  private readonly jobs = new Map<string, IntelligenceJobRecord>();
  private readonly tupleToJob = new Map<string, string>();
  failNextComplete = false;
  failNextFail = false;
  constructor(private readonly options: { now: () => string; uuid: () => string }) {}

  private tuple(input: Pick<CreateIntelligenceJobInput, "userId" | "prescriptionId">) {
    return `${input.userId}:${input.prescriptionId}:${INTELLIGENCE_JOB_TYPE}`;
  }
  private get(jobId: string): IntelligenceJobRecord {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error("JOB_NOT_FOUND");
    return job;
  }
  private put(job: IntelligenceJobRecord): IntelligenceJobRecord {
    this.jobs.set(job.id, snapshot(job));
    return snapshot(job);
  }
  async createOrGetActive(input: CreateIntelligenceJobInput) {
    const key = this.tuple(input);
    const existingId = this.tupleToJob.get(key);
    if (existingId) {
      const existing = this.get(existingId);
      if (existing.status === "queued" || existing.status === "processing") return snapshot(existing);
      throw new Error("TERMINAL_JOB_EXISTS");
    }
    const job: IntelligenceJobRecord = {
      id: this.options.uuid(),
      userId: input.userId,
      prescriptionId: input.prescriptionId,
      jobType: INTELLIGENCE_JOB_TYPE,
      requestedAnalysis: snapshot(input.requestedAnalysis),
      status: "queued",
      createdAt: this.options.now(),
      startedAt: null,
      completedAt: null,
      failure: null,
    };
    this.tupleToJob.set(key, job.id);
    return this.put(job);
  }
  async findById(jobId: string) {
    const job = this.jobs.get(jobId);
    return job ? snapshot(job) : null;
  }
  async findOwned(jobId: string, userId: string) {
    const job = this.jobs.get(jobId);
    return job?.userId === userId ? snapshot(job) : null;
  }
  async claim(jobId: string) {
    const job = this.get(jobId);
    if (job.status !== "queued") throw new Error("INVALID_TRANSITION");
    return this.put({ ...job, status: "processing", startedAt: this.options.now() });
  }
  async complete(jobId: string) {
    if (this.failNextComplete) {
      this.failNextComplete = false;
      throw new Error("SYNTHETIC_COMPLETE_FAILURE");
    }
    const job = this.get(jobId);
    if (job.status !== "processing") throw new Error("INVALID_TRANSITION");
    return this.put({ ...job, status: "completed", completedAt: this.options.now() });
  }
  async fail(jobId: string, failure: IntelligenceJobFailure) {
    if (this.failNextFail) {
      this.failNextFail = false;
      throw new Error("SYNTHETIC_FAIL_FAILURE");
    }
    const job = this.get(jobId);
    if (job.status !== "queued" && job.status !== "processing") throw new Error("INVALID_TRANSITION");
    return this.put({ ...job, status: "failed", completedAt: this.options.now(), failure: snapshot(failure) });
  }
  snapshots() {
    return [...this.jobs.values()].map((job) => snapshot(job));
  }
}

export class InMemoryIntelligenceResultPersistence implements IntelligenceResultPersistence {
  private readonly records = new Map<string, StoredIntelligenceResult>();
  failNext = false;
  persistCalls = 0;
  constructor(private readonly now: () => string) {}
  async persistValidated(job: IntelligenceJobRecord, response: IntelligenceResponseV1) {
    this.persistCalls += 1;
    if (this.failNext) {
      this.failNext = false;
      throw new IntelligenceResultPersistenceError("PERSISTENCE_FAILED");
    }
    validateIntelligenceResponseV1(response, { jobId: job.id, prescriptionId: job.prescriptionId });
    const existing = this.records.get(job.id);
    if (existing) {
      if (JSON.stringify(existing.response) !== JSON.stringify(response)) {
        throw new IntelligenceResultPersistenceError("CONFLICTING_REPLAY");
      }
      return snapshot(existing);
    }
    const stored: StoredIntelligenceResult = {
      jobId: job.id,
      prescriptionId: job.prescriptionId,
      response: clone(response),
      storedAt: this.now(),
    };
    this.records.set(job.id, snapshot(stored));
    return snapshot(stored);
  }
  async findByJobId(jobId: string) {
    const record = this.records.get(jobId);
    return record ? snapshot(record) : null;
  }
}
