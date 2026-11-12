import {
  WorkerJobFinalizationError,
  assertValidWorkerCompletionCommand,
  assertValidWorkerFailureCommand,
  type WorkerJobFinalizationStore,
} from "../../src/repositories/worker-job-finalization.store.js";
import type {
  WorkerJobCompletionCommand,
  WorkerJobFailureOutcome,
  WorkerJobCompletionOutcome,
  WorkerJobFailureCommand,
  WorkerProcessingFailure,
} from "../../src/types/worker-jobs.js";

type State = {
  readonly jobId: string;
  readonly prescriptionId: string;
  readonly userId: string;
  readonly workerInstanceId: string;
  readonly claimGeneration: number;
  readonly leaseExpiresAt: string;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly status: "processing" | "queued" | "completed" | "failed";
  readonly prescriptionStatus: "processing" | "queued" | "completed" | "completed_with_warnings" | "failed";
  readonly completion: WorkerJobCompletionCommand | null;
  readonly failure: WorkerProcessingFailure | null;
  readonly availableAt: string | null;
};

const clone = <T>(value: T): T => structuredClone(value);
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
};

/** Test-only model of required future PostgreSQL atomic checks; it is not a DB adapter. */
export class InMemoryWorkerJobFinalizationStore implements WorkerJobFinalizationStore {
  private state: State;

  constructor(input: Omit<State, "completion" | "failure" | "availableAt"> & {
    readonly completion?: WorkerJobCompletionCommand | null;
    readonly failure?: WorkerProcessingFailure | null;
    readonly availableAt?: string | null;
  }, private readonly now: () => number) {
    this.state = clone({ completion: null, failure: null, availableAt: null, ...input });
  }

  private assertCurrent(input: {
    jobId: string;
    prescriptionId: string;
    workerInstanceId: string;
    claimGeneration: number;
  }, allowTerminalReplay: boolean): void {
    const state = this.state;
    if (input.jobId !== state.jobId || input.prescriptionId !== state.prescriptionId) {
      throw new WorkerJobFinalizationError("CORRELATION_MISMATCH");
    }
    if (input.workerInstanceId !== state.workerInstanceId) {
      throw new WorkerJobFinalizationError("WRONG_WORKER");
    }
    if (input.claimGeneration !== state.claimGeneration) {
      throw new WorkerJobFinalizationError("STALE_CLAIM");
    }
    if (allowTerminalReplay && (state.status === "completed" || state.status === "failed")) return;
    if (state.status !== "processing") throw new WorkerJobFinalizationError("ALREADY_FINALIZED");
    if (Date.parse(state.leaseExpiresAt) <= this.now()) {
      throw new WorkerJobFinalizationError("LEASE_EXPIRED");
    }
  }

  async completeOwned(input: WorkerJobCompletionCommand): Promise<WorkerJobCompletionOutcome> {
    assertValidWorkerCompletionCommand(input);
    this.assertCurrent(input, true);
    if (this.state.status === "completed") {
      if (!this.state.completion || canonical(this.state.completion.result) !== canonical(input.result)) {
        throw new WorkerJobFinalizationError("CONFLICTING_FINALIZATION");
      }
      return Object.freeze({
        jobId: this.state.jobId, prescriptionId: this.state.prescriptionId, jobStatus: "completed",
        prescriptionStatus: this.state.prescriptionStatus as "completed" | "completed_with_warnings",
        replayed: true,
      });
    }
    if (this.state.status === "failed") throw new WorkerJobFinalizationError("ALREADY_FINALIZED");
    const prescriptionStatus = input.result.status;
    this.state = clone({
      ...this.state, status: "completed", prescriptionStatus, completion: input,
      failure: null, availableAt: null,
    });
    return Object.freeze({
      jobId: this.state.jobId, prescriptionId: this.state.prescriptionId, jobStatus: "completed",
      prescriptionStatus, replayed: false,
    });
  }

  async failOwned(input: WorkerJobFailureCommand): Promise<WorkerJobFailureOutcome> {
    assertValidWorkerFailureCommand(input);
    this.assertCurrent(input, true);
    if (this.state.status === "failed") {
      if (!this.state.failure || canonical(this.state.failure) !== canonical(input.failure)) {
        throw new WorkerJobFinalizationError("CONFLICTING_FINALIZATION");
      }
      return Object.freeze({
        jobId: this.state.jobId, prescriptionId: this.state.prescriptionId, jobStatus: "failed",
        prescriptionStatus: "failed", retryEligible: false, terminal: true, availableAt: null,
      });
    }
    if (this.state.status === "completed") throw new WorkerJobFinalizationError("ALREADY_FINALIZED");
    const retryEligible = input.failure.retryable && this.state.attemptCount < this.state.maxAttempts;
    if (retryEligible && input.retryAt === null) throw new WorkerJobFinalizationError("INVALID_COMMAND");
    if (retryEligible && Date.parse(input.retryAt!) <= this.now()) {
      throw new WorkerJobFinalizationError("INVALID_COMMAND");
    }
    const terminal = !retryEligible;
    this.state = clone({
      ...this.state,
      status: terminal ? "failed" : "queued",
      prescriptionStatus: terminal ? "failed" : "queued",
      failure: input.failure,
      availableAt: terminal ? null : input.retryAt,
    });
    return Object.freeze({
      jobId: this.state.jobId, prescriptionId: this.state.prescriptionId,
      jobStatus: this.state.status as "queued" | "failed",
      prescriptionStatus: this.state.prescriptionStatus as "queued" | "failed",
      retryEligible, terminal, availableAt: this.state.availableAt,
    });
  }

  snapshot(): Readonly<State> {
    return Object.freeze(clone(this.state));
  }
}
