import { resolve, sep } from "node:path";

import type { WorkerCompositionRpcCaller } from "../src/services/processing-worker.composition.js";
import { createDisabledProcessingWorkerComposition } from "../src/services/processing-worker.composition.js";
import type { S3GetObjectClient } from "../src/services/worker-document.reader.js";
import type { PrescriptionReviewWorkerStore } from "../src/repositories/prescription-review-worker.store.js";
import type { ConfirmedReviewIntelligenceClient } from "../src/services/confirmed-review-intelligence.client.js";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

export interface Rc1aLocalRuntimeConfiguration {
  readonly databaseUrl: string;
  readonly intelligenceUrl: string;
  readonly storageRoot: string;
  readonly temporaryRoot: string;
  readonly repositoryRoot: string;
  readonly workerInstanceId: string;
  readonly internalToken: string;
  readonly catalogueEnvironment: Readonly<Record<string, string>>;
}

function loopbackUrl(raw: string, protocols: ReadonlySet<string>): URL {
  let value: URL;
  try { value = new URL(raw); } catch { throw new Error("RC-1A endpoint is invalid."); }
  if (!protocols.has(value.protocol) || value.username && value.protocol.startsWith("http") ||
      !LOOPBACK.has(value.hostname) || value.search || value.hash) {
    throw new Error("RC-1A endpoint must be loopback-only.");
  }
  return value;
}

function childOf(root: string, candidate: string): string {
  const base = resolve(root);
  const target = resolve(candidate);
  if (target !== base && !target.startsWith(base + sep)) throw new Error("RC-1A path escapes its task-owned root.");
  return target;
}

export function assertRc1aLocalRuntime(configuration: Rc1aLocalRuntimeConfiguration): void {
  const database = loopbackUrl(configuration.databaseUrl, new Set(["postgres:", "postgresql:"]));
  if (database.pathname !== "/meddecode_phase1f_20261115" || decodeURIComponent(database.username) !== "meddecode_scoped_login") {
    throw new Error("RC-1A database identity is invalid.");
  }
  const intelligence = loopbackUrl(configuration.intelligenceUrl, new Set(["http:"]));
  if (!intelligence.port || configuration.internalToken.length < 32) throw new Error("RC-1A intelligence boundary is invalid.");
  if (configuration.workerInstanceId !== "rc1a-local-worker-001") throw new Error("RC-1A worker identity is invalid.");
  childOf(configuration.repositoryRoot, configuration.storageRoot);
  childOf(configuration.repositoryRoot, configuration.temporaryRoot);
  const catalogue = configuration.catalogueEnvironment;
  if (catalogue.MEDDECODE_CATALOGUE_ENV !== "local" ||
      !LOOPBACK.has(catalogue.MEDDECODE_CATALOGUE_HOST ?? "") ||
      catalogue.MEDDECODE_CATALOGUE_DATABASE !== "meddecode_phase1f_20261115" ||
      catalogue.MEDDECODE_CATALOGUE_USER !== "meddecode_catalogue_rc1a_reader" ||
      catalogue.MEDDECODE_CATALOGUE_SSLMODE !== "disable" ||
      Object.keys(catalogue).some(key => /PASSWORD|PASSFILE|SSLROOTCERT/.test(key))) {
    throw new Error("RC-1A catalogue must use the restricted local reader without hosted credentials.");
  }
}

export function createRc1aDisabledWorker(options: {
  readonly configuration: Rc1aLocalRuntimeConfiguration;
  readonly rpcCaller: WorkerCompositionRpcCaller;
  readonly storageClient: S3GetObjectClient;
  readonly reviewStore: PrescriptionReviewWorkerStore;
  readonly confirmedIntelligence: ConfirmedReviewIntelligenceClient;
}) {
  assertRc1aLocalRuntime(options.configuration);
  return createDisabledProcessingWorkerComposition({
    runtimeConfig: {
      enabled: true,
      workerInstanceId: options.configuration.workerInstanceId,
      leaseSeconds: 120,
      heartbeatIntervalMs: 250,
      pollIntervalMs: 250,
      retryInitialMs: 250,
      retryMaximumMs: 1_000,
    },
    rpcCaller: options.rpcCaller,
    intelligenceService: { url: options.configuration.intelligenceUrl, token: options.configuration.internalToken },
    s3: {
      region: "rc1a-local",
      bucket: "meddecode-local-synthetic",
      client: options.storageClient,
      temporaryRoot: options.configuration.temporaryRoot,
    },
    review: { store: options.reviewStore, intelligence: options.confirmedIntelligence },
    controlledSingleAttempt: true,
    beforeClaim: async () => true,
  });
}
