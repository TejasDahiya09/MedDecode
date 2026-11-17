import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from "node:child_process";
import { statSync } from "node:fs";
import { basename } from "node:path";

import type { IntelligenceClient } from "./intelligence-client.js";
import type { RealPdfIntelligenceClientFactory } from "./real-prescription-worker.handler.js";
import { validateIntelligenceRequestV1, validateIntelligenceResponseV1 } from "./intelligence-contract-v1.validator.js";
import type { IntelligenceRequestV1, IntelligenceResponseV1 } from "../types/intelligence-contract-v1.js";

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_STDOUT_BYTES = 1024 * 1024;
const DEFAULT_MAX_STDERR_BYTES = 64 * 1024;
export const CATALOGUE_ENV_KEYS = ["MEDDECODE_CATALOGUE_ENV", "MEDDECODE_CATALOGUE_HOST", "MEDDECODE_CATALOGUE_PORT", "MEDDECODE_CATALOGUE_DATABASE", "MEDDECODE_CATALOGUE_USER", "MEDDECODE_CATALOGUE_SSLMODE", "MEDDECODE_CATALOGUE_SSLROOTCERT", "MEDDECODE_CATALOGUE_CONNECT_TIMEOUT_SECONDS", "MEDDECODE_CATALOGUE_PASSFILE", "MEDDECODE_CATALOGUE_PASSWORD"] as const;
export type CatalogueEnvironment = Readonly<Partial<Record<(typeof CATALOGUE_ENV_KEYS)[number], string>>>;

export class IntelligenceTransportError extends Error {
  constructor(readonly code:
    "SPAWN_FAILED" | "TIMEOUT" | "ABORTED" | "OUTPUT_LIMIT" | "PROCESS_EXIT" |
    "INVALID_OUTPUT" | "FIXTURE_MODE_NOT_ENABLED" | "REAL_DOCUMENT_NOT_CONFIGURED" |
    "EASYOCR_MODEL_DIRECTORY_UNAVAILABLE" | "AWS_TEXTRACT_REGION_UNAVAILABLE") {
    super("The local intelligence adapter failed safely.");
    this.name = "IntelligenceTransportError";
  }
}
export interface JsonSubprocessOptions {
  executable: string;
  args: readonly string[];
  cwd: string;
  input: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
  catalogueEnvironment?: CatalogueEnvironment;
  /** Test seam; production always uses node:child_process spawn. */
  spawnProcess?: (
    executable: string,
    args: readonly string[],
    options: SpawnOptionsWithoutStdio,
  ) => ChildProcessWithoutNullStreams;
  /** Test seam; production always terminates the complete process tree. */
  terminateTree?: (pid: number | undefined) => void;
}

function terminateProcessTree(pid: number | undefined): void {
  if (pid === undefined) return;
  if (process.platform === "win32") {
    // `taskkill /T` includes Python children such as multiprocessing workers.
    // Its result is intentionally ignored: the caller still receives only the
    // safe adapter error and never provider diagnostics.
    try {
      const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      killer.once("error", () => undefined);
      killer.unref();
    } catch { /* process may already be gone */ }
    return;
  }
  try { process.kill(-pid, "SIGKILL"); } catch { /* already exited */ }
}

