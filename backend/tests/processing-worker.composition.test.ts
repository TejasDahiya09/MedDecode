import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { Readable } from "node:stream";
import test from "node:test";

import {
  createDisabledProcessingWorkerComposition,
} from "../src/services/processing-worker.composition.js";
import type { JsonSubprocessOptions } from "../src/services/local-python-intelligence.client.js";
import type { WorkerFinalizationRpcResult } from "../src/repositories/worker-job-finalization.rpc-store.js";
import type { WorkerRpcResult } from "../src/repositories/worker-job.rpc-store.js";

const NOW = Date.parse("2026-11-12T12:00:00.000Z");
const JOB_ID = "10000000-0000-4000-8000-000000000061";
const PRESCRIPTION_ID = "20000000-0000-4000-8000-000000000062";
const WORKER_ID = "worker-composition-001";
const RETRY_AT = "2026-11-12T12:01:00.000Z";

type RpcResult = WorkerRpcResult & WorkerFinalizationRpcResult;

class FakeWorkerRpcCaller {
  readonly calls: Array<{ name: string; parameters: Readonly<Record<string, unknown>> }> = [];
  readonly responses: RpcResult[] = [];

  async rpc(name: string, parameters: Readonly<Record<string, unknown>>): Promise<RpcResult> {
    this.calls.push({ name, parameters: structuredClone(parameters) });
    return this.responses.shift() ?? { data: [], error: null };
  }
}

function claimRow(): Record<string, unknown> {
  return {
    job_id: JOB_ID,
    user_id: "30000000-0000-4000-8000-000000000063",
    prescription_id: PRESCRIPTION_ID,
    attempt_count: 1,
    claim_generation: 1,
    lease_expires_at: new Date(NOW + 120_000).toISOString(),
    storage_provider: "aws_s3",
    storage_bucket: "worker-fixture-bucket",
    object_key: `private/prescriptions/${PRESCRIPTION_ID}/source.pdf`,
    file_type: "application/pdf",
    input_reference: null,
  };
}

function contractResult(): Record<string, unknown> {
  return {
    schema_version: "1.0", job_id: JOB_ID, prescription_id: PRESCRIPTION_ID,
    status: "completed_with_warnings",
    prescription: { prescription_date: null, doctor: { name: null, registration_number: null }, facility: { name: null, address: null, phone: null } },
    patient: { name: null, age: null, gender: null }, medicines: [], recommendations: [],
    warnings: [{ code: "TEST_ONLY", severity: "info", message: "Injected subprocess test result.", related_medicine_sequence_number: null }],
    processing_metadata: { overall_confidence: null },
  };
}

function options(caller: FakeWorkerRpcCaller, response: Record<string, unknown> = contractResult()) {
  let stagedPath: string | undefined;
  return {
    options: {
      runtimeConfig: {
        enabled: true, workerInstanceId: WORKER_ID, leaseSeconds: 120,
        heartbeatIntervalMs: 30_000, pollIntervalMs: 5_000,
        retryInitialMs: 10, retryMaximumMs: 10,
      },
      rpcCaller: caller,
      s3: {
        region: "local-test", bucket: "worker-fixture-bucket",
        client: { send: async () => ({ Body: Readable.from([Buffer.from("%PDF-test-only")]) }) },
      },
      python: {
        executable: "test-python", intelligenceDirectory: "C:\\test-intelligence",
        easyOcrModelDirectory: process.cwd(),
        entryPoint: "app.integration.local_pdf_worker" as const,
        run: async (subprocess: JsonSubprocessOptions) => {
          assert.deepEqual(subprocess.args.slice(0, 2), ["-m", "app.integration.local_pdf_worker"]);
          assert.equal(subprocess.args.includes("--fictional-fixture-pdf"), false);
          assert.equal(subprocess.args.includes("--injected-ocr-fixture"), false);
          stagedPath = String(subprocess.args[3]);
          assert.equal(existsSync(stagedPath), true);
          return JSON.stringify(response);
        },
      },
      now: () => new Date(NOW),
      retryDelayMs: 60_000,
    },
    stagedPath: () => stagedPath,
  };
}

