import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { UserSupabaseClient } from "../src/config/supabase-user.js";
import {
  PRESCRIPTION_HISTORY_FIELDS,
  PrescriptionHistoryRepositoryError,
  supabasePrescriptionHistoryRepository
} from "../src/repositories/prescription-history.repository.js";
import type { PrescriptionHistoryRow } from "../src/types/prescriptions.js";

const userId = "00000000-0000-4000-8000-000000000001";
const prescriptionId = "10000000-0000-4000-8000-000000000001";
const row: PrescriptionHistoryRow = {
  id: prescriptionId,
  user_id: userId,
  file_type: "application/pdf",
  file_size_bytes: "123",
  status: "uploaded",
  prescription_date: null,
  created_at: "2026-11-11T10:00:00.000Z",
  updated_at: "2026-11-11T10:00:00.000Z",
  processed_at: null
};

function queryClient(options: {
  readonly data: unknown;
  readonly error?: unknown;
}) {
  const calls: Array<{ operation: string; value?: unknown }> = [];
  const result = { data: options.data, error: options.error ?? null };
  const query = {
    select(value: string) { calls.push({ operation: "select", value }); return query; },
    eq(column: string, value: unknown) {
      calls.push({ operation: `eq:${column}`, value }); return query;
    },
    order(column: string, value: unknown) {
      calls.push({ operation: `order:${column}`, value }); return query;
    },
    range(from: number, to: number) {
      calls.push({ operation: "range", value: { from, to } });
      return Promise.resolve(result);
    },
    async maybeSingle() {
      calls.push({ operation: "maybeSingle" });
      return result;
    }
  };
  const client = {
    from(table: string) { calls.push({ operation: "from", value: table }); return query; }
  } as unknown as UserSupabaseClient;
  return { client, calls };
}

describe("Prescription history repository", () => {
  it("uses an explicit projection, owner filter, stable ordering and bounded range", async () => {
    const { client, calls } = queryClient({ data: [row] });
    const rows = await supabasePrescriptionHistoryRepository.listOwned(
      client,
      userId,
      { limit: 20, offset: 40 }
    );
    assert.deepEqual(rows, [row]);
    assert.deepEqual(calls, [
      { operation: "from", value: "prescriptions" },
      { operation: "select", value: PRESCRIPTION_HISTORY_FIELDS },
      { operation: "eq:user_id", value: userId },
      { operation: "order:created_at", value: { ascending: false } },
      { operation: "order:id", value: { ascending: false } },
      { operation: "range", value: { from: 40, to: 60 } }
    ]);
    assert.equal(PRESCRIPTION_HISTORY_FIELDS.includes("object_key"), false);
    assert.equal(PRESCRIPTION_HISTORY_FIELDS.includes("storage_bucket"), false);
    assert.equal(PRESCRIPTION_HISTORY_FIELDS.includes("ocr_text"), false);
    assert.equal(PRESCRIPTION_HISTORY_FIELDS.includes("patient_name"), false);
    assert.equal(PRESCRIPTION_HISTORY_FIELDS.includes("*"), false);
  });

  it("filters detail reads by both prescription and owner IDs", async () => {
    const { client, calls } = queryClient({ data: row });
    const result = await supabasePrescriptionHistoryRepository.findOwnedDetail(
      client,
      userId,
      prescriptionId
    );
    assert.deepEqual(result, row);
    assert.deepEqual(calls.map((call) => call.operation), [
      "from", "select", "eq:id", "eq:user_id", "maybeSingle"
    ]);
    assert.equal(calls[2]?.value, prescriptionId);
    assert.equal(calls[3]?.value, userId);
  });

  it("returns null for a missing owner-scoped detail", async () => {
    const { client } = queryClient({ data: null });
    assert.equal(
      await supabasePrescriptionHistoryRepository.findOwnedDetail(
        client,
        userId,
        prescriptionId
      ),
      null
    );
  });

  it("redacts returned and thrown provider failures", async () => {
    const returned = queryClient({
      data: null,
      error: { message: "private database diagnostic" }
    });
    await assert.rejects(
      supabasePrescriptionHistoryRepository.listOwned(
        returned.client,
        userId,
        { limit: 20, offset: 0 }
      ),
      (error: unknown) => error instanceof PrescriptionHistoryRepositoryError &&
        !error.message.includes("private database diagnostic")
    );

    const thrown = {
      from() { throw new Error("private thrown diagnostic"); }
    } as unknown as UserSupabaseClient;
    await assert.rejects(
      supabasePrescriptionHistoryRepository.findOwnedDetail(
        thrown,
        userId,
        prescriptionId
      ),
      (error: unknown) => error instanceof PrescriptionHistoryRepositoryError &&
        !error.message.includes("private thrown diagnostic")
    );
  });
});