export async function runJsonSubprocess(options: JsonSubprocessOptions): Promise<string> {
  if (options.signal?.aborted) throw new IntelligenceTransportError("ABORTED");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxStdoutBytes = options.maxStdoutBytes ?? DEFAULT_MAX_STDOUT_BYTES;
  const maxStderrBytes = options.maxStderrBytes ?? DEFAULT_MAX_STDERR_BYTES;

  return new Promise((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams;
    try { child = (options.spawnProcess ?? spawn)(options.executable, [...options.args], {
      cwd: options.cwd,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
      env: {
        PYTHONIOENCODING: "utf-8", PATH: process.env.PATH ?? "",
        ...(process.env.PGPASSFILE && options.catalogueEnvironment?.MEDDECODE_CATALOGUE_ENV !== "hosted" ? { PGPASSFILE: process.env.PGPASSFILE } : {}),
        ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
        ...Object.fromEntries(CATALOGUE_ENV_KEYS.flatMap(key => options.catalogueEnvironment?.[key] === undefined ? [] : [[key, options.catalogueEnvironment[key]]] )) ,
      },
    }) as ChildProcessWithoutNullStreams; } catch {
      reject(new IntelligenceTransportError("SPAWN_FAILED"));
      return;
    }
    let settled = false;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const stdout: Buffer[] = [];

    let drainTimer: NodeJS.Timeout | undefined;
    const releaseHandles = () => {
      if (drainTimer !== undefined) clearTimeout(drainTimer);
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
    };
    const finish = (error?: IntelligenceTransportError, output?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      releaseHandles();
      if (error) reject(error);
      else resolve(output ?? "");
    };
    const terminate = (error: IntelligenceTransportError) => {
      if (settled) return;
      try {
        if (options.terminateTree !== undefined) options.terminateTree(child.pid);
        else if (process.platform === "win32") terminateProcessTree(child.pid);
        else {
          child.kill("SIGKILL");
          terminateProcessTree(child.pid);
        }
      } catch { /* report only the original safe error */ }
      finally { finish(error); }
    };
    const timer = setTimeout(() => terminate(new IntelligenceTransportError("TIMEOUT")), timeoutMs);
    const abort = () => terminate(new IntelligenceTransportError("ABORTED"));
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) { abort(); return; }

    child.once("error", () => finish(new IntelligenceTransportError("SPAWN_FAILED")));
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxStdoutBytes) return terminate(new IntelligenceTransportError("OUTPUT_LIMIT"));
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > maxStderrBytes) terminate(new IntelligenceTransportError("OUTPUT_LIMIT"));
    });
    const handleExit = (code: number | null) => {
      if (code !== 0) return finish(new IntelligenceTransportError("PROCESS_EXIT"));
      const complete = () => {
        if (!child.stdout.readableEnded) (options.terminateTree ?? terminateProcessTree)(child.pid);
        finish(undefined, Buffer.concat(stdout).toString("utf8"));
      };
      if (child.stdout.readableEnded) complete();
      else drainTimer = setTimeout(complete, 50);
    };
    // `close` can wait forever when a Python descendant inherits a pipe. The
    // direct child's `exit` is authoritative; allow a short stdout drain and
    // then release inherited pipe handles.
    child.once("exit", handleExit);
    child.once("close", handleExit);
    child.stdin.once("error", () => terminate(new IntelligenceTransportError("PROCESS_EXIT")));
    child.stdin.end(options.input, "utf8");
  });
}

export class LocalPythonIntelligenceClient implements IntelligenceClient {
  constructor(private readonly options: {
    pythonExecutable: string;
    intelligenceDirectory: string;
    worker?: "synthetic" | "real-layers-offline" | "development-local-pdf-fixture" | "real-local-pdf";
    /**
     * Deliberately narrow, development-only route. The Python entry point
     * independently verifies the fixture name and synthetic markers.
     */
    developmentFixture?: Readonly<{
      mode: "fictional-pdf-injected-ocr";
      pdfPath: string;
    }>;
    /** A worker-supplied temporary path; never accepted from an HTTP request. */
    realLocalPdfPath?: string;
    /** Required only by the real local-PDF worker; supplied by worker composition. */
    easyOcrModelDirectory?: string;
    /** Cloud OCR remains unavailable unless explicitly selected. */
    ocrProvider?: "easyocr" | "aws-textract" | "google-cloud-vision";
    /** Required only for an explicitly selected Textract worker. */
    awsRegion?: string;
    /** Local-only official catalogue lookup; never enabled by default. */
    officialCatalogueLocal?: boolean;
    catalogueEnvironment?: CatalogueEnvironment;
    timeoutMs?: number;
    run?: typeof runJsonSubprocess;
  }) {}

