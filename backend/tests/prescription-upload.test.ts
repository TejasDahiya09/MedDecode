import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { S3Client } from "@aws-sdk/client-s3";
import request from "supertest";

import { createApp } from "../src/app.js";
import type {
  UserSupabaseClient,
  UserSupabaseClientFactory
} from "../src/config/supabase-user.js";
import type { ProfileRepository } from "../src/repositories/profile.repository.js";
import {
  PrescriptionRepositoryError,
  type PrescriptionRepository
} from "../src/repositories/prescription.repository.js";
import type {
  PrescriptionStorage,
  PrescriptionStorageUpload
} from "../src/services/prescription-storage.service.js";
import {
  createS3PrescriptionStorage,
  PrescriptionStorageError
} from "../src/services/prescription-storage.service.js";
import type { AuthVerifier } from "../src/services/auth.service.js";
import type {
  PrescriptionInsert,
  PrescriptionRecord
} from "../src/types/prescriptions.js";

const userId = "00000000-0000-4000-8000-000000000001";
const prescriptionId = "10000000-0000-4000-8000-000000000001";
const bucket = "private-meddecode-test-bucket";
const maximumFileSizeBytes = 512;

const verifier: AuthVerifier = {
  async verifyAccessToken() {
    return { userId, email: "synthetic@example.invalid" };
  }
};

const userClient = {} as UserSupabaseClient;
const userClientFactory: UserSupabaseClientFactory = () => userClient;

const unusedProfileRepository = {
  async findApplicationUser() { throw new Error("Not used."); },
  async findHealthProfile() { throw new Error("Not used."); },
  async updateApplicationUser() { throw new Error("Not used."); },
  async createHealthProfile() { throw new Error("Not used."); },
  async updateHealthProfile() { throw new Error("Not used."); }
} as ProfileRepository;

function jpeg(): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x04, 0x00, 0x00, 0xff, 0xd9]);
}

function png(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  );
}

function pdf(size?: number): Buffer {
  const prefix = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n", "ascii");
  const suffix = Buffer.from("%%EOF\n", "ascii");
  if (size === undefined) return Buffer.concat([prefix, suffix]);
  assert.ok(size >= prefix.length + suffix.length);
  return Buffer.concat([
    prefix,
    Buffer.alloc(size - prefix.length - suffix.length, 0x20),
    suffix
  ]);
}

class StorageProbe implements PrescriptionStorage {
  readonly uploads: PrescriptionStorageUpload[] = [];
  readonly deletes: string[] = [];
  uploadFailure?: Error;
  deleteFailure?: Error;

  async upload(input: PrescriptionStorageUpload): Promise<void> {
    this.uploads.push(input);
    if (this.uploadFailure) throw this.uploadFailure;
  }

  async delete(objectKey: string): Promise<void> {
    this.deletes.push(objectKey);
    if (this.deleteFailure) throw this.deleteFailure;
  }
}

class RepositoryProbe implements PrescriptionRepository {
  readonly creates: Array<{
    client: UserSupabaseClient;
    input: PrescriptionInsert;
  }> = [];
  failure?: Error;
  observed: PrescriptionRecord | null = null;
  findFailure?: Error;
  readonly finds: Array<{ userId: string; prescriptionId: string }> = [];

  async create(
    client: UserSupabaseClient,
    input: PrescriptionInsert
  ): Promise<PrescriptionRecord> {
    this.creates.push({ client, input });
    if (this.failure) throw this.failure;
    return {
      ...input,
      created_at: "2026-11-11T10:00:00.000Z",
      updated_at: "2026-11-11T10:00:00.000Z"
    };
  }

  async findOwnedById(
    _client: UserSupabaseClient,
    ownerId: string,
    recordId: string
  ): Promise<PrescriptionRecord | null> {
    this.finds.push({ userId: ownerId, prescriptionId: recordId });
    if (this.findFailure) throw this.findFailure;
    return this.observed;
  }
}

function harness(options: {
  readonly storage?: StorageProbe;
  readonly repository?: RepositoryProbe;
  readonly maximum?: number;
} = {}) {
  const storage = options.storage ?? new StorageProbe();
  const repository = options.repository ?? new RepositoryProbe();
  const app = createApp(
    undefined,
    verifier,
    userClientFactory,
    unusedProfileRepository,
    () => ({
      storage,
      repository,
      bucket,
      maximumFileSizeBytes: options.maximum ?? maximumFileSizeBytes,
      uploadTimeoutMs: 500,
      generatePrescriptionId: () => prescriptionId
    })
  );
  return { app, storage, repository };
}

