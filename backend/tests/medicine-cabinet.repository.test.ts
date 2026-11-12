import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { UserSupabaseClient } from "../src/config/supabase-user.js";
import {
  MEDICINE_CABINET_FIELDS,
  MedicineCabinetRepositoryError,
  supabaseMedicineCabinetRepository
} from "../src/repositories/medicine-cabinet.repository.js";
import type { MedicineCabinetRow } from "../src/types/medicine-cabinet.js";

const userId = "00000000-0000-4000-8000-000000000001";
const entryId = "30000000-0000-4000-8000-000000000001";
const medicineId = "40000000-0000-4000-8000-000000000001";
const row: MedicineCabinetRow = {
  id: entryId,
  user_id: userId,
  medicine_id: medicineId,
  quantity: "1.25",
  purchase_date: null,
  expiry_date: "2027-01-01",
  refill_date: null,
  usage_information: null,
  created_at: "2026-11-11T10:00:00.000Z",
  updated_at: "2026-11-11T10:00:00.000Z"
};

function queryClient(options: { readonly data: unknown; readonly error?: unknown }) {
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

describe("Medicine cabinet repository", () => {
  it("uses one table, an explicit projection, owner filter and stable bounded ordering", async () => {
    const { client, calls } = queryClient({ data: [row] });
    assert.deepEqual(
      await supabaseMedicineCabinetRepository.listOwned(
        client,
        userId,
        { limit: 20, offset: 40 }
      ),
      [row]
    );
    assert.deepEqual(calls, [
      { operation: "from", value: "medicine_cabinet" },
      { operation: "select", value: MEDICINE_CABINET_FIELDS },
      { operation: "eq:user_id", value: userId },
      { operation: "order:created_at", value: { ascending: false } },
      { operation: "order:id", value: { ascending: false } },
      { operation: "range", value: { from: 40, to: 60 } }
    ]);
    for (const forbidden of ["*", "family_member_id", "medicine_external_id"]) {
      assert.equal(MEDICINE_CABINET_FIELDS.includes(forbidden), false);
    }
  });

  it("filters detail by both entry and verified owner IDs without a medicines join", async () => {
    const { client, calls } = queryClient({ data: row });
    assert.deepEqual(
      await supabaseMedicineCabinetRepository.findOwnedDetail(
        client,
        userId,
        entryId
      ),
      row
    );
    assert.deepEqual(calls.map(({ operation }) => operation), [
      "from", "select", "eq:id", "eq:user_id", "maybeSingle"
    ]);
    assert.equal(calls[2]?.value, entryId);
    assert.equal(calls[3]?.value, userId);
    assert.equal(calls.some(({ value }) => value === "medicines"), false);
  });

  it("returns null for a missing owner-scoped detail", async () => {
    const { client } = queryClient({ data: null });
    assert.equal(
      await supabaseMedicineCabinetRepository.findOwnedDetail(client, userId, entryId),
      null
    );
  });

  it("redacts returned and thrown provider failures", async () => {
    const returned = queryClient({
      data: null,
      error: { message: "private provider diagnostic" }
    });
    await assert.rejects(
      supabaseMedicineCabinetRepository.listOwned(
        returned.client,
        userId,
        { limit: 20, offset: 0 }
      ),
      (error: unknown) => error instanceof MedicineCabinetRepositoryError &&
        !error.message.includes("private provider diagnostic")
    );
    const thrown = {
      from() { throw new Error("private thrown diagnostic"); }
    } as unknown as UserSupabaseClient;
    await assert.rejects(
      supabaseMedicineCabinetRepository.findOwnedDetail(thrown, userId, entryId),
      (error: unknown) => error instanceof MedicineCabinetRepositoryError &&
        !error.message.includes("private thrown diagnostic")
    );
  });
});
