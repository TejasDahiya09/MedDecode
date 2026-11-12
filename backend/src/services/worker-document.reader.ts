import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { finished } from "node:stream/promises";

import type { WorkerJobClaim } from "../types/worker-jobs.js";

const EXTENSIONS: Record<WorkerJobClaim["fileType"], string> = {
  "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png",
};
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const MAX_CONFIGURABLE_BYTES = 50 * 1024 * 1024;

export interface WorkerDocumentHandle {
  readonly path: string;
  readonly sizeBytes: number;
  cleanup(): Promise<void>;
}

export interface WorkerDocumentReader {
  download(claim: WorkerJobClaim, signal: AbortSignal): Promise<WorkerDocumentHandle>;
}

export class WorkerDocumentReadError extends Error {
  constructor(readonly category: "INVALID_REFERENCE" | "UNAVAILABLE" | "TOO_LARGE" | "ABORTED") {
    super("Worker document retrieval failed safely.");
    this.name = "WorkerDocumentReadError";
  }
}

export interface S3GetObjectClient {
  send(command: GetObjectCommand, options?: { abortSignal?: AbortSignal }): Promise<{ Body?: unknown }>;
}

function expectedKey(claim: WorkerJobClaim): string {
  return `private/prescriptions/${claim.prescriptionId}/source.${EXTENSIONS[claim.fileType]}`;
}

async function* bodyChunks(value: unknown): AsyncIterable<Uint8Array> {
  if (value && typeof value === "object" && Symbol.asyncIterator in value) {
    for await (const chunk of value as AsyncIterable<unknown>) {
      if (chunk instanceof Uint8Array) yield chunk;
      else throw new WorkerDocumentReadError("UNAVAILABLE");
    }
    return;
  }
  // Do not use SDK convenience methods such as transformToByteArray here:
  // they can allocate the complete object before the configured byte limit is
  // enforced. The Node worker requires a streaming S3 body.
  throw new WorkerDocumentReadError("UNAVAILABLE");
}

export function createS3WorkerDocumentReader(options: {
  readonly region: string;
  readonly bucket: string;
  readonly maximumBytes?: number;
  readonly temporaryRoot?: string;
  readonly client?: S3GetObjectClient;
}): WorkerDocumentReader {
  if (!options.bucket.trim()) throw new Error("Worker document bucket is required.");
  const maximumBytes = options.maximumBytes ?? DEFAULT_MAX_BYTES;
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0 || maximumBytes > MAX_CONFIGURABLE_BYTES) {
    throw new Error("Worker document maximum bytes is invalid.");
  }
  const client = options.client ?? new S3Client({ region: options.region });

  return {
    async download(claim, signal) {
      if (signal.aborted) throw new WorkerDocumentReadError("ABORTED");
      if (claim.storageProvider !== "aws_s3" || claim.storageBucket !== options.bucket ||
          claim.objectKey !== expectedKey(claim)) {
        throw new WorkerDocumentReadError("INVALID_REFERENCE");
      }
      let directory: string | undefined;
      let stream: ReturnType<typeof createWriteStream> | undefined;
      try {
        const response = await client.send(new GetObjectCommand({ Bucket: options.bucket, Key: claim.objectKey }), { abortSignal: signal });
        directory = await mkdtemp(join(options.temporaryRoot ?? tmpdir(), "meddecode-worker-"));
        const path = join(directory, `source.${EXTENSIONS[claim.fileType]}`);
        const writableStream = createWriteStream(path, { flags: "wx", mode: 0o600 });
        stream = writableStream;
        let sizeBytes = 0;
        for await (const chunk of bodyChunks(response.Body)) {
          if (signal.aborted) throw new WorkerDocumentReadError("ABORTED");
          sizeBytes += chunk.byteLength;
          if (sizeBytes > maximumBytes) throw new WorkerDocumentReadError("TOO_LARGE");
          if (!writableStream.write(chunk)) await new Promise<void>((resolve, reject) => {
            writableStream.once("drain", resolve); writableStream.once("error", reject);
          });
        }
        writableStream.end(); await finished(writableStream);
        let cleaned = false;
        return {
          path, sizeBytes,
          async cleanup() {
            if (cleaned) return;
            cleaned = true;
            await rm(directory!, { recursive: true, force: true });
          },
        };
      } catch (error) {
        // Close the local handle before recursive removal. This matters on
        // Windows where an open stream can otherwise prevent cleanup after a
        // size-limit, abort, or provider-stream failure.
        if (stream && !stream.destroyed) {
          stream.destroy();
          await finished(stream).catch(() => undefined);
        }
        if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
        if (error instanceof WorkerDocumentReadError) throw error;
        throw new WorkerDocumentReadError(signal.aborted ? "ABORTED" : "UNAVAILABLE");
      }
    },
  };
}
