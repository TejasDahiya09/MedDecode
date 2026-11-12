import {
  assertValidWorkerCompletionCommand,
  assertValidWorkerFailureCommand,
  WorkerJobFinalizationError,
  type WorkerExpiredJobRecoveryOutcome,
  type WorkerExpiredJobRecoveryStore,
  type WorkerJobFinalizationStore,
} from "./worker-job-finalization.store.js";
import type {
  WorkerJobCompletionCommand,
  WorkerJobCompletionOutcome,
  WorkerJobFailureCommand,
  WorkerJobFailureOutcome,
} from "../types/worker-jobs.js";

export const WORKER_COMPLETE_RPC = "complete_prescription_analysis_job_v1" as const;
export const WORKER_FAIL_RPC = "fail_prescription_analysis_job_v1" as const;
export const WORKER_RECOVER_EXPIRED_RPC = "recover_expired_prescription_analysis_jobs_v1" as const;

export type WorkerFinalizationRpcFunctionName =
  | typeof WORKER_COMPLETE_RPC
  | typeof WORKER_FAIL_RPC
  | typeof WORKER_RECOVER_EXPIRED_RPC;

export interface WorkerFinalizationRpcResult {
  readonly data: unknown;
  readonly error: unknown;
}

/**
 * An already-authorized worker transport. The adapter deliberately owns no
 * connection, credentials, or SQL capability beyond the three RPCs below.
 */
export interface WorkerFinalizationRpcTransport {
  call(
    functionName: WorkerFinalizationRpcFunctionName,
    parameters: Readonly<Record<string, unknown>>
  ): Promise<WorkerFinalizationRpcResult>;
}

export interface WorkerFinalizationRpcCaller {
  rpc(
    functionName: string,
    parameters: Readonly<Record<string, unknown>>
  ): PromiseLike<WorkerFinalizationRpcResult>;
}

