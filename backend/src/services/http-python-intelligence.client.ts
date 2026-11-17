import { readFile, stat } from "node:fs/promises";
import type { IntelligenceClient } from "./intelligence-client.js";
import { validateIntelligenceRequestV1, validateIntelligenceResponseV1 } from "./intelligence-contract-v1.validator.js";
import type { IntelligenceRequestV1, IntelligenceResponseV1 } from "../types/intelligence-contract-v1.js";

const MAX_DOCUMENT = 10 * 1024 * 1024;
const MAX_RESPONSE = 1024 * 1024;

export class IntelligenceHttpError extends Error {
  constructor(readonly httpStatus: number, readonly category: 'HTTP' | 'RESPONSE') {
    super('Intelligence service request failed safely.');
  }
}

/** Only the server-side S3 reader supplies this path; no caller-supplied URL is fetched. */
export class HttpPythonIntelligenceClient implements IntelligenceClient {
  private readonly endpoint: URL;
  constructor(private readonly filePath: string, url: string, private readonly token: string) {
    let endpoint: URL;
    try { endpoint = new URL(url); } catch { throw new Error("Invalid intelligence service URL."); }
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
        !((endpoint.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname)) || endpoint.protocol === "https:") ||
        token.length < 32) throw new Error("Invalid internal intelligence service configuration.");
    endpoint.pathname = "/api/v1/intelligence/process";
    this.endpoint = endpoint;
  }

  async analyze(input: IntelligenceRequestV1, signal?: AbortSignal): Promise<IntelligenceResponseV1> {
    signal?.throwIfAborted();
    const request = validateIntelligenceRequestV1(input);
    const file = await stat(this.filePath);
    signal?.throwIfAborted();
    if (!file.isFile() || file.size < 1 || file.size > MAX_DOCUMENT) throw new Error("Document is unavailable.");
    const bytes = signal ? await readFile(this.filePath, { signal }) : await readFile(this.filePath);
    signal?.throwIfAborted();
    if (bytes.length !== file.size || bytes.length > MAX_DOCUMENT) throw new Error("Document is unavailable.");
    const metadata = Buffer.from(JSON.stringify(request)).toString("base64");
    if (metadata.length > 8192) throw new Error("Intelligence request is invalid.");
    const timeout = AbortSignal.timeout(120_000);
    const response = await fetch(this.endpoint, {
      method: "POST", headers: { authorization: `Bearer ${this.token}`, "content-type": "application/octet-stream", "x-meddecode-contract": metadata },
      body: bytes, redirect: "error", signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => undefined);
      throw new IntelligenceHttpError(response.status, 'HTTP');
    }
    const reader = response.body.getReader();
    const chunks: Buffer[] = []; let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_RESPONSE) throw new IntelligenceHttpError(response.status, 'RESPONSE');
        chunks.push(Buffer.from(value));
      }
    } finally { await reader.cancel().catch(() => undefined); }
    let output: unknown;
    try {
      output = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      return validateIntelligenceResponseV1(output, { jobId: request.job_id, prescriptionId: request.prescription_id });
    } catch { throw new IntelligenceHttpError(response.status, 'RESPONSE'); }
  }
}
