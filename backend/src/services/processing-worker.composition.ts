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
import { HttpPythonIntelligenceClient } from "./http-python-intelligence.client.js";
import {
  createRealPrescriptionWorkerHandler,
  RealPrescriptionProcessor,
} from "./real-prescription-worker.handler.js";
import {
  createRealLocalPdfIntelligenceClientFactory,
  type JsonSubprocessOptions,
  type CatalogueEnvironment,
} from "./local-python-intelligence.client.js";
import {
  ProcessingWorkerRuntime,
  type WorkerLogger,
} from "./processing-worker.runtime.js";
import type { WorkerRuntimeConfig } from "../types/worker-jobs.js";
import type { PrescriptionReviewWorkerStore } from "../repositories/prescription-review-worker.store.js";
import type { ConfirmedReviewIntelligenceClient } from "./confirmed-review-intelligence.client.js";

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
  /** Real workers use the private HTTP service; legacy subprocess injection remains for existing tests. */
  readonly intelligenceService?: Readonly<{ url: string; token: string }>;
  readonly s3: Readonly<{
    region: string;
    bucket: string;
    client: S3GetObjectClient;
    maximumBytes?: number;
    temporaryRoot?: string;
  }>;
  readonly python?: Readonly<{
    executable: string;
    intelligenceDirectory: string;
    /** Explicit local directory containing pre-provisioned EasyOCR assets. */
    easyOcrModelDirectory?: string;
    /** Cloud OCR is selected only by this explicit worker-only setting. */
    ocrProvider?: "easyocr" | "aws-textract" | "google-cloud-vision";
    /** Local-only catalogue lookup; explicit worker configuration only. */
    officialCatalogueLocal?: boolean;
    catalogueEnvironment?: CatalogueEnvironment;
    /** Required only when aws-textract is explicitly selected. */
    awsRegion?: string;
    /** Only the real local-document pipeline is permitted. */
    entryPoint: typeof REAL_LOCAL_PDF_WORKER_MODULE;
    timeoutMs?: number;
    /** Test seam for subprocess execution; it cannot select fixture mode. */
    run?: (options: JsonSubprocessOptions) => Promise<string>;
  }>;
  readonly logger?: WorkerLogger;
  readonly beforeClaim?: () => Promise<boolean>;
  readonly controlledSingleAttempt?: boolean;
  readonly exactJobRetry?: boolean;
  readonly now?: () => Date;
  readonly retryDelayMs?: number;
  readonly review?: Readonly<{
    store: PrescriptionReviewWorkerStore;
    intelligence: ConfirmedReviewIntelligenceClient;
  }>;
}

/**
 * Builds the disabled real-document worker graph. It opens no connection,
 * makes no request, and deliberately does not call runtime.start(). Callers
 * must make a separate, approved decision to start the returned runtime.
 */
export function createDisabledProcessingWorkerComposition(
  options: DisabledProcessingWorkerCompositionOptions
): DisabledProcessingWorkerComposition {
  if (options.exactJobRetry && !options.controlledSingleAttempt) throw new Error('Exact retry requires controlled single execution.');
  if (!options.intelligenceService && (!options.python || options.python.entryPoint !== REAL_LOCAL_PDF_WORKER_MODULE)) {
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
    options.intelligenceService ? (path => new HttpPythonIntelligenceClient(path, options.intelligenceService!.url, options.intelligenceService!.token)) : createRealLocalPdfIntelligenceClientFactory({
      pythonExecutable: options.python!.executable,
      intelligenceDirectory: options.python!.intelligenceDirectory,
      ...(options.python!.easyOcrModelDirectory === undefined ? {} : {
        easyOcrModelDirectory: options.python!.easyOcrModelDirectory,
      }),
      ...(options.python!.ocrProvider === undefined ? {} : { ocrProvider: options.python!.ocrProvider }),
      ...(options.python!.awsRegion === undefined ? {} : { awsRegion: options.python!.awsRegion }),
      ...(options.python!.officialCatalogueLocal === true ? { officialCatalogueLocal: true } : {}),
      ...(options.python!.catalogueEnvironment === undefined ? {} : { catalogueEnvironment: options.python!.catalogueEnvironment }),
      ...(options.python!.timeoutMs === undefined ? {} : { timeoutMs: options.python!.timeoutMs }),
      ...(options.python!.run === undefined ? {} : { run: options.python!.run }),
    })
  );
  const handler = createRealPrescriptionWorkerHandler({
    processor,
    finalization,
    workerInstanceId: options.runtimeConfig.workerInstanceId,
    ...(options.controlledSingleAttempt ? { allowRetry: false } : {}),
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.retryDelayMs === undefined ? {} : { retryDelayMs: options.retryDelayMs }),
    ...(options.review === undefined ? {} : { review: options.review }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });
  const runtime = new ProcessingWorkerRuntime(options.runtimeConfig, {
    store: jobs,
    handler,
    ...(options.beforeClaim === undefined ? {} : { beforeClaim: options.beforeClaim }),
    ...(options.controlledSingleAttempt ? { exitOnEmptyClaim: true } : {}),
    ...(options.exactJobRetry ? { exitOnClaimError: true } : {}),
    ...(clock === undefined ? {} : { now: clock }),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  });
  return {
    runtime,
    recoverExpired: (limit) => finalization.recoverExpired(limit),
  };
}
