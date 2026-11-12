import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import test from "node:test";

import {
  IntelligenceTransportError,
  LocalPythonIntelligenceClient,
  createRealLocalPdfIntelligenceClientFactory,
  runJsonSubprocess,
} from "../src/services/local-python-intelligence.client.js";
import { validateIntelligenceResponseV1 } from "../src/services/intelligence-contract-v1.validator.js";
import type { IntelligenceRequestV1 } from "../src/types/intelligence-contract-v1.js";

const backendDirectory = process.cwd();
const testDirectory = join(backendDirectory, "tests");
const repositoryDirectory = resolve(backendDirectory, "..");
const intelligenceDirectory = join(repositoryDirectory, "intelligence");
const pythonExecutable = join(intelligenceDirectory, ".venv", "Scripts", "python.exe");
const fictionalPdf = join(resolve(repositoryDirectory, ".."), "MedDecode-Test-Fixtures", "synthetic-prescription-001.pdf");
const nodeExecutable = process.execPath;
const request = JSON.parse(readFileSync(join(testDirectory, "fixtures", "intelligence", "request-valid.json"), "utf8")) as IntelligenceRequestV1;

function createFakeChild(pid = 43210): ChildProcessWithoutNullStreams {
  const child = new EventEmitter() as unknown as ChildProcessWithoutNullStreams;
  Object.assign(child, {
    pid,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: () => true,
    unref: () => child,
  });
  return child;
}

test("performs a real offline Node to Python Contract v1 round trip", async () => {
  const client = new LocalPythonIntelligenceClient({ pythonExecutable, intelligenceDirectory });
  const response = await client.analyze(request);
  assert.equal(response.status, "completed");
  assert.equal(response.job_id, request.job_id);
  assert.equal(response.prescription_id, request.prescription_id);
});

test("performs a real Layer 2-5 offline round trip and validates its non-empty result", async () => {
  const client = new LocalPythonIntelligenceClient({
    pythonExecutable,
    intelligenceDirectory,
    worker: "real-layers-offline",
  });
  const response = await client.analyze(request);
  assert.equal(response.status, "completed_with_warnings");
  assert.equal(response.job_id, request.job_id);
  assert.equal(response.prescription_id, request.prescription_id);
  assert.equal(response.medicines.length, 2);
  const first = response.medicines[0] as {
    medicine_match: { status: string; medicine_external_id: string | null };
  };
  const second = response.medicines[1] as {
    medicine_match: { status: string };
    extraction: { frequency: { type: string } };
  };
  assert.equal(first.medicine_match.status, "matched");
  assert.equal(first.medicine_match.medicine_external_id, null);
  assert.equal(second.medicine_match.status, "unmatched");
  assert.equal(second.extraction.frequency.type, "as_needed");
  assert.ok(response.warnings.some((warning) => warning.code === "PUBLIC_MEDICINE_IDENTIFIER_UNAVAILABLE"));
});

test("accepts the local-PDF adapter's Contract v1 output without starting real OCR", async () => {
  const output = await runJsonSubprocess({
    executable: pythonExecutable,
    args: ["tests/support/local_pdf_contract_runner.py"],
    cwd: intelligenceDirectory,
    input: JSON.stringify(request),
  });
  const response = validateIntelligenceResponseV1(JSON.parse(output), {
    jobId: request.job_id,
    prescriptionId: request.prescription_id,
  });
  assert.equal(response.status, "completed_with_warnings");
  assert.ok(response.warnings.some((warning) => warning.code === "LOCAL_PDF_FICTIONAL_CATALOGUE"));
});

test("receives and validates the explicitly marked local PDF fixture without real OCR", async () => {
  const client = new LocalPythonIntelligenceClient({
    pythonExecutable,
    intelligenceDirectory,
    worker: "development-local-pdf-fixture",
    developmentFixture: { mode: "fictional-pdf-injected-ocr", pdfPath: fictionalPdf },
  });
  const response = await client.analyze(request);
  assert.equal(response.status, "completed_with_warnings");
  assert.equal(response.job_id, request.job_id);
  assert.equal(response.prescription_id, request.prescription_id);
  assert.ok(response.warnings.some((warning) => warning.code === "DEVELOPMENT_FIXTURE_INJECTED_OCR"));
});

test("refuses fixture mode unless its explicit fictional guard is configured", async () => {
  const client = new LocalPythonIntelligenceClient({
    pythonExecutable,
    intelligenceDirectory,
    worker: "development-local-pdf-fixture",
  });
  await assert.rejects(
    () => client.analyze(request),
    (error: unknown) => error instanceof IntelligenceTransportError && error.code === "FIXTURE_MODE_NOT_ENABLED",
  );
});