const ALLOWED_FUNCTIONS = new Set<string>([
  WORKER_COMPLETE_RPC,
  WORKER_FAIL_RPC,
  WORKER_RECOVER_EXPIRED_RPC,
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class WorkerFinalizationRpcFunctionRejectedError extends Error {
  constructor() {
    super("Worker finalization RPC function is not allowed.");
    this.name = "WorkerFinalizationRpcFunctionRejectedError";
  }
}

/** Runtime allowlist around an injected worker-authorized RPC caller. */
export class RestrictedWorkerFinalizationRpcTransport implements WorkerFinalizationRpcTransport {
  constructor(private readonly caller: WorkerFinalizationRpcCaller) {}

  async call(
    functionName: WorkerFinalizationRpcFunctionName,
    parameters: Readonly<Record<string, unknown>>
  ): Promise<WorkerFinalizationRpcResult> {
    if (!ALLOWED_FUNCTIONS.has(functionName)) {
      throw new WorkerFinalizationRpcFunctionRejectedError();
    }
    return this.caller.rpc(functionName, parameters);
  }
}

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const exactKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean => {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
};

const rows = (value: unknown): Record<string, unknown>[] | null => {
  if (!Array.isArray(value)) return null;
  const result = value.map(record);
  return result.every((row): row is Record<string, unknown> => row !== null) ? result : null;
};

const singleRow = (value: unknown): Record<string, unknown> | null => {
  const result = rows(value);
  return result?.length === 1 ? result[0] ?? null : null;
};

const validTimestamp = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

const providerError = (value: unknown): { code: string | null; message: string | null } => {
  const error = record(value);
  return {
    code: typeof error?.code === "string" ? error.code : null,
    message: typeof error?.message === "string" ? error.message : null,
  };
};

const safeError = (
  value: unknown,
  operation: "complete" | "fail" | "recover"
): WorkerJobFinalizationError => {
  const error = providerError(value);
  if (error.code === "42501") return new WorkerJobFinalizationError("WRONG_WORKER");
  if (error.code === "55000" &&
      (error.message === "stale or expired worker claim" || error.message === "stale finalization")) {
    return new WorkerJobFinalizationError("STALE_CLAIM");
  }
  if (error.code === "23505") return new WorkerJobFinalizationError("CONFLICTING_FINALIZATION");
  if (error.code === "22023") {
    return new WorkerJobFinalizationError(operation === "complete" ? "INVALID_RESULT" : "INVALID_COMMAND");
  }
  if (error.code === "P0002" || error.code === "23503") {
    return new WorkerJobFinalizationError("CORRELATION_MISMATCH");
  }
  return new WorkerJobFinalizationError("UNAVAILABLE");
};

const checkedCall = async (
  transport: WorkerFinalizationRpcTransport,
  functionName: WorkerFinalizationRpcFunctionName,
  operation: "complete" | "fail" | "recover",
  parameters: Readonly<Record<string, unknown>>
): Promise<unknown> => {
  let result: WorkerFinalizationRpcResult;
  try {
    result = await transport.call(functionName, parameters);
  } catch (error) {
    if (error instanceof WorkerFinalizationRpcFunctionRejectedError) throw error;
    throw new WorkerJobFinalizationError("UNAVAILABLE");
  }
  if (result.error !== null && result.error !== undefined) throw safeError(result.error, operation);
  return result.data;
};

/**
 * Adapter for the Phase 7 fenced finalization RPCs. It is not registered with
 * Express or the worker runtime; composition must explicitly inject it.
 */
export class RpcWorkerJobFinalizationStore
  implements WorkerJobFinalizationStore, WorkerExpiredJobRecoveryStore {
  constructor(private readonly transport: WorkerFinalizationRpcTransport) {}

  async completeOwned(input: WorkerJobCompletionCommand): Promise<WorkerJobCompletionOutcome> {
    assertValidWorkerCompletionCommand(input);
    const row = singleRow(await checkedCall(this.transport, WORKER_COMPLETE_RPC, "complete", {
      p_job_id: input.jobId,
      p_prescription_id: input.prescriptionId,
      p_worker_instance_id: input.workerInstanceId,
      p_claim_generation: input.claimGeneration,
      p_result_json: input.result,
    }));
    const keys = ["job_id", "prescription_id", "result_status", "replayed"] as const;
    if (!row || !exactKeys(row, keys) || row.job_id !== input.jobId ||
        row.prescription_id !== input.prescriptionId || typeof row.replayed !== "boolean" ||
        (row.result_status !== "completed" && row.result_status !== "completed_with_warnings")) {
      throw new WorkerJobFinalizationError("UNAVAILABLE");
    }
    if (row.result_status !== input.result.status) {
      throw new WorkerJobFinalizationError("CORRELATION_MISMATCH");
    }
    return {
      jobId: input.jobId,
      prescriptionId: input.prescriptionId,
      jobStatus: "completed",
      prescriptionStatus: row.result_status,
      replayed: row.replayed,
    };
  }

  async failOwned(input: WorkerJobFailureCommand): Promise<WorkerJobFailureOutcome> {
    assertValidWorkerFailureCommand(input);
    const row = singleRow(await checkedCall(this.transport, WORKER_FAIL_RPC, "fail", {
      p_job_id: input.jobId,
      p_prescription_id: input.prescriptionId,
      p_worker_instance_id: input.workerInstanceId,
      p_claim_generation: input.claimGeneration,
      p_failure_code: input.failure.code,
      p_retryable: input.failure.retryable,
      p_contract_code: input.failure.contractCode ?? null,
      p_retry_at: input.retryAt,
    }));
    const keys = ["job_id", "prescription_id", "job_status", "retry_eligible", "terminal", "available_at"] as const;
    if (!row || !exactKeys(row, keys) || row.job_id !== input.jobId ||
        row.prescription_id !== input.prescriptionId ||
        (row.job_status !== "queued" && row.job_status !== "failed") ||
        typeof row.retry_eligible !== "boolean" || typeof row.terminal !== "boolean" ||
        (row.available_at !== null && !validTimestamp(row.available_at))) {
      throw new WorkerJobFinalizationError("UNAVAILABLE");
    }
    const retry = row.job_status === "queued" && row.retry_eligible && !row.terminal &&
      validTimestamp(row.available_at);
    const terminal = row.job_status === "failed" && !row.retry_eligible && row.terminal &&
      row.available_at === null;
    if (!retry && !terminal) throw new WorkerJobFinalizationError("UNAVAILABLE");
    return {
      jobId: input.jobId,
      prescriptionId: input.prescriptionId,
      jobStatus: row.job_status,
      prescriptionStatus: row.job_status,
      retryEligible: row.retry_eligible,
      terminal: row.terminal,
      availableAt: row.available_at,
    };
  }

  async recoverExpired(limit: number): Promise<readonly WorkerExpiredJobRecoveryOutcome[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new WorkerJobFinalizationError("INVALID_COMMAND");
    }
    const result = rows(await checkedCall(
      this.transport, WORKER_RECOVER_EXPIRED_RPC, "recover", { p_limit: limit }
    ));
    if (!result) throw new WorkerJobFinalizationError("UNAVAILABLE");
    return result.map((row) => {
      const keys = ["job_id", "prescription_id", "job_status", "terminal"] as const;
      if (!exactKeys(row, keys) || typeof row.job_id !== "string" || !UUID_PATTERN.test(row.job_id) ||
          typeof row.prescription_id !== "string" || !UUID_PATTERN.test(row.prescription_id) ||
          (row.job_status !== "queued" && row.job_status !== "failed") || typeof row.terminal !== "boolean" ||
          (row.job_status === "queued" && row.terminal) || (row.job_status === "failed" && !row.terminal)) {
        throw new WorkerJobFinalizationError("UNAVAILABLE");
      }
      return {
        jobId: row.job_id,
        prescriptionId: row.prescription_id,
        jobStatus: row.job_status,
        terminal: row.terminal,
      };
    });
  }
}

/**
 * Explicit composition seam. Calling this factory never opens a database
 * connection; a disabled worker will not invoke the supplied transport.
 */
export const createRpcWorkerJobFinalizationStore = (
  transport: WorkerFinalizationRpcTransport
): RpcWorkerJobFinalizationStore => new RpcWorkerJobFinalizationStore(transport);
