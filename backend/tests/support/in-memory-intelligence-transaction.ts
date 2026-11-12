import {
  IntelligenceResultMappingError,
  mapValidatedIntelligenceResult,
} from "../../src/services/intelligence-result.mapper.js";
import type {
  IntelligenceFinalizationInput,
  IntelligenceFinalizationOutcome,
  IntelligenceFinalizationStage,
  IntelligencePersistencePlan,
  IntelligenceResultFinalizationTransaction,
  PersistedIntelligenceStatus,
} from "../../src/types/intelligence-persistence.js";
import type { IntelligenceJobRecord } from "../../src/types/intelligence-jobs.js";

export class InMemoryIntelligenceTransactionError extends Error {
  constructor(readonly code:
    | "OWNERSHIP_MISMATCH"
    | "CORRELATION_MISMATCH"
    | "INVALID_JOB_STATE"
    | "PRESCRIPTION_RESULT_EXISTS"
    | "CONFLICTING_REPLAY"
    | "TERMINAL_RESULT_OVERWRITE"
    | "INJECTED_FAILURE"
    | "MAPPING_REJECTED") {
    super("The synthetic intelligence transaction failed safely.");
    this.name = "InMemoryIntelligenceTransactionError";
  }
}

interface SyntheticPrescriptionState {
  readonly id: string;
  readonly userId: string;
  readonly status: string;
  readonly processingPatch: IntelligencePersistencePlan["prescriptionPatch"] | null;
}

interface SyntheticJobState extends IntelligenceJobRecord {}

interface SyntheticTransactionState {
  readonly jobs: Map<string, SyntheticJobState>;
  readonly prescriptions: Map<string, SyntheticPrescriptionState>;
  /** Mirrors the historical SQL UNIQUE constraint on result.prescription_id. */
  readonly rawResults: Map<string, IntelligencePersistencePlan["rawResult"]>;
  /** Projections share the same prescription-level identity as the stored raw result. */
  readonly projections: Map<string, Pick<IntelligencePersistencePlan, "medicines" | "recommendations" | "warnings">>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function cloneState(state: SyntheticTransactionState): SyntheticTransactionState {
  return {
    jobs: new Map([...state.jobs].map(([key, value]) => [key, clone(value)])),
    prescriptions: new Map([...state.prescriptions].map(([key, value]) => [key, clone(value)])),
    rawResults: new Map([...state.rawResults].map(([key, value]) => [key, clone(value)])),
    projections: new Map([...state.projections].map(([key, value]) => [key, clone(value)])),
  };
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value as Record<string, unknown>)) {
      deepFreeze(item);
    }
  }
  return value;
}

function immutableSnapshot<T>(value: T): Readonly<T> {
  return deepFreeze(clone(value));
}

