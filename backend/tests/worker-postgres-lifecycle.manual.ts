// Explicit local-only integration check. Storage and authentication are
// simulated; the success path can opt into the real Python OCR subprocess.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { Pool, type PoolClient } from "pg";
import request from "supertest";
import { createApp } from "../src/app.js";
import type { UserSupabaseClient } from "../src/config/supabase-user.js";
import { createSupabaseProcessingJobStore } from "../src/repositories/processing-job.store.js";
import { PostgresWorkerRpcCaller, type WorkerPgPool } from "../src/repositories/postgres-worker-rpc.transport.js";
import { createDisabledProcessingWorkerComposition } from "../src/services/processing-worker.composition.js";

let stage = "configuration";
async function main(): Promise<void> {
  if (process.env.WORKER_LOCAL_SYNTHETIC_TEST !== "true") throw new Error("Explicit synthetic test opt-in required.");
  const realOcr = process.env.WORKER_SYNTHETIC_REAL_OCR === "true";
  const format = process.env.WORKER_TEST_FORMAT ?? "pdf";
  if (!["pdf", "jpg", "png"].includes(format)) throw new Error("Unsupported synthetic format");
  const fileType = format === "pdf" ? "application/pdf" : format === "jpg" ? "image/jpeg" : "image/png";
  const pool = new Pool({ host: "127.0.0.1", port: 5433, database: "meddecode_worker_final_20261113", user: "postgres", max: 3 });
  let isolation: PoolClient | undefined;
  try {
    stage = "identity";
    const identity = await pool.query(`SELECT current_database() AS db, current_user AS usr,
      host(inet_server_addr()) AS host, inet_server_port() AS port, current_setting('server_version_num')::integer / 10000 AS version`);
    assert.deepEqual(identity.rows[0], { db: "meddecode_worker_final_20261113", usr: "postgres", host: "127.0.0.1", port: 5433, version: 17 });
    // Keep every preexisting queued fixture locked while this worker runs.
    // The production claim uses SKIP LOCKED and this isolated harness never
    // invokes the global recovery RPC. No existing row is modified.
    isolation = await pool.connect();
    await isolation.query("BEGIN");
    await isolation.query("SELECT id FROM public.ai_jobs WHERE job_type='prescription_analysis' AND status='queued' FOR UPDATE");
    const fixtureName = format === "pdf" ? "synthetic-prescription-002.pdf" : `synthetic-prescription-001.${format}`;
    const bytes = readFileSync(`C:\\Users\\dahiy\\MedDecode-Test-Fixtures\\${fixtureName}`);
    for (const outcome of ["success", "failure"] as const) {
      const prescriptionId = randomUUID();
      const userId = process.env.WORKER_SYNTHETIC_OWNER_ID ?? "10000000-0000-4000-8000-000000000001";
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) throw new Error("Invalid synthetic owner");
      // Local test data only: use the verified account's UUID when a real
      // browser session must read its own newly processed fictional fixture.
      await pool.query("INSERT INTO public.users(id) VALUES($1) ON CONFLICT (id) DO NOTHING", [userId]);
      stage = `${outcome}_submission`;
      const objects = new Map<string, Buffer>();
      const client = { rpc: async (name: string, args: Record<string, unknown>) => {
        const sql = name === "submit_prescription_analysis_job_v1" ? "SELECT * FROM public.submit_prescription_analysis_job_v1($1,$2)" :
          name === "get_prescription_analysis_status_v1" ? "SELECT * FROM public.get_prescription_analysis_status_v1($1)" : null;
        if (!sql) return { data: null, error: { code: "invalid" } };
        const connection = await pool.connect();
        try {
          await connection.query("BEGIN"); await connection.query("SET LOCAL ROLE authenticated");
          await connection.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [userId]);
          const values = name.startsWith("submit") ? [args.p_prescription_id, args.p_requested_analysis] : [args.p_prescription_id];
          const data = await connection.query(sql, values); await connection.query("COMMIT");
          return { data: data.rows.map(row => Object.fromEntries(Object.entries(row).map(([k,v]) => [k,v instanceof Date ? v.toISOString() : v]))), error: null };
        } catch (error) { await connection.query("ROLLBACK"); return { data: null, error }; } finally { connection.release(); }
      } } as unknown as UserSupabaseClient;
      const otherUserId = "20000000-0000-4000-8000-000000000002";
      const normalize = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).map(([k,v]) => [k,v instanceof Date ? v.toISOString() : v]));
      const app = createApp(undefined, { async verifyAccessToken(token) {
        if (token === "synthetic-owner") return { userId };
        if (token === "synthetic-other") return { userId: otherUserId };
        throw new Error("invalid");
      } },
        () => client, undefined, () => ({
          bucket: "local-test-bucket", maximumFileSizeBytes: 10 * 1024 * 1024, uploadTimeoutMs: 30_000, generatePrescriptionId: () => prescriptionId,
          storage: { async upload(input) { objects.set(input.objectKey, Buffer.from(input.bytes)); }, async delete(key) { objects.delete(key); } },
          repository: {
            async create(_client, input) {
              const result = await pool.query("INSERT INTO public.prescriptions(id,user_id,storage_provider,storage_bucket,object_key,file_type,status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING created_at,updated_at",
                [input.id,input.user_id,input.storage_provider,input.storage_bucket,input.object_key,input.file_type,input.status]);
              return { ...input, ...result.rows[0] } as never;
            },
            async findOwnedById() { return null; },
          },
        }), {
          async listOwned(_client, owner, pagination) {
            const result = await pool.query("SELECT id,user_id,file_type,NULL::text AS file_size_bytes,status,prescription_date,created_at,updated_at,processed_at FROM public.prescriptions WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3", [owner,pagination.limit+1,pagination.offset]);
            return result.rows.map(normalize) as never;
          },
          async findOwnedDetail(_client, owner, id) {
            const result = await pool.query("SELECT id,user_id,file_type,NULL::text AS file_size_bytes,status,prescription_date,created_at,updated_at,processed_at FROM public.prescriptions WHERE user_id=$1 AND id=$2", [owner,id]);
            return result.rows[0] ? normalize(result.rows[0]) as never : null;
          },
        }, undefined, undefined, createSupabaseProcessingJobStore, {
          async findOwnedPrescription(_client, owner, id) {
            const result = await pool.query("SELECT id,user_id,status FROM public.prescriptions WHERE id=$1 AND user_id=$2", [id,owner]);
            return result.rows[0] ?? null;
          },
          async findOwnedResult(_client, id) {
            const result = await pool.query("SELECT prescription_id,job_id,schema_version,status,result_json FROM public.prescription_intelligence_results WHERE prescription_id=$1", [id]);
            return result.rows[0] ?? null;
          },
        });
      const uploaded = await request(app).post("/api/v1/prescriptions/upload").set("Authorization", "Bearer synthetic-owner")
        .attach("file", bytes, { filename: `synthetic.${format}`, contentType: fileType });
      assert.equal(uploaded.status, 201); assert.equal(uploaded.body.prescription_id, prescriptionId);
      const submitted = await request(app).post(`/api/v1/prescriptions/${prescriptionId}/process`).set("Authorization", "Bearer synthetic-owner").send({});
      assert.equal(submitted.status, 202);
      const jobId = String(submitted.body.job.id);
      await pool.query("UPDATE public.ai_jobs SET available_at='0001-01-01 UTC'::timestamptz WHERE id=$1", [jobId]);
      const competing = await pool.query("SELECT count(*)::int AS n FROM public.ai_jobs WHERE status='queued' AND job_type='prescription_analysis' AND available_at <= '0001-01-01 UTC'::timestamptz AND id<>$1", [jobId]);
      assert.equal(competing.rows[0].n, 0, "A different queued fixture could be claimed");
      const worker = createDisabledProcessingWorkerComposition({
        runtimeConfig: { enabled: true, workerInstanceId: `synthetic-${outcome}-001`, leaseSeconds: 120, heartbeatIntervalMs: 30000, pollIntervalMs: 50, retryInitialMs: 10, retryMaximumMs: 10 },
        rpcCaller: new PostgresWorkerRpcCaller(pool as unknown as WorkerPgPool),
        s3: { region: "local", bucket: "local-test-bucket", client: { send: async command => {
          const body = objects.get(command.input.Key ?? "");
          if (!body) throw new Error("Synthetic object missing");
          return { Body: Readable.from([body]) };
        } } },
        python: { executable: realOcr && outcome === "success" ? (process.env.MEDDECODE_PYTHON ?? "") : "synthetic", intelligenceDirectory: realOcr && outcome === "success" ? (process.env.MEDDECODE_INTELLIGENCE_DIR ?? "") : process.cwd(), easyOcrModelDirectory: realOcr && outcome === "success" ? (process.env.MEDDECODE_EASYOCR_MODELS ?? "") : process.cwd(), entryPoint: "app.integration.local_pdf_worker", ...(realOcr && outcome === "success" ? { catalogueEnvironment: { MEDDECODE_CATALOGUE_ENV: "local" as const }, timeoutMs: 120_000 } : { run: async (options: { input: string }) => {
          const request = JSON.parse(options.input) as { job_id: string; prescription_id: string; requested_analysis: { generate_recommendations: boolean } };
          assert.equal(request.job_id, jobId); assert.equal(request.prescription_id, prescriptionId); assert.equal(request.requested_analysis.generate_recommendations, true);
          if (outcome === "failure") return JSON.stringify({ invalid: true });
          return JSON.stringify({ schema_version: "1.0", job_id: jobId, prescription_id: prescriptionId, status: "completed_with_warnings", prescription: { prescription_date: null, doctor: { name: null, registration_number: null }, facility: { name: null, address: null, phone: null } }, patient: { name: null, age: null, gender: null }, medicines: [], recommendations: [], warnings: [{ code: "SIMULATED_PYTHON", severity: "info", message: "Synthetic integration test", related_medicine_sequence_number: null }], processing_metadata: { overall_confidence: null } });
        } }) },
      });
      stage = `${outcome}_worker`;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          worker.runtime.start(),
          new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Synthetic worker timeout")), realOcr && outcome === "success" ? 130_000 : 15_000); }),
        ]);
      } finally {
        if (timeout) clearTimeout(timeout);
        await worker.runtime.stop();
      }
      stage = `${outcome}_result`;
      const status = await pool.query("SELECT j.status AS job_status,p.status AS prescription_status,(SELECT count(*)::int FROM public.prescription_intelligence_results r WHERE r.job_id=j.id) AS results FROM public.ai_jobs j JOIN public.prescriptions p ON p.id=j.prescription_id WHERE j.id=$1", [jobId]);
      process.stdout.write(`Observed ${outcome}: ${JSON.stringify(status.rows[0])}\n`);
      if (outcome === "success") {
        assert.equal(status.rows[0].job_status, "completed");
        assert.ok(["completed", "completed_with_warnings"].includes(status.rows[0].prescription_status));
        assert.equal(status.rows[0].results, 1);
        const result = await request(app).get(`/api/v1/prescriptions/${prescriptionId}/results`).set("Authorization", "Bearer synthetic-owner");
        assert.equal(result.status, 200); assert.equal(result.body.prescription_id, prescriptionId); assert.equal(result.body.job_id, jobId);
        const history = await request(app).get("/api/v1/prescriptions?limit=50").set("Authorization", "Bearer synthetic-owner");
        assert.equal(history.status, 200); assert.ok(history.body.items.some((item: { id: string }) => item.id === prescriptionId));
        const denied = await request(app).get(`/api/v1/prescriptions/${prescriptionId}/results`).set("Authorization", "Bearer synthetic-other");
        assert.equal(denied.status, 404);
        process.stdout.write(`PASS ${format} persisted result and history HTTP retrieval; cross-owner denied\n`);
      } else assert.deepEqual(status.rows[0], { job_status: "failed", prescription_status: "failed", results: 0 });
      process.stdout.write(`PASS ${format} ${outcome}: Express upload and submission, real claim, finalization and persisted status; auth/PostgREST bridge and object storage simulated; Python ${realOcr && outcome === "success" ? "real OCR" : "simulated"}\n`);
    }
  } finally {
    if (isolation) { try { await isolation.query("ROLLBACK"); } finally { isolation.release(); } }
    await pool.end();
  }
}
void main().catch((error: unknown) => { const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^[0-9A-Z]{5}$/.test(error.code) ? error.code : "UNAVAILABLE"; console.error(`Local synthetic lifecycle failed at ${stage}; code ${code}.`); process.exitCode = 1; });
