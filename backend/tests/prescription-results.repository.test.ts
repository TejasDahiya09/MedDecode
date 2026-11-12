import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { UserSupabaseClient } from "../src/config/supabase-user.js";
import {
  PRESCRIPTION_RESULT_FIELDS,
  PrescriptionResultsRepositoryError,
  supabasePrescriptionResultsRepository
} from "../src/repositories/prescription-results.repository.js";

const userId = "00000000-0000-4000-8000-000000000001";
const prescriptionId = "10000000-0000-4000-8000-000000000001";

function client(data: unknown, error: unknown = null) {
  const calls: Array<{ operation: string; value?: unknown }> = [];
  const query = {
    select(value: string) { calls.push({ operation: "select", value }); return query; },
    eq(column: string, value: unknown) { calls.push({ operation: `eq:${column}`, value }); return query; },
    async maybeSingle() { calls.push({ operation: "maybeSingle" }); return { data, error }; }
  };
  return {
    client: { from(table: string) { calls.push({ operation: "from", value: table }); return query; } } as unknown as UserSupabaseClient,
    calls
  };
}

describe("Prescription results repository", () => {
  it("owner-scopes the prescription and uses an explicit result projection", async () => {
    const owned = client({ id: prescriptionId, user_id: userId, status: "completed" });
    await supabasePrescriptionResultsRepository.findOwnedPrescription(owned.client, userId, prescriptionId);
    assert.deepEqual(owned.calls, [
      { operation: "from", value: "prescriptions" }, { operation: "select", value: "id,user_id,status" },
      { operation: "eq:id", value: prescriptionId }, { operation: "eq:user_id", value: userId }, { operation: "maybeSingle" }
    ]);

    const result = client(null);
    await supabasePrescriptionResultsRepository.findOwnedResult(result.client, prescriptionId);
    assert.deepEqual(result.calls, [
      { operation: "from", value: "prescription_intelligence_results" }, { operation: "select", value: PRESCRIPTION_RESULT_FIELDS },
      { operation: "eq:prescription_id", value: prescriptionId }, { operation: "maybeSingle" }
    ]);
    assert.equal(PRESCRIPTION_RESULT_FIELDS.includes("error_json"), false);
    assert.equal(PRESCRIPTION_RESULT_FIELDS.includes("*"), false);
  });

  it("redacts provider failures", async () => {
    const broken = client(null, { message: "private provider diagnostic" });
    await assert.rejects(
      supabasePrescriptionResultsRepository.findOwnedResult(broken.client, prescriptionId),
      (error: unknown) => error instanceof PrescriptionResultsRepositoryError &&
        !error.message.includes("private provider diagnostic")
    );
  });
});
