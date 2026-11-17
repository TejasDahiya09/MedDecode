import assert from "node:assert/strict";
import { mkdtemp, unlink, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { HttpPythonIntelligenceClient, IntelligenceHttpError } from "../src/services/http-python-intelligence.client.js";
import type { IntelligenceRequestV1 } from "../src/types/intelligence-contract-v1.js";

const request: IntelligenceRequestV1 = { schema_version: "1.0", job_id: "10000000-0000-4000-8000-000000000001",
  prescription_id: "20000000-0000-4000-8000-000000000001", document: { access_type: "authorized_url", file_url: "https://worker.invalid/document", file_type: "application/pdf" },
  requested_analysis: { extract_prescription: true, match_medicines: true, find_alternatives: false, generate_recommendations: true } };
const response = { schema_version: "1.0", job_id: request.job_id, prescription_id: request.prescription_id,
  status: "completed_with_warnings", prescription: { prescription_date: null, doctor: { name: null, registration_number: null }, facility: { name: null, address: null, phone: null } },
  patient: { name: null, age: null, gender: null }, medicines: [], recommendations: [], warnings: [], processing_metadata: { overall_confidence: null } };
const token = "test-only-internal-token-at-least-32-characters";

test("authenticated client sends staged bytes and validates Contract v1 response", async () => {
  const directory = await mkdtemp(join(tmpdir(), "meddecode-http-test-")); const file = join(directory, "fixture.pdf");
  const original = globalThis.fetch;
  try {
    await writeFile(file, "%PDF-test");
    globalThis.fetch = async (url, options) => {
      assert.equal(String(url), "http://127.0.0.1:8000/api/v1/intelligence/process");
      assert.equal((options?.headers as Record<string, string>).authorization, `Bearer ${token}`);
      assert.equal(Buffer.from(options?.body as Uint8Array).toString(), "%PDF-test");
      return new Response(JSON.stringify(response), { status: 200 });
    };
    assert.equal((await new HttpPythonIntelligenceClient(file, "http://127.0.0.1:8000", token).analyze(request)).status, "completed_with_warnings");
    globalThis.fetch = async () => new Response(JSON.stringify({ ...response, job_id: request.prescription_id }), { status: 200 });
    await assert.rejects(new HttpPythonIntelligenceClient(file, "http://127.0.0.1:8000", token).analyze(request));
    globalThis.fetch = async () => new Response("private failure", { status: 500 });
    await assert.rejects(new HttpPythonIntelligenceClient(file, "http://127.0.0.1:8000", token).analyze(request), error => error instanceof Error && !error.message.includes("private failure"));
    assert.throws(() => new HttpPythonIntelligenceClient(file, "http://untrusted.invalid", token));
    assert.throws(() => new HttpPythonIntelligenceClient(file, "http://127.0.0.1:8000", "short"));
  } finally { globalThis.fetch = original; await unlink(file); await rmdir(directory); }
});

test("cancellation and request/response limits prevent unsafe transfers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "meddecode-http-limits-"));
  const file = join(directory, "fixture.pdf"); const original = globalThis.fetch; const originalTimeout = AbortSignal.timeout;
  try {
    await writeFile(file, "%PDF-test");
    let calls = 0;
    globalThis.fetch = async (_url, options) => {
      calls += 1;
      const activeSignal = options?.signal;
      return await new Promise<Response>((_resolve, reject) => {
        if (activeSignal?.aborted) return reject(new Error("aborted"));
        activeSignal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    };
    const client = new HttpPythonIntelligenceClient(file, "http://127.0.0.1:8000", token);
    const already = new AbortController(); already.abort();
    await assert.rejects(client.analyze(request, already.signal));
    assert.equal(calls, 0);
    const pending = new AbortController();
    const result = client.analyze(request, pending.signal);
    while (calls === 0) await new Promise(resolve => setTimeout(resolve, 1));
    pending.abort(); await assert.rejects(result);
    assert.equal(calls, 1);
    AbortSignal.timeout = () => originalTimeout(5);
    // The fake transport has no real socket to keep Node's event loop alive.
    const keepAlive = setTimeout(() => undefined, 100);
    try { await assert.rejects(client.analyze(request), /aborted/); }
    finally { clearTimeout(keepAlive); AbortSignal.timeout = originalTimeout; }
    assert.equal(calls, 2);
    globalThis.fetch = async () => new Response("x".repeat(1024 * 1024 + 1), { status: 200 });
    await assert.rejects(client.analyze(request), error => error instanceof IntelligenceHttpError && error.httpStatus === 200 && error.category === 'RESPONSE');
    calls = 0;
    globalThis.fetch = async () => { calls += 1; return new Response("{}"); };
    await writeFile(file, Buffer.alloc(10 * 1024 * 1024 + 1));
    await assert.rejects(client.analyze(request), /Document is unavailable/);
    assert.equal(calls, 0);
  } finally { AbortSignal.timeout = originalTimeout; globalThis.fetch = original; await unlink(file); await rmdir(directory); }
});