test("composes explicit transports into one claim-to-finalize lifecycle without auto-starting", async () => {
  const caller = new FakeWorkerRpcCaller();
  caller.responses.push(
    { data: [claimRow()], error: null },
    { data: [{ job_id: JOB_ID, prescription_id: PRESCRIPTION_ID, result_status: "completed_with_warnings", replayed: false }], error: null },
    { data: [], error: null },
  );
  const setup = options(caller);
  const composition = createDisabledProcessingWorkerComposition(setup.options);
  assert.equal(caller.calls.length, 0);

  await composition.runtime.start();
  assert.equal(existsSync(setup.stagedPath() ?? ""), false);
  assert.deepEqual(caller.calls.slice(0, 2), [
    { name: "claim_next_prescription_analysis_job_v1", parameters: { p_worker_instance_id: WORKER_ID, p_lease_seconds: 120 } },
    { name: "complete_prescription_analysis_job_v1", parameters: {
      p_job_id: JOB_ID, p_prescription_id: PRESCRIPTION_ID, p_worker_instance_id: WORKER_ID,
      p_claim_generation: 1, p_result_json: contractResult(),
    } },
  ]);
  assert.deepEqual(await composition.recoverExpired(10), []);
  assert.deepEqual(caller.calls[2], {
    name: "recover_expired_prescription_analysis_jobs_v1", parameters: { p_limit: 10 },
  });
});

test("composed processing failure records only the fenced retryable failure", async () => {
  const caller = new FakeWorkerRpcCaller();
  caller.responses.push(
    { data: [claimRow()], error: null },
    { data: [{ job_id: JOB_ID, prescription_id: PRESCRIPTION_ID, job_status: "queued", retry_eligible: true, terminal: false, available_at: RETRY_AT }], error: null },
  );
  const setup = options(caller, { invalid: "not-a-contract" });
  await createDisabledProcessingWorkerComposition(setup.options).runtime.start();
  assert.equal(caller.calls.length, 2);
  assert.deepEqual(caller.calls[1], {
    name: "fail_prescription_analysis_job_v1", parameters: {
      p_job_id: JOB_ID, p_prescription_id: PRESCRIPTION_ID, p_worker_instance_id: WORKER_ID,
      p_claim_generation: 1, p_failure_code: "INTELLIGENCE_RESPONSE_INVALID", p_retryable: false,
      p_contract_code: null, p_retry_at: null,
    },
  });
});

test("composed document failure schedules a fenced retry and never invokes Python", async () => {
  const caller = new FakeWorkerRpcCaller();
  caller.responses.push(
    { data: [claimRow()], error: null },
    { data: [{ job_id: JOB_ID, prescription_id: PRESCRIPTION_ID, job_status: "queued", retry_eligible: true, terminal: false, available_at: RETRY_AT }], error: null },
  );
  const setup = options(caller);
  let pythonInvoked = false;
  const composition = createDisabledProcessingWorkerComposition({
    ...setup.options,
    s3: {
      ...setup.options.s3,
      client: { send: async () => { throw new Error("test-only document failure"); } },
    },
    python: {
      ...setup.options.python,
      run: async (subprocess: JsonSubprocessOptions) => {
        pythonInvoked = true;
        return setup.options.python.run!(subprocess);
      },
    },
  });
  await composition.runtime.start();
  assert.equal(pythonInvoked, false);
  assert.deepEqual(caller.calls[1], {
    name: "fail_prescription_analysis_job_v1", parameters: {
      p_job_id: JOB_ID, p_prescription_id: PRESCRIPTION_ID, p_worker_instance_id: WORKER_ID,
      p_claim_generation: 1, p_failure_code: "DOCUMENT_REFERENCE_FAILED", p_retryable: true,
      p_contract_code: null, p_retry_at: RETRY_AT,
    },
  });
});
