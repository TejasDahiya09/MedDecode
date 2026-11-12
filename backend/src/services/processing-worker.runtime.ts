import type { WorkerJobStore } from "../repositories/worker-job.store.js";
import type {
  WorkerHeartbeat,
  WorkerJobClaim,
  WorkerRuntimeConfig
} from "../types/worker-jobs.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WORKER_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const FILE_TYPES = new Set(["image/jpeg", "image/png", "application/pdf"]);

export type WorkerLogEvent = Readonly<{
  level: "info" | "warn" | "error";
  event: string;
  attemptCount?: number;
  claimGeneration?: number;
  delayMs?: number;
}>;

export type WorkerLogger = (event: WorkerLogEvent) => void;
export type WorkerClaimHandler = (
  claim: WorkerJobClaim,
  signal: AbortSignal
) => Promise<void>;

export interface WorkerRuntimeDependencies {
  readonly store: WorkerJobStore;
  readonly handler: WorkerClaimHandler;
  readonly logger?: WorkerLogger;
  readonly now?: () => number;
  readonly wait?: (delayMs: number, signal: AbortSignal) => Promise<void>;
}

export class WorkerLeaseLostError extends Error {
  constructor() {
    super("Worker claim lease is stale or expired.");
    this.name = "WorkerLeaseLostError";
  }
}

class WorkerHeartbeatFailedError extends Error {
  constructor() {
    super("Worker heartbeat failed.");
    this.name = "WorkerHeartbeatFailedError";
  }
}

