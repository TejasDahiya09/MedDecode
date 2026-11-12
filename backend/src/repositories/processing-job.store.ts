import type { UserSupabaseClient } from "../config/supabase-user.js";
import { env } from "../config/env.js";
import {
  DEFAULT_REQUESTED_ANALYSIS,
  INTELLIGENCE_JOB_TYPE,
  type IntelligenceJobRecord,
  type IntelligenceJobStatus,
  type RequestedAnalysis
} from "../types/intelligence-jobs.js";
import type {
  ProcessingStatusResult,
  ProcessingSubmissionResult
} from "../types/processing-jobs.js";

export interface SubmitProcessingJobInput {
  readonly userId: string;
  readonly prescriptionId: string;
  readonly requestedAnalysis: RequestedAnalysis;
}

/**
 * Durable implementations must make submitOwned atomic. In particular, they
 * must verify ownership, check for a final result, return an existing active
 * job, or insert one queued job in a single database transaction/RPC.
 */
export interface ProcessingJobStore {
  submitOwned(input: SubmitProcessingJobInput): Promise<ProcessingSubmissionResult>;
  findOwnedStatus(userId: string, prescriptionId: string): Promise<ProcessingStatusResult>;
}

export type ProcessingJobStoreFactory = (
  client: UserSupabaseClient
) => ProcessingJobStore;

export class ProcessingJobStoreUnavailableError extends Error {
  constructor() {
    super("Secure durable processing-job storage is not configured.");
    this.name = "ProcessingJobStoreUnavailableError";
  }
}

interface RpcErrorShape {
  readonly code?: unknown;
  readonly message?: unknown;
}

interface RpcResult {
  readonly data: unknown;
  readonly error: unknown;
}

type RpcClient = {
  rpc(functionName: string, parameters: Record<string, unknown>): PromiseLike<RpcResult>;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JOB_STATUSES = new Set<IntelligenceJobStatus>([
  "queued", "processing", "completed", "failed"
]);

const exactKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean => {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === [...expected].sort()[index]);
};

const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

const singleRow = (value: unknown): Record<string, unknown> | null => {
  if (!Array.isArray(value) || value.length !== 1) return null;
  return record(value[0]);
};

const timestamp = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));

const nullableTimestamp = (value: unknown): value is string | null =>
  value === null || timestamp(value);

function rpcError(error: unknown): { code: string | null; message: string | null } {
  const candidate = record(error) as RpcErrorShape | null;
  return {
    code: typeof candidate?.code === "string" ? candidate.code : null,
    message: typeof candidate?.message === "string" ? candidate.message : null
  };
}

function unavailable(): ProcessingJobStoreUnavailableError {
  return new ProcessingJobStoreUnavailableError();
}

async function callRpc(
  client: RpcClient,
  functionName: string,
  parameters: Record<string, unknown>
): Promise<RpcResult> {
  try {
    return await client.rpc(functionName, parameters);
  } catch {
    throw unavailable();
  }
}

function statusJob(
  row: Record<string, unknown>,
  userId: string,
  prescriptionId: string
): IntelligenceJobRecord | "none" {
  const keys = [
    "completed_at", "created_at", "job_id", "job_status",
    "prescription_id", "started_at"
  ] as const;
  if (!exactKeys(row, keys) || row.prescription_id !== prescriptionId) throw unavailable();

  const allJobFieldsNull = row.job_id === null && row.job_status === null &&
    row.created_at === null && row.started_at === null && row.completed_at === null;
  if (allJobFieldsNull) return "none";

  if (
    typeof row.job_id !== "string" || !UUID_PATTERN.test(row.job_id) ||
    typeof row.job_status !== "string" ||
    !JOB_STATUSES.has(row.job_status as IntelligenceJobStatus) ||
    !timestamp(row.created_at) || !nullableTimestamp(row.started_at) ||
    !nullableTimestamp(row.completed_at)
  ) throw unavailable();

  return {
    id: row.job_id,
    userId,
    prescriptionId,
    jobType: INTELLIGENCE_JOB_TYPE,
    requestedAnalysis: DEFAULT_REQUESTED_ANALYSIS,
    status: row.job_status as IntelligenceJobStatus,
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    failure: null
  };
}

