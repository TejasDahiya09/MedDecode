import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

import type { UserSupabaseClient } from "../config/supabase-user.js";
import type { PrescriptionFileType } from "../types/prescriptions.js";

const TYPES = new Set<PrescriptionFileType>(["application/pdf", "image/jpeg", "image/png"]);

export type PrescriptionDocumentPreviewStage = "metadata_lookup" | "metadata_validation" | "storage_request" | "storage_stream";
export type PrescriptionDocumentPreviewCategory =
  "not_found" | "persistence" | "configuration" | "access_denied" | "object_not_found" |
  "timeout" | "cancelled" | "malformed_response" | "size_limit" | "provider";

export class PrescriptionDocumentPreviewError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "UNAVAILABLE" | "TOO_LARGE",
    readonly stage: PrescriptionDocumentPreviewStage,
    readonly category: PrescriptionDocumentPreviewCategory,
    readonly providerStatusClass?: "4xx" | "5xx",
  ) {
    super("Prescription document preview failed safely.");
    this.name = "PrescriptionDocumentPreviewError";
  }
}

export interface PrescriptionDocumentPreview {
  readonly bytes: Buffer;
  readonly contentType: PrescriptionFileType;
}

export interface PrescriptionDocumentPreviewService {
  load(client: UserSupabaseClient, ownerId: string, prescriptionId: string, signal?: AbortSignal): Promise<PrescriptionDocumentPreview>;
}

async function disposeBody(body: unknown): Promise<void> {
  if (!body || typeof body !== "object") return;
  const disposable = body as { destroy?: () => void; cancel?: () => Promise<unknown> };
  try {
    if (typeof disposable.destroy === "function") disposable.destroy();
    else if (typeof disposable.cancel === "function") await disposable.cancel();
  } catch { /* the original safe failure remains authoritative */ }
}

async function bodyBytes(body: unknown, maximumBytes: number, signal?: AbortSignal): Promise<Buffer> {
  if (!body || typeof body !== "object" || !(Symbol.asyncIterator in body)) {
    throw new PrescriptionDocumentPreviewError("UNAVAILABLE", "storage_stream", "malformed_response");
  }
  const chunks: Buffer[] = []; let size = 0;
  try {
    for await (const value of body as AsyncIterable<unknown>) {
      if (signal?.aborted) throw new PrescriptionDocumentPreviewError("UNAVAILABLE", "storage_stream", "cancelled");
      if (!(value instanceof Uint8Array)) throw new PrescriptionDocumentPreviewError("UNAVAILABLE", "storage_stream", "malformed_response");
      size += value.byteLength;
      if (size > maximumBytes) throw new PrescriptionDocumentPreviewError("TOO_LARGE", "storage_stream", "size_limit");
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    await disposeBody(body);
    throw error;
  }
  if (size < 1) {
    await disposeBody(body);
    throw new PrescriptionDocumentPreviewError("UNAVAILABLE", "storage_stream", "malformed_response");
  }
  return Buffer.concat(chunks, size);
}

function providerStatusClass(error: unknown): "4xx" | "5xx" | undefined {
  const status = typeof error === "object" && error !== null && "$metadata" in error
    ? Number((error as { $metadata?: { httpStatusCode?: unknown } }).$metadata?.httpStatusCode)
    : NaN;
  if (status >= 400 && status < 500) return "4xx";
  if (status >= 500 && status < 600) return "5xx";
  return undefined;
}

function storageError(error: unknown, callerAborted: boolean, timedOut: boolean): PrescriptionDocumentPreviewError {
  if (callerAborted) return new PrescriptionDocumentPreviewError("UNAVAILABLE", "storage_request", "cancelled");
  if (timedOut) return new PrescriptionDocumentPreviewError("UNAVAILABLE", "storage_request", "timeout");
  const name = typeof error === "object" && error !== null && "name" in error ? String(error.name) : "";
  const statusClass = providerStatusClass(error);
  if (name === "AccessDenied" || name === "Forbidden") return new PrescriptionDocumentPreviewError("UNAVAILABLE", "storage_request", "access_denied", statusClass);
  if (name === "NoSuchKey" || name === "NotFound") return new PrescriptionDocumentPreviewError("UNAVAILABLE", "storage_request", "object_not_found", statusClass);
  return new PrescriptionDocumentPreviewError("UNAVAILABLE", "storage_request", "provider", statusClass);
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
    } catch { throw new PrescriptionDocumentPreviewError("UNAVAILABLE", "metadata_lookup", "persistence"); }
    if (result.error) throw new PrescriptionDocumentPreviewError("UNAVAILABLE", "metadata_lookup", "persistence");
    const row = result.data as Record<string, unknown> | null;
    if (!row) throw new PrescriptionDocumentPreviewError("NOT_FOUND", "metadata_lookup", "not_found");
    if (row.storage_provider !== "aws_s3" || row.storage_bucket !== options.bucket || typeof row.object_key !== "string" ||
        !TYPES.has(row.file_type as PrescriptionFileType) || Number(row.file_size_bytes) < 1 || Number(row.file_size_bytes) > options.maximumBytes) {
      throw new PrescriptionDocumentPreviewError("UNAVAILABLE", "metadata_validation", "configuration");
    }
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const combined = AbortSignal.any([signal ?? new AbortController().signal, timeoutSignal]);
    let response: { Body?: unknown };
    try {
      response = await s3.send(new GetObjectCommand({ Bucket: options.bucket, Key: row.object_key }), { abortSignal: combined } as never) as { Body?: unknown };
    } catch (error) {
      throw storageError(error, signal?.aborted === true, timeoutSignal.aborted);
    }
    try {
      return { bytes: await bodyBytes(response.Body, options.maximumBytes, combined), contentType: row.file_type as PrescriptionFileType };
    } catch (error) {
      if (error instanceof PrescriptionDocumentPreviewError) throw error;
      const requestError = storageError(error, signal?.aborted === true, timeoutSignal.aborted);
      throw new PrescriptionDocumentPreviewError(requestError.code, "storage_stream", requestError.category, requestError.providerStatusClass);
    }
  }};
}