function authenticatedPost(app: ReturnType<typeof createApp>) {
  return request(app)
    .post("/api/v1/prescriptions/upload")
    .set("Authorization", "Bearer synthetic-token");
}

describe("Prescription upload endpoint", () => {
  it("requires verified authentication before parsing or storage", async () => {
    const { app, storage, repository } = harness();
    const response = await request(app)
      .post("/api/v1/prescriptions/upload")
      .attach("file", pdf(), { filename: "safe.pdf", contentType: "application/pdf" });
    assert.equal(response.status, 401);
    assert.deepEqual(storage.uploads, []);
    assert.deepEqual(repository.creates, []);
  });

  it("does not construct upload dependencies for an invalid bearer token", async () => {
    let constructed = 0;
    const rejectingVerifier: AuthVerifier = {
      async verifyAccessToken() { throw new Error("invalid token"); }
    };
    const app = createApp(
      undefined,
      rejectingVerifier,
      userClientFactory,
      unusedProfileRepository,
      () => {
        constructed += 1;
        throw new Error("must not construct");
      }
    );
    const response = await request(app)
      .post("/api/v1/prescriptions/upload")
      .set("Authorization", "Bearer invalid-token")
      .attach("file", pdf(), { filename: "safe.pdf", contentType: "application/pdf" });
    assert.equal(response.status, 401);
    assert.equal(constructed, 0);
  });

  for (const fixture of [
    { label: "JPEG", bytes: jpeg(), mime: "image/jpeg", extension: "jpg" },
    { label: "PNG", bytes: png(), mime: "image/png", extension: "png" },
    { label: "PDF", bytes: pdf(), mime: "application/pdf", extension: "pdf" }
  ]) {
    it(`stores a valid synthetic ${fixture.label} privately and registers ownership`, async () => {
      const { app, storage, repository } = harness();
      const response = await authenticatedPost(app).attach("file", fixture.bytes, {
        filename: "../../patient-name-ignored.bin",
        contentType: fixture.mime
      });

      assert.equal(response.status, 201);
      assert.deepEqual(response.body, {
        prescription_id: prescriptionId,
        upload: {
          state: "stored",
          mime_type: fixture.mime,
          size_bytes: fixture.bytes.length
        },
        processing: { requested: false, job_id: null }
      });
      assert.equal(storage.uploads.length, 1);
      assert.equal(
        storage.uploads[0]?.objectKey,
        `private/prescriptions/${prescriptionId}/source.${fixture.extension}`
      );
      assert.ok(!storage.uploads[0]?.objectKey.includes("patient-name"));
      assert.equal(repository.creates.length, 1);
      assert.equal(repository.creates[0]?.client, userClient);
      assert.deepEqual(repository.creates[0]?.input, {
        id: prescriptionId,
        user_id: userId,
        storage_provider: "aws_s3",
        storage_bucket: bucket,
        object_key: `private/prescriptions/${prescriptionId}/source.${fixture.extension}`,
        file_type: fixture.mime,
        file_size_bytes: fixture.bytes.length,
        status: "uploaded"
      });
      assert.ok(!JSON.stringify(response.body).includes(bucket));
      assert.ok(!JSON.stringify(response.body).includes("private/prescriptions"));
    });
  }

  it("accepts a valid file exactly at the configured boundary", async () => {
    const boundary = 128;
    const bytes = pdf(boundary);
    const { app } = harness({ maximum: boundary });
    const response = await authenticatedPost(app).attach("file", bytes, {
      filename: "boundary.pdf", contentType: "application/pdf"
    });
    assert.equal(response.status, 201);
    assert.equal(response.body.upload.size_bytes, boundary);
  });

  it("rejects empty, unsupported, mismatched, malformed and oversized files before side effects", async () => {
    const cases = [
      { bytes: Buffer.alloc(0), mime: "application/pdf", status: 400, code: "EMPTY_FILE" },
      { bytes: Buffer.from("plain text"), mime: "text/plain", status: 415, code: "UNSUPPORTED_FILE_TYPE" },
      { bytes: png(), mime: "image/jpeg", status: 422, code: "FILE_SIGNATURE_MISMATCH" },
      { bytes: Buffer.from("%PDF-1.4\nno end marker"), mime: "application/pdf", status: 422, code: "MALFORMED_FILE" },
      { bytes: pdf(maximumFileSizeBytes + 1), mime: "application/pdf", status: 413, code: "FILE_TOO_LARGE" }
    ];

    for (const item of cases) {
      const { app, storage, repository } = harness();
      const response = await authenticatedPost(app).attach("file", item.bytes, {
        filename: "synthetic.bin", contentType: item.mime
      });
      assert.equal(response.status, item.status);
      assert.equal(response.body.error.code, item.code);
      assert.deepEqual(storage.uploads, []);
      assert.deepEqual(repository.creates, []);
    }
  });

  it("rejects missing file, wrong field, extra form field and extra file", async () => {
    const requests = [
      authenticatedPost(harness().app).field("unexpected", "value"),
      authenticatedPost(harness().app).attach("document", pdf(), {
        filename: "wrong.pdf", contentType: "application/pdf"
      }),
      authenticatedPost(harness().app)
        .field("unexpected", "value")
        .attach("file", pdf(), { filename: "one.pdf", contentType: "application/pdf" }),
      authenticatedPost(harness().app)
        .attach("file", pdf(), { filename: "one.pdf", contentType: "application/pdf" })
        .attach("file", pdf(), { filename: "two.pdf", contentType: "application/pdf" })
    ];

    for (const pending of requests) {
      const response = await pending;
      assert.equal(response.status, 400);
      assert.equal(response.body.error.code, "INVALID_MULTIPART_REQUEST");
    }
  });

  it("rejects a multipart body with a missing closing boundary", async () => {
    const { app, storage, repository } = harness();
    const response = await authenticatedPost(app)
      .set("Content-Type", "multipart/form-data; boundary=broken")
      .send("--broken\r\nContent-Disposition: form-data; name=\"file\"; filename=\"x.pdf\"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4");
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, "INVALID_MULTIPART_REQUEST");
    assert.deepEqual(storage.uploads, []);
    assert.deepEqual(repository.creates, []);
  });

  it("does not register a prescription after S3 failure", async () => {
    const storage = new StorageProbe();
    storage.uploadFailure = new PrescriptionStorageError();
    const { app, repository } = harness({ storage });
    const response = await authenticatedPost(app).attach("file", pdf(), {
      filename: "safe.pdf", contentType: "application/pdf"
    });
    assert.equal(response.status, 503);
    assert.equal(response.body.error.code, "PRESCRIPTION_STORAGE_FAILED");
    assert.deepEqual(repository.creates, []);
    assert.deepEqual(storage.deletes, []);
  });

  it("attempts exactly one compensating delete after database failure", async () => {
    const repository = new RepositoryProbe();
    repository.failure = new PrescriptionRepositoryError(
      "MISSING_APPLICATION_PROFILE",
      "definite_rejection"
    );
    const { app, storage } = harness({ repository });
    const response = await authenticatedPost(app).attach("file", pdf(), {
      filename: "safe.pdf", contentType: "application/pdf"
    });
    assert.equal(response.status, 500);
    assert.equal(response.body.error.code, "PRESCRIPTION_REGISTRATION_FAILED");
    assert.equal(storage.uploads.length, 1);
    assert.deepEqual(storage.deletes, [storage.uploads[0]?.objectKey]);
    assert.deepEqual(repository.finds, []);
  });

  it("returns a safe cleanup failure without retrying or leaking identifiers", async () => {
    const repository = new RepositoryProbe();
    repository.failure = new PrescriptionRepositoryError(
      "WRITE_DENIED",
      "definite_rejection"
    );
    const storage = new StorageProbe();
    storage.deleteFailure = new PrescriptionStorageError();
    const { app } = harness({ repository, storage });
    const response = await authenticatedPost(app).attach("file", pdf(), {
      filename: "safe.pdf", contentType: "application/pdf"
    });
    assert.equal(response.status, 500);
    assert.equal(response.body.error.code, "PRESCRIPTION_CLEANUP_FAILED");
    assert.equal(storage.uploads.length, 1);
    assert.equal(storage.deletes.length, 1);
    const serialized = JSON.stringify(response.body);
    assert.ok(!serialized.includes(bucket));
    assert.ok(!serialized.includes(prescriptionId));
    assert.ok(!serialized.includes("provider details"));
  });

  it("preserves storage when an owner-scoped read confirms a committed insert", async () => {
    const repository = new RepositoryProbe();
    repository.failure = new Error("response lost after commit");
    repository.observed = {
      id: prescriptionId,
      user_id: userId,
      storage_provider: "aws_s3",
      storage_bucket: bucket,
      object_key: `private/prescriptions/${prescriptionId}/source.pdf`,
      file_type: "application/pdf",
      file_size_bytes: pdf().length,
      status: "uploaded",
      created_at: "2026-11-11T10:00:00.000Z",
      updated_at: "2026-11-11T10:00:00.000Z"
    };
    const { app, storage } = harness({ repository });
    const response = await authenticatedPost(app).attach("file", pdf(), {
      filename: "safe.pdf", contentType: "application/pdf"
    });
    assert.equal(response.status, 201);
    assert.deepEqual(storage.deletes, []);
    assert.deepEqual(repository.finds, [{ userId, prescriptionId }]);
  });

  it("preserves storage when reconciliation finds a mismatching row", async () => {
    const repository = new RepositoryProbe();
    repository.failure = new Error("ambiguous insert");
    repository.observed = {
      id: prescriptionId,
      user_id: userId,
      storage_provider: "aws_s3",
      storage_bucket: bucket,
      object_key: "different-object-key",
      file_type: "application/pdf",
      file_size_bytes: pdf().length,
      status: "uploaded",
      created_at: "2026-11-11T10:00:00.000Z",
      updated_at: "2026-11-11T10:00:00.000Z"
    };
    const { app, storage } = harness({ repository });
    const response = await authenticatedPost(app).attach("file", pdf(), {
      filename: "safe.pdf", contentType: "application/pdf"
    });
    assert.equal(response.status, 500);
    assert.equal(response.body.error.code, "PRESCRIPTION_INTEGRITY_CHECK_FAILED");
    assert.deepEqual(storage.deletes, []);
    assert.ok(!JSON.stringify(response.body).includes("different-object-key"));
  });

  it("preserves storage when reconciliation is absent or inconclusive", async () => {
    for (const findFailure of [undefined, new Error("read unavailable")]) {
      const repository = new RepositoryProbe();
      repository.failure = new Error("ambiguous insert");
      if (findFailure) repository.findFailure = findFailure;
      const { app, storage } = harness({ repository });
      const response = await authenticatedPost(app).attach("file", pdf(), {
        filename: "safe.pdf", contentType: "application/pdf"
      });
      assert.equal(response.status, 500);
      assert.equal(response.body.error.code, "PRESCRIPTION_REGISTRATION_UNCERTAIN");
      assert.deepEqual(storage.deletes, []);
      const serialized = JSON.stringify(response.body);
      assert.ok(!serialized.includes(bucket));
      assert.ok(!serialized.includes(prescriptionId));
      assert.ok(!serialized.includes("read unavailable"));
    }
  });
});

