import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PassThrough } from "node:stream";

import busboy from "busboy";
import type { Request } from "express";

import { AppError } from "../src/middleware/error.middleware.js";
import { parsePrescriptionMultipart } from "../src/middleware/prescription-multipart.js";

function controlledRequest() {
  const request = new PassThrough() as unknown as Request;
  Object.defineProperties(request, {
    headers: { value: { "content-type": "multipart/form-data; boundary=test" } },
    complete: { value: false, writable: true, configurable: true }
  });
  const parser = new PassThrough() as ReturnType<typeof busboy>;
  const pending = parsePrescriptionMultipart(request, 1024, {
    uploadTimeoutMs: 40,
    parserFactory: () => parser
  });
  return { request, parser, pending };
}

async function rejectsWithin(
  pending: Promise<unknown>,
  expectedCode: string
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      assert.rejects(
        pending,
        (error: unknown) => error instanceof AppError && error.code === expectedCode
      ),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Parser promise did not settle.")), 250);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

describe("Prescription multipart lifecycle", () => {
  it("settles immediately when the request is aborted", async () => {
    const { request, pending } = controlledRequest();
    request.emit("aborted");
    await rejectsWithin(pending, "UPLOAD_ABORTED");
  });

  it("settles on a request stream error", async () => {
    const { request, pending } = controlledRequest();
    request.emit("error", new Error("synthetic request failure"));
    await rejectsWithin(pending, "INVALID_MULTIPART_REQUEST");
  });

  it("settles on premature close but ignores a completed close", async () => {
    const first = controlledRequest();
    first.request.emit("close");
    await rejectsWithin(first.pending, "UPLOAD_ABORTED");

    const second = controlledRequest();
    Object.defineProperty(second.request, "complete", { value: true });
    second.request.emit("close");
    second.parser.emit("error", new Error("finish test"));
    await rejectsWithin(second.pending, "INVALID_MULTIPART_REQUEST");
  });

  it("settles on parser error without requiring close", async () => {
    const { parser, pending } = controlledRequest();
    parser.emit("error", new Error("synthetic parser failure"));
    await rejectsWithin(pending, "INVALID_MULTIPART_REQUEST");
  });

  it("settles on a file stream error", async () => {
    const { parser, pending } = controlledRequest();
    const file = new PassThrough();
    parser.emit("file", "file", file, {
      filename: "synthetic.pdf",
      encoding: "7bit",
      mimeType: "application/pdf"
    });
    file.emit("error", new Error("synthetic file failure"));
    await rejectsWithin(pending, "INVALID_MULTIPART_REQUEST");
  });

  it("settles exactly once when multiple terminal events race", async () => {
    const { request, parser, pending } = controlledRequest();
    parser.emit("error", new Error("first failure"));
    request.emit("aborted");
    parser.emit("close");
    await rejectsWithin(pending, "INVALID_MULTIPART_REQUEST");
  });

  it("times out a stalled multipart upload", async () => {
    const { pending } = controlledRequest();
    await rejectsWithin(pending, "UPLOAD_TIMEOUT");
  });
});