test("real-document factory binds a worker-created path to the real PDF worker only", async () => {
  const modelDirectory = await mkdtemp(join(tmpdir(), "meddecode-easyocr-bind-test-"));
  try {
    let received: Parameters<typeof runJsonSubprocess>[0] | undefined;
    const factory = createRealLocalPdfIntelligenceClientFactory({
      pythonExecutable, intelligenceDirectory, easyOcrModelDirectory: modelDirectory,
      run: async options => {
        received = options;
        return JSON.stringify({
          schema_version: "1.0", job_id: request.job_id, prescription_id: request.prescription_id,
          status: "failed", error: {
            code: "PROCESSING_FAILED", message: "Local prescription processing failed safely.", retryable: true,
          },
        });
      },
    });
    const response = await factory("C:\\worker-temp\\source.pdf").analyze(request);
    assert.equal(response.status, "failed");
    assert.equal(response.error.code, "PROCESSING_FAILED");
    assert.deepEqual(received?.args.slice(0, 2), ["-m", "app.integration.local_pdf_worker"]);
    assert.equal(received?.args.includes("--fictional-fixture-pdf"), false);
  } finally {
    await rm(modelDirectory, { recursive: true, force: true });
  }
});

test("real-document factory supplies the required EasyOCR directory and rejects missing configuration before spawn", async () => {
  const modelDirectory = await mkdtemp(join(tmpdir(), "meddecode-easyocr-model-test-"));
  try {
    let received: Parameters<typeof runJsonSubprocess>[0] | undefined;
    const factory = createRealLocalPdfIntelligenceClientFactory({
      pythonExecutable: "test-python",
      intelligenceDirectory,
      easyOcrModelDirectory: modelDirectory,
      run: async options => {
        received = options;
        return JSON.stringify({
          schema_version: "1.0", job_id: request.job_id, prescription_id: request.prescription_id,
          status: "failed", error: {
            code: "PROCESSING_FAILED", message: "Local prescription processing failed safely.", retryable: true,
          },
        });
      },
    });
    const response = await factory("C:\\worker-temp\\source.pdf").analyze(request);
    assert.equal(response.status, "failed");
    assert.deepEqual(received?.args, [
      "-m", "app.integration.local_pdf_worker",
      "--local-pdf-path", "C:\\worker-temp\\source.pdf",
      "--ocr-provider", "easyocr",
      "--easyocr-model-directory", modelDirectory,
    ]);
    assert.equal(received?.args.includes("--fictional-fixture-pdf"), false);
    assert.equal(received?.args.includes("--injected-ocr-fixture"), false);

    let invoked = false;
    const missing = createRealLocalPdfIntelligenceClientFactory({
      pythonExecutable: "test-python", intelligenceDirectory,
      easyOcrModelDirectory: join(modelDirectory, "missing"),
      run: async () => { invoked = true; return "{}"; },
    });
    await assert.rejects(
      () => missing("C:\\worker-temp\\source.pdf").analyze(request),
      (error: unknown) => error instanceof IntelligenceTransportError &&
        error.code === "EASYOCR_MODEL_DIRECTORY_UNAVAILABLE",
    );
    assert.equal(invoked, false);
  } finally {
    await rm(modelDirectory, { recursive: true, force: true });
  }
});
test("real-document factory selects Textract only through explicit worker configuration", async () => {
  let received: Parameters<typeof runJsonSubprocess>[0] | undefined;
  const factory = createRealLocalPdfIntelligenceClientFactory({
    pythonExecutable: "test-python",
    intelligenceDirectory,
    ocrProvider: "aws-textract",
    awsRegion: "ap-south-1",
    run: async options => {
      received = options;
      return JSON.stringify({
        schema_version: "1.0", job_id: request.job_id, prescription_id: request.prescription_id,
        status: "failed", error: {
          code: "PROCESSING_FAILED", message: "Local prescription processing failed safely.", retryable: true,
        },
      });
    },
  });
  assert.equal((await factory("C:\\worker-temp\\source.pdf").analyze(request)).status, "failed");
  assert.deepEqual(received?.args, [
    "-m", "app.integration.local_pdf_worker",
    "--local-pdf-path", "C:\\worker-temp\\source.pdf",
    "--ocr-provider", "aws-textract",
    "--aws-region", "ap-south-1",
  ]);
  assert.equal(received?.args.includes("--easyocr-model-directory"), false);
});
test("real-document factory selects Google Vision only through explicit worker configuration", async () => {
  let received: Parameters<typeof runJsonSubprocess>[0] | undefined;
  const factory = createRealLocalPdfIntelligenceClientFactory({
    pythonExecutable: "test-python",
    intelligenceDirectory,
    ocrProvider: "google-cloud-vision",
    run: async options => {
      received = options;
      return JSON.stringify({
        schema_version: "1.0", job_id: request.job_id, prescription_id: request.prescription_id,
        status: "failed", error: {
          code: "PROCESSING_FAILED", message: "Local prescription processing failed safely.", retryable: true,
        },
      });
    },
  });
  assert.equal((await factory("C:\\worker-temp\\source.pdf").analyze(request)).status, "failed");
  assert.deepEqual(received?.args, [
    "-m", "app.integration.local_pdf_worker",
    "--local-pdf-path", "C:\\worker-temp\\source.pdf",
    "--ocr-provider", "google-cloud-vision",
  ]);
  assert.equal(received?.args.includes("--easyocr-model-directory"), false);
  assert.equal(received?.args.includes("--aws-region"), false);
});
test("reports spawn failure without exposing process details", async () => {
  const client = new LocalPythonIntelligenceClient({ pythonExecutable: join(repositoryDirectory, "missing-python.exe"), intelligenceDirectory });
  await assert.rejects(() => client.analyze(request), (error: unknown) => {
    assert.ok(error instanceof IntelligenceTransportError);
    assert.equal(error.code, "SPAWN_FAILED");
    assert.equal(error.message, "The local intelligence adapter failed safely.");
    return true;
  });
});

