import {
  createRpcWorkerJobFinalizationStore,
  RestrictedWorkerFinalizationRpcTransport,
  type WorkerFinalizationRpcCaller,
} from "../repositories/worker-job-finalization.rpc-store.js";
import {
  createRpcWorkerJobStore,
  RestrictedWorkerRpcTransport,
  type WorkerRpcCaller,
} from "../repositories/worker-job.rpc-store.js";
import type { S3GetObjectClient } from "./worker-document.reader.js";
import { createS3WorkerDocumentReader } from "./worker-document.reader.js";
import {
  createRealPrescriptionWorkerHandler,
  RealPrescriptionProcessor,
} from "./real-prescription-worker.handler.js";
import {
  createRealLocalPdfIntelligenceClientFactory,
  type JsonSubprocessOptions,
} from "./local-python-intelligence.client.js";
import {
  ProcessingWorkerRuntime,
  type WorkerLogger,
} from "./processing-worker.runtime.js";
import type { WorkerRuntimeConfig } from "../types/worker-jobs.js";

const REAL_LOCAL_PDF_WORKER_MODULE = "app.integration.local_pdf_worker" as const;

/**
 * One trusted worker transport is wrapped independently by the claim and
 * finalization RPC allowlists. No user JWT, HTTP request, or direct table
 * client can be substituted at this boundary.
 */
export type WorkerCompositionRpcCaller = WorkerRpcCaller & WorkerFinalizationRpcCaller;

export interface DisabledProcessingWorkerComposition {
  readonly runtime: ProcessingWorkerRuntime;
  /** Explicit maintenance action; never invoked by runtime.start(). */
  recoverExpired(limit: number): ReturnType<ReturnType<typeof createRpcWorkerJobFinalizationStore>["recoverExpired"]>;
}

export interface DisabledProcessingWorkerCompositionOptions {
  readonly runtimeConfig: WorkerRuntimeConfig;
  readonly rpcCaller: WorkerCompositionRpcCaller;
  readonly s3: Readonly<{
    region: string;
    bucket: string;
    client: S3GetObjectClient;
    maximumBytes?: number;
    temporaryRoot?: string;
  }>;
  readonly python: Readonly<{
    executable: string;
    intelligenceDirectory: string;
    /** Explicit local directory containing pre-provisioned EasyOCR assets. */
    easyOcrModelDirectory?: string;
    /** Cloud OCR is selected only by this explicit worker-only setting. */
    ocrProvider?: "easyocr" | "aws-textract" | "google-cloud-vision";
    /** Required only when aws-textract is explicitly selected. */
    awsRegion?: string;
    /** Only the real local-document pipeline is permitted. */
    entryPoint: typeof REAL_LOCAL_PDF_WORKER_MODULE;
    timeoutMs?: number;
    /** Test seam for subprocess execution; it cannot select fixture mode. */
    run?: (options: JsonSubprocessOptions) => Promise<string>;
  }>;
  readonly logger?: WorkerLogger;
  readonly now?: () => Date;
  readonly retryDelayMs?: number;
}

/**
 * Builds the disabled real-document worker graph. It opens no connection,
 * makes no request, and deliberately does not call runtime.start(). Callers
 * must make a separate, approved decision to start the returned runtime.
 */
export function createDisabledProcessingWorkerComposition(
  options: DisabledProcessingWorkerCompositionOptions
): DisabledProcessingWorkerComposition {
  if (options.python.entryPoint !== REAL_LOCAL_PDF_WORKER_MODULE) {
    throw new Error("Only the real local PDF worker entry point is permitted.");
  }
  // Use one injected clock consistently for claim response validation, the
  // lease runtime, and completion/failure timestamps in deterministic tests.
  const clock = options.now === undefined ? undefined : () => options.now!().getTime();
  const jobs = createRpcWorkerJobStore(
    new RestrictedWorkerRpcTransport(options.rpcCaller),
    clock
  );
  const finalization = createRpcWorkerJobFinalizationStore(
    new RestrictedWorkerFinalizationRpcTransport(options.rpcCaller)
  );
  const documents = createS3WorkerDocumentReader({
    region: options.s3.region,
    bucket: options.s3.bucket,
    client: options.s3.client,
    ...(options.s3.maximumBytes === undefined ? {} : { maximumBytes: options.s3.maximumBytes }),
    ...(options.s3.temporaryRoot === undefined ? {} : { temporaryRoot: options.s3.temporaryRoot }),
  });
  const processor = new RealPrescriptionProcessor(
    documents,
    createRealLocalPdfIntelligenceClientFactory({
      pythonExecutable: options.python.executable,
      intelligenceDirectory: options.python.intelligenceDirectory,
      ...(options.python.easyOcrModelDirectory === undefined ? {} : {
        easyOcrModelDirectory: options.python.easyOcrModelDirectory,
      }),
      ...(options.python.ocrProvider === undefined ? {} : { ocrProvider: options.python.ocrProvider }),
      ...(options.python.awsRegion === undefined ? {} : { awsRegion: options.python.awsRegion }),
      ...(options.python.timeoutMs === undefined ? {} : { timeoutMs: options.python.timeoutMs }),
      ...(options.python.run === undefined ? {} : { run: options.python.run }),
    })
  );
  const handler = createRealPrescriptionWorkerHandler({
    processor,
    finalization,
    workerInstanceId: options.runtimeConfig.workerInstanceId,
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.retryDelayMs === undefined ? {} : { retryDelayMs: options.retryDelayMs }),
  });
  const runtime = new ProcessingWorkerRuntime(options.runtimeConfig, {
    store: jobs,
    handler,
    ...(clock === undefined ? {} : { now: clock }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });
  return {
    runtime,
    recoverExpired: (limit) => finalization.recoverExpired(limit),
  };
}