  async analyze(request: IntelligenceRequestV1, signal?: AbortSignal): Promise<IntelligenceResponseV1> {
    const validated = validateIntelligenceRequestV1(request);
    const fixture = this.options.developmentFixture;
    const isFixtureWorker = this.options.worker === "development-local-pdf-fixture";
    const isRealLocalPdfWorker = this.options.worker === "real-local-pdf";
    const ocrProvider = this.options.ocrProvider ?? "easyocr";
    if (isFixtureWorker && (
      fixture?.mode !== "fictional-pdf-injected-ocr" ||
      basename(fixture.pdfPath) !== "synthetic-prescription-001.pdf"
    )) {
      throw new IntelligenceTransportError("FIXTURE_MODE_NOT_ENABLED");
    }
    if (!isFixtureWorker && fixture !== undefined) {
      throw new IntelligenceTransportError("FIXTURE_MODE_NOT_ENABLED");
    }
    if (isRealLocalPdfWorker && (!this.options.realLocalPdfPath || fixture !== undefined)) {
      throw new IntelligenceTransportError("REAL_DOCUMENT_NOT_CONFIGURED");
    }
    if (isRealLocalPdfWorker && ocrProvider === "easyocr" && !directoryExists(this.options.easyOcrModelDirectory)) {
      throw new IntelligenceTransportError("EASYOCR_MODEL_DIRECTORY_UNAVAILABLE");
    }
    if (isRealLocalPdfWorker && ocrProvider === "aws-textract" && !this.options.awsRegion?.trim()) {
      throw new IntelligenceTransportError("AWS_TEXTRACT_REGION_UNAVAILABLE");
    }
    const workerModule = isFixtureWorker
      ? "app.integration.development_fixture_worker"
      : isRealLocalPdfWorker
        ? "app.integration.local_pdf_worker"
      : this.options.worker === "real-layers-offline"
        ? "app.integration.offline_pipeline_worker"
        : "app.integration.synthetic_worker";
    const args = isFixtureWorker
      ? ["-m", workerModule, "--fictional-fixture-pdf", fixture!.pdfPath, "--injected-ocr-fixture"]
      : isRealLocalPdfWorker
        ? ocrProvider === "aws-textract"
          ? [
              "-m", workerModule,
              "--local-pdf-path", this.options.realLocalPdfPath!,
              "--ocr-provider", "aws-textract",
              "--aws-region", this.options.awsRegion!,
            ]
          : ocrProvider === "google-cloud-vision"
            ? [
                "-m", workerModule,
                "--local-pdf-path", this.options.realLocalPdfPath!,
                "--ocr-provider", "google-cloud-vision",
              ]
          : [
            "-m", workerModule,
            "--local-pdf-path", this.options.realLocalPdfPath!,
            "--ocr-provider", "easyocr",
            "--easyocr-model-directory", this.options.easyOcrModelDirectory!,
          ]
        : ["-m", workerModule];
    if (isRealLocalPdfWorker && this.options.catalogueEnvironment) args.push("--official-catalogue");
    else if (isRealLocalPdfWorker && this.options.officialCatalogueLocal) args.push("--official-catalogue-local");
    const output = await (this.options.run ?? runJsonSubprocess)({
      executable: this.options.pythonExecutable,
      args,
      cwd: this.options.intelligenceDirectory,
      input: JSON.stringify(validated),
      ...(this.options.catalogueEnvironment === undefined ? {} : { catalogueEnvironment: this.options.catalogueEnvironment }),
      ...(signal === undefined ? {} : { signal }),
      ...(this.options.timeoutMs === undefined
        ? (isRealLocalPdfWorker ? { timeoutMs: 120_000 } : {})
        : { timeoutMs: this.options.timeoutMs }),
    });
    let parsed: unknown;
    try {
      parsed = JSON.parse(output);
    } catch {
      throw new IntelligenceTransportError("INVALID_OUTPUT");
    }
    return validateIntelligenceResponseV1(parsed, { jobId: validated.job_id, prescriptionId: validated.prescription_id });
  }
}

function directoryExists(value: string | undefined): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    return statSync(value).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Binds a real Python subprocess to a path created by WorkerDocumentReader.
 * The path is deliberately not an environment value or HTTP input.
 */
export function createRealLocalPdfIntelligenceClientFactory(options: {
  readonly pythonExecutable: string;
  readonly intelligenceDirectory: string;
  /** Explicit worker configuration; never defaulted to a developer-local path. */
  readonly easyOcrModelDirectory?: string;
  readonly ocrProvider?: "easyocr" | "aws-textract" | "google-cloud-vision";
  readonly awsRegion?: string;
  readonly officialCatalogueLocal?: boolean;
  readonly catalogueEnvironment?: CatalogueEnvironment;
  readonly timeoutMs?: number;
  /** Test seam only; the selected Python module remains real-local-pdf. */
  readonly run?: typeof runJsonSubprocess;
}): RealPdfIntelligenceClientFactory {
  return (localPdfPath) => new LocalPythonIntelligenceClient({
    pythonExecutable: options.pythonExecutable,
    intelligenceDirectory: options.intelligenceDirectory,
    worker: "real-local-pdf",
    realLocalPdfPath: localPdfPath,
    ...(options.easyOcrModelDirectory === undefined ? {} : { easyOcrModelDirectory: options.easyOcrModelDirectory }),
    ...(options.ocrProvider === undefined ? {} : { ocrProvider: options.ocrProvider }),
    ...(options.awsRegion === undefined ? {} : { awsRegion: options.awsRegion }),
    ...(options.officialCatalogueLocal === true ? { officialCatalogueLocal: true } : {}),
    ...(options.catalogueEnvironment === undefined ? {} : { catalogueEnvironment: options.catalogueEnvironment }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.run === undefined ? {} : { run: options.run }),
  });
}