export class InMemoryIntelligenceFinalizationTransaction
implements IntelligenceResultFinalizationTransaction {
  private state: SyntheticTransactionState;
  private failAt: IntelligenceFinalizationStage | null = null;

  constructor(input: {
    readonly jobs: readonly IntelligenceJobRecord[];
    readonly prescriptions: ReadonlyArray<{ id: string; userId: string; status?: string }>;
  }) {
    this.state = {
      jobs: new Map(input.jobs.map((job) => [job.id, clone(job)])),
      prescriptions: new Map(input.prescriptions.map((prescription) => [prescription.id, {
        id: prescription.id,
        userId: prescription.userId,
        status: prescription.status ?? "processing",
        processingPatch: null,
      }])),
      rawResults: new Map(),
      projections: new Map(),
    };
  }

  injectFailure(stage: IntelligenceFinalizationStage): void {
    this.failAt = stage;
  }

  private maybeFail(stage: IntelligenceFinalizationStage): void {
    if (this.failAt === stage) {
      this.failAt = null;
      throw new InMemoryIntelligenceTransactionError("INJECTED_FAILURE");
    }
  }

  async finalizeAtomically(input: IntelligenceFinalizationInput): Promise<IntelligenceFinalizationOutcome> {
    const currentJob = this.state.jobs.get(input.job.id);
    const prescription = this.state.prescriptions.get(input.job.prescriptionId);
    if (!currentJob || !prescription) {
      throw new InMemoryIntelligenceTransactionError("CORRELATION_MISMATCH");
    }
    if (input.expectedUserId !== currentJob.userId ||
        input.job.userId !== currentJob.userId ||
        input.prescriptionOwnerId !== prescription.userId ||
        currentJob.userId !== prescription.userId) {
      throw new InMemoryIntelligenceTransactionError("OWNERSHIP_MISMATCH");
    }
    if (input.response.job_id !== currentJob.id ||
        input.response.prescription_id !== currentJob.prescriptionId ||
        input.job.prescriptionId !== currentJob.prescriptionId) {
      throw new InMemoryIntelligenceTransactionError("CORRELATION_MISMATCH");
    }

    const existing = this.state.rawResults.get(currentJob.prescriptionId);
    if (existing) {
      if (existing.job_id !== currentJob.id) {
        throw new InMemoryIntelligenceTransactionError("PRESCRIPTION_RESULT_EXISTS");
      }
      if (canonical(existing.result_json) !== canonical(input.response)) {
        throw new InMemoryIntelligenceTransactionError("CONFLICTING_REPLAY");
      }
      const expectedTerminalStatus = input.response.status === "failed" ? "failed" : "completed";
      if (currentJob.status !== expectedTerminalStatus) {
        throw new InMemoryIntelligenceTransactionError("TERMINAL_RESULT_OVERWRITE");
      }
      return Object.freeze({
        jobId: currentJob.id,
        prescriptionId: currentJob.prescriptionId,
        status: input.response.status,
        replayed: true,
      });
    }
    if (currentJob.status !== "processing") {
      throw new InMemoryIntelligenceTransactionError(
        currentJob.status === "completed" || currentJob.status === "failed"
          ? "TERMINAL_RESULT_OVERWRITE"
          : "INVALID_JOB_STATE",
      );
    }

    let plan: IntelligencePersistencePlan;
    try {
      plan = mapValidatedIntelligenceResult({ response: input.response, finalizedAt: input.finalizedAt });
    } catch (error) {
      if (error instanceof IntelligenceResultMappingError) {
        throw new InMemoryIntelligenceTransactionError("MAPPING_REJECTED");
      }
      throw error;
    }

    const pending = cloneState(this.state);
    this.maybeFail("raw_result");
    pending.rawResults.set(currentJob.prescriptionId, clone(plan.rawResult));

    this.maybeFail("projections");
    pending.projections.set(currentJob.prescriptionId, clone({
      medicines: plan.medicines,
      recommendations: plan.recommendations,
      warnings: plan.warnings,
    }));

    this.maybeFail("prescription_update");
    pending.prescriptions.set(prescription.id, {
      ...prescription,
      status: plan.prescriptionPatch.status,
      processingPatch: clone(plan.prescriptionPatch),
    });

    this.maybeFail("job_transition");
    const terminalJobStatus = input.response.status === "failed" ? "failed" : "completed";
    pending.jobs.set(currentJob.id, {
      ...currentJob,
      status: terminalJobStatus,
      completedAt: input.finalizedAt,
      failure: input.response.status === "failed"
        ? { category: "INTELLIGENCE_REJECTED", contractCode: input.response.error.code }
        : null,
    });

    this.state = pending;
    return Object.freeze({
      jobId: currentJob.id,
      prescriptionId: currentJob.prescriptionId,
      status: input.response.status as PersistedIntelligenceStatus,
      replayed: false,
    });
  }

  snapshot() {
    return immutableSnapshot({
      jobs: [...this.state.jobs.entries()],
      prescriptions: [...this.state.prescriptions.entries()],
      rawResults: [...this.state.rawResults.entries()],
      projections: [...this.state.projections.entries()],
    });
  }
}
