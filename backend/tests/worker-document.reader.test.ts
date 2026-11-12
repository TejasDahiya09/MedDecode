import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { Readable } from "node:stream";
import test from "node:test";

import { createS3WorkerDocumentReader, WorkerDocumentReadError } from "../src/services/worker-document.reader.js";
import type { WorkerJobClaim } from "../src/types/worker-jobs.js";

const prescriptionId = "20000000-0000-4000-8000-000000000002";
const claim: WorkerJobClaim = { jobId: "10000000-0000-4000-8000-000000000001", prescriptionId, userId: "30000000-0000-4000-8000-000000000003", attemptCount: 1, claimGeneration: 1, leaseExpiresAt: "2026-11-12T12:05:00.000Z", storageProvider: "aws_s3", storageBucket: "private-bucket", objectKey: `private/prescriptions/${prescriptionId}/source.pdf`, fileType: "application/pdf", inputReference: null };

test("streams only the exact claim key into a private temporary file and cleans it", async () => {
  let command: { input?: { Bucket?: string; Key?: string } } | undefined;
  const reader = createS3WorkerDocumentReader({ region: "ap-south-1", bucket: "private-bucket", client: { send: async value => { command = value as unknown as typeof command; return { Body: Readable.from([Buffer.from("%PDF-safe")]) }; } } });
  const handle = await reader.download(claim, new AbortController().signal);
  assert.equal(handle.sizeBytes, 9); assert.match(handle.path, /source\.pdf$/);
  assert.equal(existsSync(handle.path), true);
  assert.deepEqual(command?.input, { Bucket: "private-bucket", Key: claim.objectKey });
  await handle.cleanup(); await handle.cleanup(); assert.equal(existsSync(handle.path), false);
});

test("rejects foreign keys, oversize streams, and non-streaming provider bodies", async () => {
  const reader = createS3WorkerDocumentReader({ region: "ap-south-1", bucket: "private-bucket", maximumBytes: 4, client: { send: async () => ({ Body: Readable.from([Buffer.from("12345")]) }) } });
  await assert.rejects(reader.download(claim, new AbortController().signal), (error: unknown) => error instanceof WorkerDocumentReadError && error.category === "TOO_LARGE");
  const invalid = { ...claim, objectKey: "private/prescriptions/other/source.pdf" };
  await assert.rejects(reader.download(invalid, new AbortController().signal), (error: unknown) => error instanceof WorkerDocumentReadError && error.category === "INVALID_REFERENCE");
  const nonStreaming = createS3WorkerDocumentReader({ region: "ap-south-1", bucket: "private-bucket", client: { send: async () => ({ Body: { transformToByteArray: async () => new Uint8Array(1) } }) } });
  await assert.rejects(nonStreaming.download(claim, new AbortController().signal), (error: unknown) => error instanceof WorkerDocumentReadError && error.category === "UNAVAILABLE");
});
