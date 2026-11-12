import busboy from "busboy";
import { fileTypeFromBuffer } from "file-type";
import type { Request } from "express";
import type { Readable } from "node:stream";

import { AppError } from "./error.middleware.js";
import type {
  PrescriptionFileExtension,
  PrescriptionFileType,
  ValidatedPrescriptionFile
} from "../types/prescriptions.js";

const supportedTypes = new Map<PrescriptionFileType, PrescriptionFileExtension>([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["application/pdf", "pdf"]
]);

type MultipartParser = ReturnType<typeof busboy>;

export interface PrescriptionMultipartOptions {
  readonly uploadTimeoutMs?: number;
  readonly parserFactory?: (configuration: Parameters<typeof busboy>[0]) =>
    MultipartParser;
}

function uploadError(status: number, code: string, message: string): AppError {
  return new AppError(status, code, message);
}

function endsWith(buffer: Buffer, suffix: Buffer): boolean {
  return buffer.length >= suffix.length &&
    buffer.subarray(buffer.length - suffix.length).equals(suffix);
}

function isStructurallyComplete(
  bytes: Buffer,
  type: PrescriptionFileType
): boolean {
  if (type === "image/jpeg") {
    return bytes.length >= 4 && endsWith(bytes, Buffer.from([0xff, 0xd9]));
  }

  if (type === "image/png") {
    return bytes.length >= 20 && endsWith(
      bytes,
      Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
        0xae, 0x42, 0x60, 0x82])
    );
  }

  const tail = bytes.subarray(Math.max(0, bytes.length - 1024)).toString("latin1");
  return bytes.length >= 10 && tail.includes("%%EOF");
}

async function validateFile(
  bytes: Buffer,
  declaredMimeType: string
): Promise<ValidatedPrescriptionFile> {
  if (bytes.length === 0) {
    throw uploadError(400, "EMPTY_FILE", "Uploaded file must not be empty.");
  }

  if (!supportedTypes.has(declaredMimeType as PrescriptionFileType)) {
    throw uploadError(
      415,
      "UNSUPPORTED_FILE_TYPE",
      "Only JPEG, PNG and PDF files are supported."
    );
  }

  const detected = await fileTypeFromBuffer(bytes);
  const detectedMime = detected?.mime as PrescriptionFileType | undefined;
  if (!detectedMime || !supportedTypes.has(detectedMime)) {
    throw uploadError(
      422,
      "FILE_SIGNATURE_MISMATCH",
      "File content does not match a supported document type."
    );
  }

  if (detectedMime !== declaredMimeType) {
    throw uploadError(
      422,
      "FILE_SIGNATURE_MISMATCH",
      "Declared file type does not match file content."
    );
  }

  if (!isStructurallyComplete(bytes, detectedMime)) {
    throw uploadError(
      422,
      "MALFORMED_FILE",
      "Uploaded document appears incomplete or malformed."
    );
  }

  return {
    bytes,
    fileType: detectedMime,
    extension: supportedTypes.get(detectedMime)!,
    sizeBytes: bytes.length
  };
}

