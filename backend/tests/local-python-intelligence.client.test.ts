import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  IntelligenceTransportError,
  LocalPythonIntelligenceClient,
  runJsonSubprocess,
} from "../src/services/local-python-intelligence.client.js";
import type { IntelligenceRequestV1 } from "../src/types/intelligence-contract-v1.js";

const backendDirectory = process.cwd();
const testDirectory = join(backendDirectory, "tests");
const repositoryDirectory = resolve(backendDirectory, "..");
const intelligenceDirectory = join(repositoryDirectory, "intelligence");
const pythonExecutable = join(intelligenceDirectory, ".venv", "Scripts", "python.exe");
const nodeExecutable = process.execPath;
const request = JSON.parse(readFileSync(join(testDirectory, "fixtures", "intelligence", "request-valid.json"), "utf8")) as IntelligenceRequestV1;

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
