import type { WorkerJobStore } from "./worker-job.store.js";
import type { WorkerHeartbeat, WorkerJobClaim } from "../types/worker-jobs.js";

export const WORKER_CLAIM_RPC = "claim_next_prescription_analysis_job_v1" as const;
export const WORKER_HEARTBEAT_RPC = "heartbeat_prescription_analysis_job_v1" as const;

export type WorkerRpcFunctionName =
  | typeof WORKER_CLAIM_RPC
  | typeof WORKER_HEARTBEAT_RPC;

export interface WorkerRpcResult {
  readonly data: unknown;
  readonly error: unknown;
}

export interface WorkerAuthorizedRpcTransport {
  call(
    functionName: WorkerRpcFunctionName,
    parameters: Readonly<Record<string, unknown>>
  ): Promise<WorkerRpcResult>;
}

export interface WorkerRpcCaller {
  rpc(
    functionName: string,
    parameters: Readonly<Record<string, unknown>>
  ): PromiseLike<WorkerRpcResult>;
}

const ALLOWED_FUNCTIONS = new Set<string>([WORKER_CLAIM_RPC, WORKER_HEARTBEAT_RPC]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WORKER_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const FILE_TYPES = new Set(["image/jpeg", "image/png", "application/pdf"]);

export type WorkerRpcErrorCategory =
  | "UNAUTHORIZED"
  | "INVALID_REQUEST"
  | "STALE_CLAIM"
  | "MALFORMED_RESPONSE"
  | "UNAVAILABLE";

export class WorkerRpcStoreError extends Error {
  constructor(readonly category: WorkerRpcErrorCategory) {
    super("Worker database operation failed safely.");
    this.name = "WorkerRpcStoreError";
  }
}

export class WorkerRpcFunctionRejectedError extends Error {
  constructor() {
    super("Worker RPC function is not allowed.");
    this.name = "WorkerRpcFunctionRejectedError";
  }
}

/**
 * Runtime allowlist around an injected, already-authorized database caller.
 * It creates no client and contains no credential or connection configuration.
 */
export class RestrictedWorkerRpcTransport implements WorkerAuthorizedRpcTransport {
  constructor(private readonly caller: WorkerRpcCaller) {}

  async call(
    functionName: WorkerRpcFunctionName,
    parameters: Readonly<Record<string, unknown>>
  ): Promise<WorkerRpcResult> {
    if (!ALLOWED_FUNCTIONS.has(functionName)) {
      throw new WorkerRpcFunctionRejectedError();
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

const singleRow = (value: unknown): Record<string, unknown> | null => {
  if (!Array.isArray(value) || value.length !== 1) return null;
  return record(value[0]);
};

const futureTimestamp = (value: unknown, now: number): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value)) && Date.parse(value) > now;

const providerError = (value: unknown): { code: string | null; message: string | null } => {
  const error = record(value);
  return {
    code: typeof error?.code === "string" ? error.code : null,
    message: typeof error?.message === "string" ? error.message : null
  };
};

const safeError = (value: unknown): WorkerRpcStoreError => {
  const error = providerError(value);
  if (error.code === "42501" || error.code === "28000") {
    return new WorkerRpcStoreError("UNAUTHORIZED");
  }
  if (error.code === "22023") return new WorkerRpcStoreError("INVALID_REQUEST");
  if (error.code === "55000" && error.message === "stale or expired worker claim") {
    return new WorkerRpcStoreError("STALE_CLAIM");
  }
  return new WorkerRpcStoreError("UNAVAILABLE");
};

const validWorker = (value: string): boolean => WORKER_ID_PATTERN.test(value);
const validLease = (value: number): boolean => Number.isSafeInteger(value) && value >= 30 && value <= 300;

export class RpcWorkerJobStore implements WorkerJobStore {
  constructor(
    private readonly transport: WorkerAuthorizedRpcTransport,
    private readonly now: () => number = Date.now
  ) {}

  async claimNext(workerInstanceId: string, leaseSeconds: number): Promise<WorkerJobClaim | null> {
    if (!validWorker(workerInstanceId) || !validLease(leaseSeconds)) {
      throw new WorkerRpcStoreError("INVALID_REQUEST");
    }
    let result: WorkerRpcResult;
    try {
      result = await this.transport.call(WORKER_CLAIM_RPC, {
        p_worker_instance_id: workerInstanceId,
        p_lease_seconds: leaseSeconds
      });
    } catch (error) {
      if (error instanceof WorkerRpcFunctionRejectedError) throw error;
      throw new WorkerRpcStoreError("UNAVAILABLE");
    }
    if (result.error !== null && result.error !== undefined) throw safeError(result.error);
    if (Array.isArray(result.data) && result.data.length === 0) return null;

    const row = singleRow(result.data);
    const keys = [
      "attempt_count", "claim_generation", "file_type", "input_reference",
      "job_id", "lease_expires_at", "object_key", "prescription_id",
      "storage_bucket", "storage_provider", "user_id"
    ] as const;
    const inputReference = row ? record(row.input_reference) : null;
    if (!row || !exactKeys(row, keys) ||
        typeof row.job_id !== "string" || !UUID_PATTERN.test(row.job_id) ||
        typeof row.user_id !== "string" || !UUID_PATTERN.test(row.user_id) ||
        typeof row.prescription_id !== "string" || !UUID_PATTERN.test(row.prescription_id) ||
        typeof row.attempt_count !== "number" || !Number.isSafeInteger(row.attempt_count) ||
        row.attempt_count < 1 ||
        typeof row.claim_generation !== "number" || !Number.isSafeInteger(row.claim_generation) ||
        row.claim_generation < 1 || !futureTimestamp(row.lease_expires_at, this.now()) ||
        row.storage_provider !== "aws_s3" || typeof row.storage_bucket !== "string" ||
        !row.storage_bucket.trim() || typeof row.object_key !== "string" || !row.object_key.trim() ||
        typeof row.file_type !== "string" || !FILE_TYPES.has(row.file_type) ||
        (row.input_reference !== null && inputReference === null)) {
      throw new WorkerRpcStoreError("MALFORMED_RESPONSE");
    }
    return {
      jobId: row.job_id,
      userId: row.user_id,
      prescriptionId: row.prescription_id,
      attemptCount: row.attempt_count,
      claimGeneration: row.claim_generation,
      leaseExpiresAt: row.lease_expires_at,
      storageProvider: "aws_s3",
      storageBucket: row.storage_bucket,
      objectKey: row.object_key,
      fileType: row.file_type as WorkerJobClaim["fileType"],
      inputReference
    };
  }

  async heartbeat(input: {
    readonly jobId: string;
    readonly workerInstanceId: string;
    readonly claimGeneration: number;
    readonly extendSeconds: number;
  }): Promise<WorkerHeartbeat> {
    if (!UUID_PATTERN.test(input.jobId) || !validWorker(input.workerInstanceId) ||
        !Number.isSafeInteger(input.claimGeneration) || input.claimGeneration < 1 ||
        !validLease(input.extendSeconds)) {
      throw new WorkerRpcStoreError("INVALID_REQUEST");
    }
    let result: WorkerRpcResult;
    try {
      result = await this.transport.call(WORKER_HEARTBEAT_RPC, {
        p_job_id: input.jobId,
        p_worker_instance_id: input.workerInstanceId,
        p_claim_generation: input.claimGeneration,
        p_extend_seconds: input.extendSeconds
      });
    } catch (error) {
      if (error instanceof WorkerRpcFunctionRejectedError) throw error;
      throw new WorkerRpcStoreError("UNAVAILABLE");
    }
    if (result.error !== null && result.error !== undefined) throw safeError(result.error);
    const row = singleRow(result.data);
    const keys = ["claim_generation", "job_id", "lease_expires_at"] as const;
    if (!row || !exactKeys(row, keys) || row.job_id !== input.jobId ||
        row.claim_generation !== input.claimGeneration ||
        !futureTimestamp(row.lease_expires_at, this.now())) {
      throw new WorkerRpcStoreError("MALFORMED_RESPONSE");
    }
    return {
      jobId: input.jobId,
      claimGeneration: input.claimGeneration,
      leaseExpiresAt: row.lease_expires_at
    };
  }
}

export const createRpcWorkerJobStore = (
  transport: WorkerAuthorizedRpcTransport,
  now?: () => number
): WorkerJobStore => new RpcWorkerJobStore(transport, now);