export async function parsePrescriptionMultipart(
  request: Request,
  maximumFileSizeBytes: number,
  options: PrescriptionMultipartOptions = {}
): Promise<ValidatedPrescriptionFile> {
  return new Promise((resolve, reject) => {
    let parser: MultipartParser;
    try {
      parser = (options.parserFactory ?? busboy)({
        headers: request.headers,
        limits: {
          // Reserve one byte so an exact-boundary file is accepted while
          // overflow is detected from bytes actually received.
          fileSize: maximumFileSizeBytes + 1,
          files: 2,
          fields: 1,
          parts: 3,
          headerPairs: 50
        }
      });
    } catch {
      reject(uploadError(
        400,
        "INVALID_MULTIPART_REQUEST",
        "A valid multipart upload is required."
      ));
      return;
    }

    let chunks: Buffer[] = [];
    const activeFileStreams = new Set<Readable>();
    let fileCount = 0;
    let declaredMimeType = "";
    let tooLarge = false;
    let invalidParts = false;
    let streamFailure = false;
    let receivedBytes = 0;
    let settled = false;

    const uploadTimeoutMs = options.uploadTimeoutMs ?? 30_000;

    const onRequestAborted = () => fail(uploadError(
      400,
      "UPLOAD_ABORTED",
      "Prescription upload was interrupted."
    ));
    const onRequestError = () => fail(uploadError(
      400,
      "INVALID_MULTIPART_REQUEST",
      "Multipart upload could not be read."
    ));
    const onRequestClose = () => {
      if (!request.complete && !request.readableEnded) onRequestAborted();
    };
    const onParserError = () => fail(uploadError(
      400,
      "INVALID_MULTIPART_REQUEST",
      "Multipart upload could not be read."
    ));

    const cleanup = (destroyStreams: boolean) => {
      clearTimeout(timeout);
      request.off("aborted", onRequestAborted);
      request.off("error", onRequestError);
      request.off("close", onRequestClose);
      request.unpipe(parser);

      if (destroyStreams) {
        for (const stream of activeFileStreams) {
          stream.on("error", () => undefined);
          stream.destroy();
        }
        parser.on("error", () => undefined);
        parser.destroy();
        if (!request.destroyed && !request.readableEnded) request.resume();
      }

      activeFileStreams.clear();
      chunks = [];
      receivedBytes = 0;
    };

    function fail(error: AppError) {
      if (settled) return;
      settled = true;
      cleanup(true);
      reject(error);
    }

    function succeed(file: ValidatedPrescriptionFile) {
      if (settled) return;
      settled = true;
      cleanup(false);
      resolve(file);
    }

    const timeout = setTimeout(() => fail(uploadError(
      408,
      "UPLOAD_TIMEOUT",
      "Prescription upload exceeded the allowed duration."
    )), uploadTimeoutMs);
    timeout.unref();

    parser.on("file", (fieldName, stream, info) => {
      activeFileStreams.add(stream);
      stream.once("close", () => activeFileStreams.delete(stream));
      fileCount += 1;
      if (fieldName !== "file" || fileCount !== 1) {
        invalidParts = true;
        stream.resume();
        return;
      }

      declaredMimeType = info.mimeType.toLowerCase();
      stream.on("limit", () => {
        tooLarge = true;
      });
      stream.on("data", (chunk: Buffer) => {
        receivedBytes += chunk.length;
        if (receivedBytes > maximumFileSizeBytes) {
          tooLarge = true;
          return;
        }
        if (!tooLarge) chunks.push(chunk);
      });
      stream.on("error", () => {
        streamFailure = true;
        fail(uploadError(
          400,
          "INVALID_MULTIPART_REQUEST",
          "Multipart upload could not be read."
        ));
      });
    });

    parser.on("field", () => {
      invalidParts = true;
    });
    parser.on("filesLimit", () => {
      invalidParts = true;
    });
    parser.on("fieldsLimit", () => {
      invalidParts = true;
    });
    parser.on("partsLimit", () => {
      invalidParts = true;
    });
    parser.on("error", onParserError);

    parser.on("close", () => {
      if (tooLarge) {
        reject(uploadError(
          413,
          "FILE_TOO_LARGE",
          "Uploaded file exceeds the allowed size."
        ));
        return;
      }

      if (streamFailure) {
        reject(uploadError(
          400,
          "INVALID_MULTIPART_REQUEST",
          "Multipart upload could not be read."
        ));
        return;
      }

      if (invalidParts || fileCount !== 1) {
        reject(uploadError(
          400,
          "INVALID_MULTIPART_REQUEST",
          "Provide exactly one file using the file field and no other fields."
        ));
        return;
      }

      const bytes = Buffer.concat(chunks, receivedBytes);
      chunks = [];
      void validateFile(bytes, declaredMimeType).then(succeed, (error: unknown) => {
        fail(error instanceof AppError
          ? error
          : uploadError(400, "INVALID_MULTIPART_REQUEST", "Multipart upload could not be read."));
      });
    });

    request.once("aborted", onRequestAborted);
    request.once("error", onRequestError);
    request.once("close", onRequestClose);
    request.pipe(parser);
  });
}