describe("AWS S3 storage adapter commands", () => {
  it("uses private encrypted PutObject and a single-key DeleteObject", async () => {
    const commands: unknown[] = [];
    const client = {
      async send(command: unknown) { commands.push(command); return {}; }
    } as unknown as S3Client;
    const storage = createS3PrescriptionStorage({
      region: "ap-south-1", bucket, client
    });
    const objectKey = `${prescriptionId}/source.pdf`;
    await storage.upload({ objectKey, bytes: pdf(), fileType: "application/pdf" });
    await storage.delete(objectKey);

    assert.equal(commands.length, 2);
    const putInput = (commands[0] as { input: Record<string, unknown> }).input;
    assert.equal(putInput.Bucket, bucket);
    assert.equal(putInput.Key, objectKey);
    assert.equal(putInput.ContentType, "application/pdf");
    assert.equal(putInput.ServerSideEncryption, "AES256");
    assert.ok(!Object.hasOwn(putInput, "ACL"));
    const deleteInput = (commands[1] as { input: Record<string, unknown> }).input;
    assert.deepEqual(deleteInput, { Bucket: bucket, Key: objectKey });
  });

  it("redacts AWS SDK failures", async () => {
    const client = {
      async send() { throw new Error("secret AWS diagnostic"); }
    } as unknown as S3Client;
    const storage = createS3PrescriptionStorage({
      region: "ap-south-1", bucket, client
    });
    await assert.rejects(
      storage.upload({ objectKey: "safe", bytes: pdf(), fileType: "application/pdf" }),
      (error: unknown) => error instanceof PrescriptionStorageError &&
        !error.message.includes("secret AWS diagnostic")
    );
  });
});
