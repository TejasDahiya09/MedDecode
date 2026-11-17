import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";

import type { PrescriptionFileType } from "../types/prescriptions.js";

export interface PrescriptionStorageUpload {
  readonly objectKey: string;
  readonly bytes: Buffer;
  readonly fileType: PrescriptionFileType;
}

export interface PrescriptionStorage {
  upload(input: PrescriptionStorageUpload): Promise<void>;
  delete(objectKey: string): Promise<void>;
}

export class PrescriptionStorageError extends Error {
  constructor() {
    super("Prescription storage operation failed.");
    this.name = "PrescriptionStorageError";
  }
}

export function createS3PrescriptionStorage(options: {
  readonly region: string;
  readonly bucket: string;
  readonly client?: S3Client;
  readonly timeoutMs?: number;
}): PrescriptionStorage {
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) throw new Error("S3 timeout is invalid.");
  const client = options.client ?? new S3Client({ region: options.region });

  return {
    async upload(input) {
      try {
        await client.send(new PutObjectCommand({
          Bucket: options.bucket,
          Key: input.objectKey,
          Body: input.bytes,
          ContentType: input.fileType,
          ServerSideEncryption: "AES256"
        }), { abortSignal: AbortSignal.timeout(timeoutMs) });
      } catch {
        throw new PrescriptionStorageError();
      }
    },

    async delete(objectKey) {
      try {
        await client.send(new DeleteObjectCommand({
          Bucket: options.bucket,
          Key: objectKey
        }), { abortSignal: AbortSignal.timeout(timeoutMs) });
      } catch {
        throw new PrescriptionStorageError();
      }
    }
  };
}
