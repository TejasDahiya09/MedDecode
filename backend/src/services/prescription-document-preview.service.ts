import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

import type { UserSupabaseClient } from "../config/supabase-user.js";
import type { PrescriptionFileType } from "../types/prescriptions.js";

const TYPES = new Set<PrescriptionFileType>(["application/pdf", "image/jpeg", "image/png"]);

export class PrescriptionDocumentPreviewError extends Error {
  constructor(readonly code: "NOT_FOUND" | "UNAVAILABLE" | "TOO_LARGE") {
    super("Prescription document preview failed safely.");
  }
}

export interface PrescriptionDocumentPreview {
  readonly bytes: Buffer;
  readonly contentType: PrescriptionFileType;
}

export interface PrescriptionDocumentPreviewService {
  load(client: UserSupabaseClient, ownerId: string, prescriptionId: string, signal?: AbortSignal): Promise<PrescriptionDocumentPreview>;
}

async function bodyBytes(body: unknown, maximumBytes: number, signal?: AbortSignal): Promise<Buffer> {
  if (!body || typeof body !== "object" || !(Symbol.asyncIterator in body)) throw new PrescriptionDocumentPreviewError("UNAVAILABLE");
  const chunks: Buffer[] = []; let size = 0;
  for await (const value of body as AsyncIterable<unknown>) {
    if (signal?.aborted) throw new PrescriptionDocumentPreviewError("UNAVAILABLE");
    if (!(value instanceof Uint8Array)) throw new PrescriptionDocumentPreviewError("UNAVAILABLE");
    size += value.byteLength;
    if (size > maximumBytes) throw new PrescriptionDocumentPreviewError("TOO_LARGE");
    chunks.push(Buffer.from(value));
  }
  if (size < 1) throw new PrescriptionDocumentPreviewError("UNAVAILABLE");
  return Buffer.concat(chunks, size);
}

export function createS3PrescriptionDocumentPreviewService(options: {
  readonly region: string;
  readonly bucket: string;
  readonly maximumBytes: number;
  readonly timeoutMs?: number;
  readonly client?: Pick<S3Client, "send">;
}): PrescriptionDocumentPreviewService {
  if (!options.bucket.trim() || !Number.isSafeInteger(options.maximumBytes) || options.maximumBytes < 1 || options.maximumBytes > 10 * 1024 * 1024) {
    throw new Error("Prescription preview configuration is invalid.");
  }
  const timeoutMs = options.timeoutMs ?? 30_000;
  const s3 = options.client ?? new S3Client({ region: options.region });
  return { async load(client, ownerId, prescriptionId, signal) {
    let result;
    try {
      result = await client.from("prescriptions")
        .select("id,user_id,storage_provider,storage_bucket,object_key,file_type,file_size_bytes")
        .eq("id", prescriptionId).eq("user_id", ownerId).maybeSingle();
    } catch { throw new PrescriptionDocumentPreviewError("UNAVAILABLE"); }
    if (result.error) throw new PrescriptionDocumentPreviewError("UNAVAILABLE");
    const row = result.data as Record<string, unknown> | null;
    if (!row) throw new PrescriptionDocumentPreviewError("NOT_FOUND");
    if (row.storage_provider !== "aws_s3" || row.storage_bucket !== options.bucket || typeof row.object_key !== "string" ||
        !TYPES.has(row.file_type as PrescriptionFileType) || Number(row.file_size_bytes) < 1 || Number(row.file_size_bytes) > options.maximumBytes) {
      throw new PrescriptionDocumentPreviewError("UNAVAILABLE");
    }
    const combined = AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(timeoutMs)]);
    try {
      const response = await s3.send(new GetObjectCommand({ Bucket: options.bucket, Key: row.object_key }), { abortSignal: combined } as never) as { Body?: unknown };
      return { bytes: await bodyBytes(response.Body, options.maximumBytes, combined), contentType: row.file_type as PrescriptionFileType };
    } catch (error) {
      if (error instanceof PrescriptionDocumentPreviewError) throw error;
      throw new PrescriptionDocumentPreviewError("UNAVAILABLE");
    }
  }};
}
