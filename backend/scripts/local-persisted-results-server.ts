// Explicit local-only, read-only presentation of previously processed fictional
// results. Authentication remains the real Supabase verifier; no worker starts.
import "dotenv/config";
import cors from "cors";
import express from "express";
import { Pool } from "pg";
import { createUserSupabaseClient, type UserSupabaseClient } from "../src/config/supabase-user.js";
import { errorHandler, notFoundHandler } from "../src/middleware/error.middleware.js";
import { createAuthRouter } from "../src/routes/auth.routes.js";
import { createPrescriptionHistoryRouter } from "../src/routes/prescription-history.routes.js";
import { createPrescriptionProcessingRouter } from "../src/routes/prescription-processing.routes.js";
import { createPrescriptionResultsRouter } from "../src/routes/prescription-results.routes.js";
import { createMedicineCatalogueRouter } from "../src/routes/medicine-catalogue.routes.js";
import { createSupabaseProcessingJobStore } from "../src/repositories/processing-job.store.js";
import { supabaseAuthVerifier } from "../src/services/auth.service.js";

async function main(): Promise<void> {
  const owner = process.env.LOCAL_DEMO_OWNER_ID ?? "";
  if (process.env.LOCAL_PERSISTED_DEMO_ENABLED !== "true" ||
      process.env.PROCESSING_WORKER_ENABLED !== "false" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(owner) ||
      new URL(process.env.SUPABASE_URL ?? "").hostname !== "wyripeqruhvbksjfsvlr.supabase.co") {
    throw new Error("Local demo configuration is not safe.");
  }
  const pool = new Pool({ host: "127.0.0.1", port: 5433, database: "meddecode_worker_final_20261113",
    user: "postgres", max: 2, connectionTimeoutMillis: 5000, options: "-c default_transaction_read_only=on" });
  const identity = await pool.query("SELECT current_database() AS db,current_user AS usr,host(inet_server_addr()) AS host,inet_server_port() AS port,current_setting('server_version_num')::integer/10000 AS version");
  const db = identity.rows[0];
  if (db?.db !== "meddecode_worker_final_20261113" || db.usr !== "postgres" || db.host !== "127.0.0.1" || db.port !== 5433 || db.version !== 17) {
    await pool.end(); throw new Error("Local test database guard failed.");
  }
  const verifier = { async verifyAccessToken(token: string) {
    const identity = await supabaseAuthVerifier.verifyAccessToken(token);
    if (identity.userId !== owner) throw new Error("Not the approved synthetic owner.");
    return identity;
  } };
  const normalize = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value]));
  const allowed = `p.user_id=$1 AND p.storage_bucket='local-test-bucket' AND
    EXISTS (SELECT 1 FROM public.prescription_intelligence_results r WHERE r.prescription_id=p.id
      AND r.result_json::text LIKE '%LOCAL_PDF_OFFICIAL_CATALOGUE%')`;
  const fields = "p.id,p.user_id,p.file_type,NULL::text AS file_size_bytes,p.status,p.prescription_date,p.created_at,p.updated_at,p.processed_at";
  const history = {
    async listOwned(_client: UserSupabaseClient, userId: string, page: { limit: number; offset: number }) {
      if (userId !== owner) return [];
      const rows = await pool.query(`SELECT ${fields} FROM public.prescriptions p WHERE ${allowed} ORDER BY p.created_at DESC,p.id DESC LIMIT $2 OFFSET $3`, [owner,page.limit+1,page.offset]);
      return rows.rows.map(normalize) as never;
    },
    async findOwnedDetail(_client: UserSupabaseClient, userId: string, id: string) {
      if (userId !== owner) return null;
      const rows = await pool.query(`SELECT ${fields} FROM public.prescriptions p WHERE ${allowed} AND p.id=$2`, [owner,id]);
      return rows.rows[0] ? normalize(rows.rows[0]) as never : null;
    },
  };
  const results = {
    async findOwnedPrescription(_client: UserSupabaseClient, userId: string, id: string) {
      if (userId !== owner) return null;
      const rows = await pool.query(`SELECT p.id,p.user_id,p.status FROM public.prescriptions p WHERE ${allowed} AND p.id=$2`, [owner,id]);
      return rows.rows[0] ?? null;
    },
    async findOwnedResult(_client: UserSupabaseClient, id: string) {
      const rows = await pool.query(`SELECT r.prescription_id,r.job_id,r.schema_version,r.status,r.result_json FROM public.prescription_intelligence_results r
        JOIN public.prescriptions p ON p.id=r.prescription_id WHERE ${allowed} AND p.id=$2`, [owner,id]);
      return rows.rows[0] ?? null;
    },
  };
  const clientFactory = () => ({
    async rpc(name: string, args: Record<string, unknown>) {
      if (name !== "get_prescription_analysis_status_v1" || typeof args.p_prescription_id !== "string") return { data: null, error: { code: "DISABLED" } };
      const connection = await pool.connect();
      try {
        await connection.query("BEGIN READ ONLY");
        const eligible = await connection.query(`SELECT 1 FROM public.prescriptions p WHERE ${allowed} AND p.id=$2`, [owner,args.p_prescription_id]);
        if (eligible.rowCount !== 1) { await connection.query("ROLLBACK"); return { data: [], error: null }; }
        await connection.query("SET LOCAL ROLE authenticated");
        await connection.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [owner]);
        const result = await connection.query("SELECT * FROM public.get_prescription_analysis_status_v1($1)", [args.p_prescription_id]);
        await connection.query("ROLLBACK");
        return { data: result.rows.map(normalize), error: null };
      } catch {
        try { await connection.query("ROLLBACK"); } catch { /* release below */ }
        return { data: null, error: { code: "UNAVAILABLE" } };
      } finally { connection.release(); }
    },
  }) as unknown as UserSupabaseClient;
  const app = express();
  app.use(cors({ origin: "http://127.0.0.1:5175" }));
  app.use((req, res, next) => { if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") { res.status(405).end(); return; } next(); });
  app.get("/health", (_req,res) => { res.json({ ok: true, mode: "local-persisted-fictional-results" }); });
  app.use(createAuthRouter(verifier));
  app.use(createPrescriptionHistoryRouter(verifier, clientFactory, history));
  app.use(createPrescriptionResultsRouter(verifier, clientFactory, results));
  app.use(createPrescriptionProcessingRouter(verifier, clientFactory, createSupabaseProcessingJobStore));
  // Catalogue reads use the request's real Supabase JWT and the existing
  // restricted hosted RPC, never the local synthetic PostgREST bridge.
  app.use(createMedicineCatalogueRouter(verifier, createUserSupabaseClient, undefined, true, "official_catalogue"));
  app.use(notFoundHandler); app.use(errorHandler);
  const server = app.listen(3002,"127.0.0.1",() => console.log("Local read-only results server ready at 127.0.0.1:3002."));
  const stop = () => { server.close(() => { void pool.end(); }); };
  process.once("SIGINT",stop); process.once("SIGTERM",stop);
}
void main().catch(() => { console.error("Local read-only results server failed safely."); process.exitCode=1; });
