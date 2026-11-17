// Local-only HTTP test: PostgreSQL is real; auth and PostgREST are test bridges.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { Pool } from "pg";
import { createApp } from "../src/app.js";
import type { UserSupabaseClient } from "../src/config/supabase-user.js";
import { createSupabaseProcessingJobStore } from "../src/repositories/processing-job.store.js";
import type { PrescriptionHistoryRepository } from "../src/repositories/prescription-history.repository.js";
import type { PrescriptionResultsRepository } from "../src/repositories/prescription-results.repository.js";

let stage = "configuration";
async function main(): Promise<void> {
  if (process.env.WORKER_LOCAL_SYNTHETIC_TEST !== "true") throw new Error("Synthetic opt-in required");
  const pool = new Pool({ host: "127.0.0.1", port: 5433, database: "meddecode_worker_final_20261113", user: "postgres" });
  try {
    stage = "identity";
    const identity = await pool.query("SELECT current_database() AS db,current_user AS usr,host(inet_server_addr()) AS host,inet_server_port() AS port,current_setting('server_version_num')::integer/10000 AS version");
    assert.deepEqual(identity.rows[0], { db: "meddecode_worker_final_20261113", usr: "postgres", host: "127.0.0.1", port: 5433, version: 17 });
    const owner = "10000000-0000-4000-8000-000000000001";
    const other = "20000000-0000-4000-8000-000000000002";
    const format = process.env.WORKER_TEST_FORMAT ?? "pdf";
    if (!["pdf", "jpg", "png"].includes(format)) throw new Error("Unsupported synthetic format");
    const result = await pool.query("SELECT p.id FROM public.prescriptions p JOIN public.prescription_intelligence_results r ON r.prescription_id=p.id WHERE p.user_id=$1 AND p.object_key LIKE $3 AND r.result_json::text LIKE $2 ORDER BY p.created_at DESC LIMIT 1", [owner, process.env.WORKER_SYNTHETIC_REAL_OCR === "true" ? "%LOCAL_PDF_OFFICIAL_CATALOGUE%" : "%SIMULATED_PYTHON%", `private/prescriptions/%/source.${format}`]);
    assert.equal(result.rowCount, 1, "Run the local worker lifecycle success fixture first");
    const completedId = String(result.rows[0].id);
    const newId = randomUUID();
    await pool.query("INSERT INTO public.prescriptions(id,user_id,storage_provider,storage_bucket,object_key,file_type,status) VALUES ($1,$2,'aws_s3','local-test-bucket',$3,'application/pdf','uploaded')", [newId, owner, `private/prescriptions/${newId}/source.pdf`]);
    const verifier = { async verifyAccessToken(token: string) { if (token === "synthetic-owner") return { userId: owner }; if (token === "synthetic-other") return { userId: other }; throw new Error("invalid"); } };
    const clientFactory = (token: string) => ({ rpc: async (name: string, args: Record<string, unknown>) => {
      const sql = name === "submit_prescription_analysis_job_v1" ? "SELECT * FROM public.submit_prescription_analysis_job_v1($1,$2)" : name === "get_prescription_analysis_status_v1" ? "SELECT * FROM public.get_prescription_analysis_status_v1($1)" : null;
      if (!sql) return { data: null, error: { code: "invalid" } };
      const conn = await pool.connect();
      try {
        await conn.query("BEGIN"); await conn.query("SET LOCAL ROLE authenticated");
        await conn.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [token === "synthetic-owner" ? owner : other]);
        const values = name.startsWith("submit") ? [args.p_prescription_id, args.p_requested_analysis] : [args.p_prescription_id];
        const data = await conn.query(sql, values); await conn.query("COMMIT");
        return { data: data.rows.map(row => Object.fromEntries(Object.entries(row).map(([k,v]) => [k,v instanceof Date ? v.toISOString() : v]))), error: null };
      } catch (error) { await conn.query("ROLLBACK"); return { data: null, error }; } finally { conn.release(); }
    } } as unknown as UserSupabaseClient);
    const results: PrescriptionResultsRepository = {
      async findOwnedPrescription(_client, userId, id) { const q = await pool.query("SELECT id,user_id,status FROM public.prescriptions WHERE id=$1 AND user_id=$2", [id,userId]); return q.rows[0] ?? null; },
      async findOwnedResult(_client, id) { const q = await pool.query("SELECT prescription_id,job_id,schema_version,status,result_json FROM public.prescription_intelligence_results WHERE prescription_id=$1", [id]); return q.rows[0] ?? null; },
    };
    const fields = "id,user_id,file_type,NULL::text AS file_size_bytes,status,prescription_date,created_at,updated_at,processed_at";
    const normalize = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).map(([k,v]) => [k,v instanceof Date ? v.toISOString() : v]));
    const history: PrescriptionHistoryRepository = {
      async listOwned(_client, userId, page) { const q = await pool.query(`SELECT ${fields} FROM public.prescriptions WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3`, [userId,page.limit+1,page.offset]); return q.rows.map(normalize) as never; },
      async findOwnedDetail(_client, userId, id) { const q = await pool.query(`SELECT ${fields} FROM public.prescriptions WHERE user_id=$1 AND id=$2`, [userId,id]); return q.rows[0] ? normalize(q.rows[0]) as never : null; },
    };
    const app = createApp(undefined,verifier,clientFactory,undefined,undefined,history,undefined,undefined,createSupabaseProcessingJobStore,results);
    stage = "http_submission";
    const first = await request(app).post(`/api/v1/prescriptions/${newId}/process`).set("Authorization","Bearer synthetic-owner").send({});
    assert.equal(first.status,202); assert.equal(first.body.submission.created,true);
    const duplicate = await request(app).post(`/api/v1/prescriptions/${newId}/process`).set("Authorization","Bearer synthetic-owner").send({});
    assert.equal(duplicate.status,200); assert.equal(duplicate.body.job.id,first.body.job.id);
    const status = await request(app).get(`/api/v1/prescriptions/${newId}/processing-status`).set("Authorization","Bearer synthetic-owner");
    assert.equal(status.status,200); assert.equal(status.body.processing.status,"queued");
    stage = "http_results_history";
    const response = await request(app).get(`/api/v1/prescriptions/${completedId}/results`).set("Authorization","Bearer synthetic-owner");
    assert.equal(response.status,200); assert.equal(response.body.prescription_id,completedId);
    const page = await request(app).get("/api/v1/prescriptions?limit=50").set("Authorization","Bearer synthetic-owner");
    assert.equal(page.status,200); assert.ok(page.body.items.some((item: { id: string }) => item.id===completedId));
    const denied = await request(app).get(`/api/v1/prescriptions/${completedId}/results`).set("Authorization","Bearer synthetic-other");
    assert.equal(denied.status,404);
    const anonymous = await request(app).get(`/api/v1/prescriptions/${completedId}/results`); assert.equal(anonymous.status,401);
    process.stdout.write(`PASS ${format} HTTP submission, duplicate, status, persisted results, history and owner isolation; synthetic auth/PostgREST bridge\n`);
  } finally { await pool.end(); }
}
void main().catch((error: unknown) => { const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^[0-9A-Z]{5}$/.test(error.code) ? error.code : "UNAVAILABLE"; console.error(`Local HTTP integration failed at ${stage}; code ${code}.`); process.exitCode = 1; });
