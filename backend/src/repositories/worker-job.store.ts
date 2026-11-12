import type { WorkerHeartbeat, WorkerJobClaim } from "../types/worker-jobs.js";

export interface WorkerJobStore {
  claimNext(workerInstanceId: string, leaseSeconds: number): Promise<WorkerJobClaim | null>;
  heartbeat(input: {
    readonly jobId: string;
    readonly workerInstanceId: string;
    readonly claimGeneration: number;
    readonly extendSeconds: number;
  }): Promise<WorkerHeartbeat>;
}

export class WorkerJobStoreUnavailableError extends Error {
  constructor() {
    super("Worker job storage is not configured.");
    this.name = "WorkerJobStoreUnavailableError";
  }
}

/**
 * Safe production default. The PostgreSQL meddecode_worker role is NOLOGIN and
 * no hosted credential/role-assumption mechanism has been approved. This store
 * therefore performs no database operation.
 */
export class UnavailableWorkerJobStore implements WorkerJobStore {
  async claimNext(): Promise<never> {
    throw new WorkerJobStoreUnavailableError();
  }

  async heartbeat(): Promise<never> {
    throw new WorkerJobStoreUnavailableError();
  }
}

export const createUnavailableWorkerJobStore = (): WorkerJobStore =>
  new UnavailableWorkerJobStore();