test("enforces subprocess timeout", async () => {
  await assert.rejects(
    () => runJsonSubprocess({ executable: nodeExecutable, args: ["-e", "setTimeout(()=>{},10000)"], cwd: backendDirectory, input: "{}", timeoutMs: 30 }),
    (error: unknown) => error instanceof IntelligenceTransportError && error.code === "TIMEOUT",
  );
});
test("settles from child exit when an inherited stdout pipe never closes", async () => {
  const child = createFakeChild();
  let terminationCount = 0;
  const run = runJsonSubprocess({
    executable: "fake-python", args: [], cwd: backendDirectory, input: "{}",
    timeoutMs: 500,
    spawnProcess: () => child,
    terminateTree: () => { terminationCount += 1; },
  });
  (child.stdout as PassThrough).write('{"status":"ok"}');
  child.emit("exit", 0, null);
  assert.equal(await run, '{"status":"ok"}');
  assert.equal(terminationCount, 1);
});

test("times out once, terminates the process tree, and releases inherited pipes", async () => {
  const child = createFakeChild(54321);
  let terminationCount = 0;
  const run = runJsonSubprocess({
    executable: "fake-python", args: [], cwd: backendDirectory, input: "{}",
    timeoutMs: 10,
    spawnProcess: () => child,
    terminateTree: pid => {
      assert.equal(pid, 54321);
      terminationCount += 1;
    },
  });
  await assert.rejects(run, (error: unknown) =>
    error instanceof IntelligenceTransportError && error.code === "TIMEOUT");
  child.emit("exit", 0, null);
  child.emit("close", 0, null);
  assert.equal(terminationCount, 1);
  assert.equal(child.stdout.destroyed, true);
  assert.equal(child.stderr.destroyed, true);
});
test("bounds stdout", async () => {
  await assert.rejects(
    () => runJsonSubprocess({ executable: nodeExecutable, args: ["-e", "process.stdout.write('x'.repeat(1000))"], cwd: backendDirectory, input: "{}", maxStdoutBytes: 32 }),
    (error: unknown) => error instanceof IntelligenceTransportError && error.code === "OUTPUT_LIMIT",
  );
});

test("rejects non-zero subprocess exit", async () => {
  await assert.rejects(
    () => runJsonSubprocess({ executable: nodeExecutable, args: ["-e", "process.exit(7)"], cwd: backendDirectory, input: "{}" }),
    (error: unknown) => error instanceof IntelligenceTransportError && error.code === "PROCESS_EXIT",
  );
});

test("rejects invalid JSON output", async () => {
  const client = new LocalPythonIntelligenceClient({
    pythonExecutable,
    intelligenceDirectory,
    run: async () => "not-json",
  });
  await assert.rejects(
    () => client.analyze(request),
    (error: unknown) => error instanceof IntelligenceTransportError && error.code === "INVALID_OUTPUT",
  );
});
