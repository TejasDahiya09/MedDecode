import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { UserSupabaseClient } from "../src/config/supabase-user.js";
import { parseProcessingJobStoreEnabled } from "../src/config/env.js";
import {
  ProcessingJobStoreUnavailableError,
  createProcessingJobStoreFactory,
  createSupabaseProcessingJobStore
} from "../src/repositories/processing-job.store.js";
import { DEFAULT_REQUESTED_ANALYSIS } from "../src/types/intelligence-jobs.js";

const userId = "00000000-0000-4000-8000-000000000001";
const prescriptionId = "10000000-0000-4000-8000-000000000001";
const jobId = "20000000-0000-4000-8000-000000000001";
const createdAt = "2026-11-12T00:00:00+00:00";

interface Response { readonly data: unknown; readonly error: unknown }

class RpcClient {
  readonly calls: Array<{ name: string; parameters: Record<string, unknown> }> = [];
  readonly responses: Response[] = [];

  rpc(name: string, parameters: Record<string, unknown>): Promise<Response> {
    this.calls.push({ name, parameters: structuredClone(parameters) });
    const response = this.responses.shift();
    if (!response) throw new Error("Unexpected synthetic RPC call.");
    return Promise.resolve(response);
  }
}

const submitRow = (created: boolean) => ({
  job_id: jobId,
  prescription_id: prescriptionId,
  job_status: "queued",
  created
});

const statusRow = (overrides: Record<string, unknown> = {}) => ({
  prescription_id: prescriptionId,
  job_id: jobId,
  job_status: "queued",
  created_at: createdAt,
  started_at: null,
  completed_at: null,
  ...overrides
});

function harness(...responses: Response[]) {
  const client = new RpcClient();
  client.responses.push(...responses);
  const store = createSupabaseProcessingJobStore(
    client as unknown as UserSupabaseClient
  );
  return { client, store };
}

const input = { userId, prescriptionId, requestedAnalysis: DEFAULT_REQUESTED_ANALYSIS };

describe("Supabase processing-job store", () => {
  it("submits through the owner-scoped RPC and enriches the durable job", async () => {
    const { client, store } = harness(
      { data: [submitRow(true)], error: null },
      { data: [statusRow()], error: null }
    );
    const result = await store.submitOwned(input);
    assert.equal(result.kind, "created");
    if (result.kind !== "created") return;
    assert.equal(result.job.createdAt, createdAt);
    assert.equal(result.job.userId, userId);
    assert.deepEqual(client.calls, [
      {
        name: "submit_prescription_analysis_job_v1",
        parameters: {
          p_prescription_id: prescriptionId,
          p_requested_analysis: DEFAULT_REQUESTED_ANALYSIS
        }
      },
      {
        name: "get_prescription_analysis_status_v1",
        parameters: { p_prescription_id: prescriptionId }
      }
    ]);
    assert.equal("from" in client, false);
  });

  it("maps a deduplicated submission to the existing active job", async () => {
    const { store } = harness(
      { data: [submitRow(false)], error: null },
      { data: [statusRow()], error: null }
    );
    const result = await store.submitOwned(input);
    assert.equal(result.kind, "active");
    if (result.kind === "active") assert.equal(result.job.id, jobId);
  });

  it("retrieves job, no-job, and non-owned prescription states", async () => {
    const existing = harness({ data: [statusRow({ job_status: "processing" })], error: null });
    const found = await existing.store.findOwnedStatus(userId, prescriptionId);
    assert.equal(found.kind, "job");

    const none = harness({ data: [statusRow({
      job_id: null, job_status: null, created_at: null
    })], error: null });
    assert.deepEqual(await none.store.findOwnedStatus(userId, prescriptionId), { kind: "none" });

    const missing = harness({ data: [], error: null });
    assert.deepEqual(
      await missing.store.findOwnedStatus(userId, prescriptionId),
      { kind: "prescription_not_found" }
    );
  });

  it("maps expected submission errors without exposing provider details", async () => {
    const cases = [
      [{ code: "P0002", message: "prescription not found" }, "prescription_not_found"],
      [{ code: "23505", message: "result already exists" }, "result_exists"],
      [{ code: "55000", message: "prescription not processable" }, "not_processable"]
    ] as const;
    for (const [error, kind] of cases) {
      const { store } = harness({ data: null, error });
      assert.deepEqual(await store.submitOwned(input), { kind });
    }
  });

  it("rejects malformed, mismatched, and unexpected RPC responses safely", async () => {
    const candidates: Response[][] = [
      [{ data: [{ ...submitRow(true), private_value: "leak" }], error: null }],
      [{ data: [submitRow(true)], error: null }, { data: [statusRow({ job_id: userId })], error: null }],
      [{ data: [statusRow({ created_at: "not-a-date" })], error: null }]
    ];
    for (const responses of candidates) {
      const { store } = harness(...responses);
      await assert.rejects(
        () => responses.length === 1 && "created_at" in (responses[0]!.data as object)
          ? store.findOwnedStatus(userId, prescriptionId)
          : store.submitOwned(input),
        ProcessingJobStoreUnavailableError
      );
    }
  });

  it("fails closed on RPC and transport failures", async () => {
    const provider = harness({
      data: null,
      error: { code: "PGRST202", message: "private SQL and schema details" }
    });
    await assert.rejects(
      () => provider.store.submitOwned(input),
      ProcessingJobStoreUnavailableError
    );

    const client = new RpcClient();
    const store = createSupabaseProcessingJobStore(client as unknown as UserSupabaseClient);
    await assert.rejects(() => store.findOwnedStatus(userId, prescriptionId));
  });

  it("is disabled by default and requires an exact server-side true flag", async () => {
    assert.equal(parseProcessingJobStoreEnabled(undefined), false);
    assert.equal(parseProcessingJobStoreEnabled("false"), false);
    assert.equal(parseProcessingJobStoreEnabled("true"), true);
    assert.throws(() => parseProcessingJobStoreEnabled("TRUE"));

    const factory = createProcessingJobStoreFactory(false);
    const store = factory({} as UserSupabaseClient);
    await assert.rejects(() => store.submitOwned(input), ProcessingJobStoreUnavailableError);
  });
});