class SupabaseProcessingJobStore implements ProcessingJobStore {
  private readonly rpcClient: RpcClient;

  constructor(client: UserSupabaseClient) {
    this.rpcClient = client as unknown as RpcClient;
  }

  private async readStatus(
    userId: string,
    prescriptionId: string
  ): Promise<IntelligenceJobRecord | "none" | "prescription_not_found"> {
    const result = await callRpc(
      this.rpcClient,
      "get_prescription_analysis_status_v1",
      { p_prescription_id: prescriptionId }
    );
    if (result.error) throw unavailable();
    if (Array.isArray(result.data) && result.data.length === 0) {
      return "prescription_not_found";
    }
    const row = singleRow(result.data);
    if (!row) throw unavailable();
    return statusJob(row, userId, prescriptionId);
  }

  async submitOwned(input: SubmitProcessingJobInput): Promise<ProcessingSubmissionResult> {
    const result = await callRpc(
      this.rpcClient,
      "submit_prescription_analysis_job_v1",
      {
        p_prescription_id: input.prescriptionId,
        p_requested_analysis: input.requestedAnalysis
      }
    );
    if (result.error) {
      const error = rpcError(result.error);
      if (error.code === "P0002" && error.message === "prescription not found") {
        return { kind: "prescription_not_found" };
      }
      if (error.code === "23505" && error.message === "result already exists") {
        return { kind: "result_exists" };
      }
      if (error.code === "55000" && (
        error.message === "prescription not processable" ||
        error.message === "prescription lifecycle is incompatible"
      )) {
        return { kind: "not_processable" };
      }
      throw unavailable();
    }

    const submission = singleRow(result.data);
    const submissionKeys = ["created", "job_id", "job_status", "prescription_id"] as const;
    if (
      !submission || !exactKeys(submission, submissionKeys) ||
      typeof submission.job_id !== "string" || !UUID_PATTERN.test(submission.job_id) ||
      submission.prescription_id !== input.prescriptionId ||
      (submission.job_status !== "queued" && submission.job_status !== "processing") ||
      typeof submission.created !== "boolean"
    ) throw unavailable();

    const status = await this.readStatus(input.userId, input.prescriptionId);
    if (status === "none" || status === "prescription_not_found" ||
        status.id !== submission.job_id || status.status !== submission.job_status) {
      throw unavailable();
    }
    return submission.created
      ? { kind: "created", job: status }
      : { kind: "active", job: status };
  }

  async findOwnedStatus(
    userId: string,
    prescriptionId: string
  ): Promise<ProcessingStatusResult> {
    const status = await this.readStatus(userId, prescriptionId);
    if (status === "prescription_not_found") return { kind: "prescription_not_found" };
    if (status === "none") return { kind: "none" };
    return { kind: "job", job: status };
  }
}

class UnavailableProcessingJobStore implements ProcessingJobStore {
  async submitOwned(): Promise<never> {
    throw new ProcessingJobStoreUnavailableError();
  }

  async findOwnedStatus(): Promise<never> {
    throw new ProcessingJobStoreUnavailableError();
  }
}

/**
 * Safe production default. It intentionally performs no Supabase operation
 * until the reviewed atomic submission RPC has been deployed and configured.
 */
export const createUnavailableProcessingJobStore: ProcessingJobStoreFactory = () =>
  new UnavailableProcessingJobStore();

export const createSupabaseProcessingJobStore: ProcessingJobStoreFactory = (client) =>
  new SupabaseProcessingJobStore(client);

export function createProcessingJobStoreFactory(
  enabled: boolean
): ProcessingJobStoreFactory {
  return enabled
    ? createSupabaseProcessingJobStore
    : createUnavailableProcessingJobStore;
}

export const createConfiguredProcessingJobStore = createProcessingJobStoreFactory(
  env.processingJobStoreEnabled
);
