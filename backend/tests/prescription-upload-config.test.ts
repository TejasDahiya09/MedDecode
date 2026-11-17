import assert from "node:assert/strict";
import test from "node:test";
import { getPrescriptionUploadEnv } from "../src/config/env.js";

test("upload configuration cannot exceed the worker's 10 MiB document limit", () => {
  const names = ["AWS_REGION", "AWS_S3_BUCKET", "PRESCRIPTION_MAX_FILE_SIZE_BYTES"] as const;
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    process.env.AWS_REGION = "local-test";
    process.env.AWS_S3_BUCKET = "synthetic-bucket";
    process.env.PRESCRIPTION_MAX_FILE_SIZE_BYTES = String(10 * 1024 * 1024);
    assert.equal(getPrescriptionUploadEnv().maximumFileSizeBytes, 10 * 1024 * 1024);
    process.env.PRESCRIPTION_MAX_FILE_SIZE_BYTES = String(10 * 1024 * 1024 + 1);
    assert.throws(() => getPrescriptionUploadEnv(), /10 MiB/);
  } finally {
    for (const name of names) {
      const value = previous[name];
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
