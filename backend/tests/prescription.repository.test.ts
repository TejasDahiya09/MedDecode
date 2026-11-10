import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { UserSupabaseClient } from "../src/config/supabase-user.js";
import {
  PrescriptionRepositoryError,
  supabasePrescriptionRepository
} from "../src/repositories/prescription.repository.js";
import type {
  PrescriptionInsert,
  PrescriptionRecord
} from "../src/types/prescriptions.js";

const input: PrescriptionInsert = {
  id: "10000000-0000-4000-8000-000000000001",
  user_id: "00000000-0000-4000-8000-000000000001",
  storage_provider: "aws_s3",
  storage_bucket: "private-test-bucket",
  object_key: "private/prescriptions/10000000-0000-4000-8000-000000000001/source.pdf",
  file_type: "application/pdf",
  file_size_bytes: 123,
  status: "uploaded"
};

const record: PrescriptionRecord = {
  ...input,
  created_at: "2026-11-11T10:00:00.000Z",
  updated_at: "2026-11-11T10:00:00.000Z"
};

function clientResult(options: {
  readonly data?: PrescriptionRecord | null;
  readonly error?: unknown;
}) {
  const calls: Array<{ operation: string; value?: unknown }> = [];
  const query = {
    insert(value: unknown) { calls.push({ operation: "insert", value }); return query; },
    select(value: unknown) { calls.push({ operation: "select", value }); return query; },
    eq(column: string, value: unknown) {
      calls.push({ operation: `eq:${column}`, value });
      return query;
    },
    async single() {
      calls.push({ operation: "single" });
      return { data: options.data ?? null, error: options.error ?? null };
    },
    async maybeSingle() {
      calls.push({ operation: "maybeSingle" });
      return { data: options.data ?? null, error: options.error ?? null };
    }
  };
  const client = {
    from(table: string) { calls.push({ operation: "from", value: table }); return query; }
  } as unknown as UserSupabaseClient;
  return { client, calls };
}

describe("Prescription repository contract", () => {
  it("inserts only the exact verified prescription payload and never creates ai_jobs", async () => {
    const { client, calls } = clientResult({ data: record });
    const result = await supabasePrescriptionRepository.create(client, input);
    assert.deepEqual(result, record);
    assert.deepEqual(calls[0], { operation: "from", value: "prescriptions" });
    assert.deepEqual(calls[1], { operation: "insert", value: input });
    assert.ok(!calls.some((call) => call.value === "ai_jobs"));
    assert.ok(!Object.hasOwn(input, "original_filename"));
    assert.ok(!Object.keys(input).some((key) =>
      key.includes("patient") || key.includes("ocr") || key.includes("intelligence")
    ));
  });

  it("fails closed when ownership or returned storage identity differs", async () => {
    for (const changed of [
      { ...record, user_id: "different-user" },
      { ...record, storage_provider: "different-provider" as "aws_s3" },
      { ...record, storage_bucket: "different-bucket" },
      { ...record, object_key: "different-key" },
      { ...record, file_type: "image/png" as const },
      { ...record, file_size_bytes: 999 },
      { ...record, status: "queued" as const }
    ]) {
      const { client } = clientResult({ data: changed as PrescriptionRecord });
      await assert.rejects(
        supabasePrescriptionRepository.create(client, input),
        (error: unknown) => error instanceof PrescriptionRepositoryError &&
          error.code === "AMBIGUOUS_OUTCOME" &&
          error.outcome === "ambiguous"
      );
    }
  });

  it("performs an owner-scoped reconciliation read by server-generated ID", async () => {
    const { client, calls } = clientResult({ data: record });
    const result = await supabasePrescriptionRepository.findOwnedById(
      client,
      input.user_id,
      input.id
    );
    assert.deepEqual(result, record);
    assert.deepEqual(calls.map((call) => call.operation), [
      "from", "select", "eq:id", "eq:user_id", "maybeSingle"
    ]);
    assert.equal(calls[2]?.value, input.id);
    assert.equal(calls[3]?.value, input.user_id);
  });

  it("treats a thrown insert or failed reconciliation read as ambiguous", async () => {
    const throwingClient = {
      from() { throw new Error("network outcome unknown"); }
    } as unknown as UserSupabaseClient;
    await assert.rejects(
      supabasePrescriptionRepository.create(throwingClient, input),
      (error: unknown) => error instanceof PrescriptionRepositoryError &&
        error.outcome === "ambiguous"
    );
    await assert.rejects(
      supabasePrescriptionRepository.findOwnedById(
        throwingClient,
        input.user_id,
        input.id
      ),
      (error: unknown) => error instanceof PrescriptionRepositoryError &&
        error.outcome === "ambiguous"
    );
  });

  it("maps provider failures to non-sensitive repository errors", async () => {
    for (const [providerCode, expected] of [
      ["23503", "MISSING_APPLICATION_PROFILE"],
      ["42501", "WRITE_DENIED"],
      ["23514", "CONSTRAINT_REJECTED"],
      ["unexpected", "AMBIGUOUS_OUTCOME"]
    ] as const) {
      const { client } = clientResult({
        error: { code: providerCode, message: "private provider diagnostic" }
      });
      await assert.rejects(
        supabasePrescriptionRepository.create(client, input),
        (error: unknown) => error instanceof PrescriptionRepositoryError &&
          error.code === expected &&
          !error.message.includes("private provider diagnostic")
      );
    }
  });
});