const integer = (value: number, minimum: number, maximum: number, name: string): number => {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} is outside the allowed range.`);
  }
  return value;
};

export function parseWorkerRuntimeConfig(
  source: Readonly<Record<string, string | undefined>>
): WorkerRuntimeConfig {
  const enabledValue = source.PROCESSING_WORKER_ENABLED;
  if (enabledValue !== undefined && enabledValue !== "" &&
      enabledValue !== "false" && enabledValue !== "true") {
    throw new Error("PROCESSING_WORKER_ENABLED must be either true or false.");
  }
  const enabled = enabledValue === "true";
  const workerInstanceId = source.PROCESSING_WORKER_INSTANCE_ID ?? "";
  if (enabled && !WORKER_ID_PATTERN.test(workerInstanceId)) {
    throw new Error("PROCESSING_WORKER_INSTANCE_ID is invalid.");
  }
  const leaseSeconds = integer(Number(source.PROCESSING_WORKER_LEASE_SECONDS ?? 120), 30, 300,
    "PROCESSING_WORKER_LEASE_SECONDS");
  const heartbeatIntervalMs = integer(
    Number(source.PROCESSING_WORKER_HEARTBEAT_INTERVAL_MS ?? 30_000), 1, 299_999,
    "PROCESSING_WORKER_HEARTBEAT_INTERVAL_MS"
  );
  if (heartbeatIntervalMs >= leaseSeconds * 1000) {
    throw new Error("Heartbeat interval must be shorter than the lease.");
  }
  const pollIntervalMs = integer(Number(source.PROCESSING_WORKER_POLL_INTERVAL_MS ?? 5_000),
    1, 300_000, "PROCESSING_WORKER_POLL_INTERVAL_MS");
  const retryInitialMs = integer(Number(source.PROCESSING_WORKER_RETRY_INITIAL_MS ?? 1_000),
    1, 60_000, "PROCESSING_WORKER_RETRY_INITIAL_MS");
  const retryMaximumMs = integer(Number(source.PROCESSING_WORKER_RETRY_MAXIMUM_MS ?? 30_000),
    retryInitialMs, 300_000, "PROCESSING_WORKER_RETRY_MAXIMUM_MS");
  return {
    enabled, workerInstanceId, leaseSeconds, heartbeatIntervalMs,
    pollIntervalMs, retryInitialMs, retryMaximumMs
  };
}

const defaultWait = (delayMs: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(finish, delayMs);
    function finish(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    }
    signal.addEventListener("abort", finish, { once: true });
  });

function validateClaim(claim: WorkerJobClaim, now: number): void {
  if (!UUID_PATTERN.test(claim.jobId) || !UUID_PATTERN.test(claim.userId) ||
      !UUID_PATTERN.test(claim.prescriptionId) ||
      !Number.isSafeInteger(claim.attemptCount) || claim.attemptCount < 1 ||
      !Number.isSafeInteger(claim.claimGeneration) || claim.claimGeneration < 1 ||
      !Number.isFinite(Date.parse(claim.leaseExpiresAt)) || Date.parse(claim.leaseExpiresAt) <= now ||
      claim.storageProvider !== "aws_s3" || !claim.storageBucket.trim() || !claim.objectKey.trim() ||
      !FILE_TYPES.has(claim.fileType)) {
    throw new WorkerLeaseLostError();
  }
}

function validateHeartbeat(
  heartbeat: WorkerHeartbeat,
  claim: WorkerJobClaim,
  now: number
): void {
  if (heartbeat.jobId !== claim.jobId ||
      heartbeat.claimGeneration !== claim.claimGeneration ||
      !Number.isFinite(Date.parse(heartbeat.leaseExpiresAt)) ||
      Date.parse(heartbeat.leaseExpiresAt) <= now) {
    throw new WorkerLeaseLostError();
  }
}

export class ProcessingWorkerRuntime {
  private readonly logger: WorkerLogger;
  private readonly now: () => number;
  private readonly wait: (delayMs: number, signal: AbortSignal) => Promise<void>;
  private controller: AbortController | null = null;
  private running: Promise<void> | null = null;

  constructor(
    private readonly config: WorkerRuntimeConfig,
    private readonly dependencies: WorkerRuntimeDependencies
  ) {
    this.logger = dependencies.logger ?? (() => undefined);
    this.now = dependencies.now ?? Date.now;
    this.wait = dependencies.wait ?? defaultWait;
  }

  start(): Promise<void> {
    if (this.running) return this.running;
    if (!this.config.enabled) return Promise.resolve();
    this.controller = new AbortController();
    this.running = this.run(this.controller.signal).finally(() => {
      this.controller = null;
      this.running = null;
    });
    return this.running;
  }

  async stop(): Promise<void> {
    this.controller?.abort();
    await this.running;
  }

  private async run(signal: AbortSignal): Promise<void> {
    let retryDelay = this.config.retryInitialMs;
    while (!signal.aborted) {
      let claim: WorkerJobClaim | null;
      try {
        claim = await this.dependencies.store.claimNext(
          this.config.workerInstanceId,
          this.config.leaseSeconds
        );
      } catch {
        this.logger({ level: "warn", event: "worker_claim_failed", delayMs: retryDelay });
        await this.wait(retryDelay, signal);
        retryDelay = Math.min(retryDelay * 2, this.config.retryMaximumMs);
        continue;
      }
      retryDelay = this.config.retryInitialMs;
      if (!claim) {
        this.logger({ level: "info", event: "worker_no_job" });
        await this.wait(this.config.pollIntervalMs, signal);
        continue;
      }
      try {
        validateClaim(claim, this.now());
        this.logger({
          level: "info", event: "worker_claim_acquired",
          attemptCount: claim.attemptCount, claimGeneration: claim.claimGeneration
        });
        await this.handleClaim(claim, signal);
      } catch (error) {
        this.logger({
          level: "error",
          event: error instanceof WorkerLeaseLostError
            ? "worker_claim_lost"
            : error instanceof WorkerHeartbeatFailedError
              ? "worker_heartbeat_failed"
              : "worker_handler_failed",
          claimGeneration: claim.claimGeneration
        });
      }
      // Until fenced failure/finalization RPCs exist, one start may own at most
      // one durable claim. This prevents repeatedly claiming unfinishable jobs.
      return;
    }
  }

  private async handleClaim(claim: WorkerJobClaim, runtimeSignal: AbortSignal): Promise<void> {
    const claimController = new AbortController();
    const abortClaim = (): void => claimController.abort();
    runtimeSignal.addEventListener("abort", abortClaim, { once: true });
    let handlerDone = false;
    let leaseExpiresAt = Date.parse(claim.leaseExpiresAt);
    const handler = this.dependencies.handler(claim, claimController.signal)
      .finally(() => { handlerDone = true; });
    const heartbeat = (async (): Promise<void> => {
      while (!handlerDone && !claimController.signal.aborted) {
        await this.wait(this.config.heartbeatIntervalMs, claimController.signal);
        if (handlerDone || claimController.signal.aborted) return;
        if (this.now() >= leaseExpiresAt) throw new WorkerLeaseLostError();
        let response: WorkerHeartbeat;
        try {
          response = await this.dependencies.store.heartbeat({
            jobId: claim.jobId,
            workerInstanceId: this.config.workerInstanceId,
            claimGeneration: claim.claimGeneration,
            extendSeconds: this.config.leaseSeconds
          });
        } catch {
          throw new WorkerHeartbeatFailedError();
        }
        validateHeartbeat(response, claim, this.now());
        leaseExpiresAt = Date.parse(response.leaseExpiresAt);
        this.logger({
          level: "info", event: "worker_heartbeat_succeeded",
          claimGeneration: claim.claimGeneration
        });
      }
    })();

    try {
      const first = await Promise.race([
        handler.then(() => "handler" as const),
        heartbeat.then(() => "heartbeat" as const)
      ]);
      if (first === "heartbeat" && !handlerDone) throw new WorkerLeaseLostError();
      claimController.abort();
      await heartbeat;
      await handler;
    } catch (error) {
      claimController.abort();
      await Promise.allSettled([handler, heartbeat]);
      throw error;
    } finally {
      runtimeSignal.removeEventListener("abort", abortClaim);
    }
  }
}
