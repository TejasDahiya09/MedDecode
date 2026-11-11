import { spawn } from "node:child_process";

import type { IntelligenceClient } from "./intelligence-client.js";
import { validateIntelligenceRequestV1, validateIntelligenceResponseV1 } from "./intelligence-contract-v1.validator.js";
import type { IntelligenceRequestV1, IntelligenceResponseV1 } from "../types/intelligence-contract-v1.js";

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_STDOUT_BYTES = 1024 * 1024;
const DEFAULT_MAX_STDERR_BYTES = 64 * 1024;

export class IntelligenceTransportError extends Error {
  constructor(readonly code: "SPAWN_FAILED" | "TIMEOUT" | "OUTPUT_LIMIT" | "PROCESS_EXIT" | "INVALID_OUTPUT") {
    super("The local intelligence adapter failed safely.");
    this.name = "IntelligenceTransportError";
  }
}
export interface JsonSubprocessOptions {
  executable: string;
  args: readonly string[];
  cwd: string;
  input: string;
  timeoutMs?: number;
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
}

export async function runJsonSubprocess(options: JsonSubprocessOptions): Promise<string> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxStdoutBytes = options.maxStdoutBytes ?? DEFAULT_MAX_STDOUT_BYTES;
  const maxStderrBytes = options.maxStderrBytes ?? DEFAULT_MAX_STDERR_BYTES;

  return new Promise((resolve, reject) => {
    const child = spawn(options.executable, [...options.args], {
      cwd: options.cwd,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: { PYTHONIOENCODING: "utf-8", PATH: process.env.PATH ?? "" },
    });
    let settled = false;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const stdout: Buffer[] = [];

    const finish = (error?: IntelligenceTransportError, output?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(output ?? "");
    };
    const terminate = (error: IntelligenceTransportError) => {
      child.kill();
      finish(error);
    };
    const timer = setTimeout(() => terminate(new IntelligenceTransportError("TIMEOUT")), timeoutMs);

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
    child.once("close", (code) => {
      if (code !== 0) return finish(new IntelligenceTransportError("PROCESS_EXIT"));
      finish(undefined, Buffer.concat(stdout).toString("utf8"));
    });
    child.stdin.once("error", () => terminate(new IntelligenceTransportError("PROCESS_EXIT")));
    child.stdin.end(options.input, "utf8");
  });
}

export class LocalPythonIntelligenceClient implements IntelligenceClient {
  constructor(private readonly options: {
    pythonExecutable: string;
    intelligenceDirectory: string;
    worker?: "synthetic" | "real-layers-offline";
    timeoutMs?: number;
    run?: typeof runJsonSubprocess;
  }) {}

  async analyze(request: IntelligenceRequestV1): Promise<IntelligenceResponseV1> {
    const validated = validateIntelligenceRequestV1(request);
    const workerModule = this.options.worker === "real-layers-offline"
      ? "app.integration.offline_pipeline_worker"
      : "app.integration.synthetic_worker";
    const output = await (this.options.run ?? runJsonSubprocess)({
      executable: this.options.pythonExecutable,
      args: ["-m", workerModule],
      cwd: this.options.intelligenceDirectory,
      input: JSON.stringify(validated),
      ...(this.options.timeoutMs === undefined ? {} : { timeoutMs: this.options.timeoutMs }),
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
