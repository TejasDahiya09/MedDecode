// Explicit opt-in: creates only synthetic records in the previously approved isolated cluster.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { PostgresWorkerRpcCaller, type WorkerPgConnection } from "../src/repositories/postgres-worker-rpc.transport.js";

async function main(): Promise<void> {
  if (process.env.MEDDECODE_SINGLE_ATTEMPT_ISOLATED !== "1") throw new Error("Explicit isolated-test opt-in required.");
  const pool = new Pool({ host: "127.0.0.1", port: 55439, user: "scoped_cluster_admin", database: "scoped_worker_verify", connectionTimeoutMillis: 5000 });
  const user = randomUUID(), prescription = randomUUID(), job = randomUUID();
  let created = false;
  try {
    const guard = await pool.query(`SELECT current_database()='scoped_worker_verify' AND inet_server_addr()='127.0.0.1'::inet
      AND inet_server_port()=55439 AND session_user='scoped_cluster_admin'
      AND NOT EXISTS (SELECT FROM public.meddecode_scoped_worker_scope WHERE worker_login='meddecode_scoped_login' AND enabled) AS ok`);
    assert.equal(guard.rows[0]?.ok, true);
    const setup = await pool.connect();
    try {
      await setup.query("BEGIN");
      await setup.query("INSERT INTO public.users(id) VALUES($1)", [user]);
      await setup.query("INSERT INTO public.prescriptions(id,user_id,storage_provider,storage_bucket,object_key,file_type,status) VALUES($1,$2,'aws_s3','fictional',$3,'application/pdf','queued')", [prescription,user,`private/prescriptions/${prescription}/source.pdf`]);
      await setup.query("INSERT INTO public.ai_jobs(id,user_id,prescription_id,job_type,status,attempt_count) VALUES($1,$2,$3,'prescription_analysis','queued',1)", [job,user,prescription]);
      await setup.query("INSERT INTO public.meddecode_scoped_worker_scope(job_id,prescription_id,user_id,worker_login,worker_instance_id,enabled,expires_at) VALUES($1,$2,$3,'meddecode_scoped_login','auto-test-worker-001',true,clock_timestamp()+interval '5 minutes')", [job,prescription,user]);
      await setup.query("COMMIT"); created = true;
    } catch (error) { await setup.query("ROLLBACK"); throw error; } finally { setup.release(); }
    const caller = new PostgresWorkerRpcCaller({ connect: async () => {
      const client = await pool.connect();
      try { await client.query("SET SESSION AUTHORIZATION meddecode_scoped_login"); }
      catch (error) { client.release(true); throw error; }
      return {
        async query(sql, parameters) { const result = await client.query(sql, parameters ? [...parameters] : undefined); return { rows: result.rows }; },
        release() { client.release(true); },
      } satisfies WorkerPgConnection;
    } }, "scoped", true);
    const response = await caller.rpc("claim_next_prescription_analysis_job_v1", { p_worker_instance_id: "auto-test-worker-001", p_lease_seconds: 120 });
    assert.equal((response.error as { code?: string })?.code, "MD_PRIOR_ATTEMPT");
    const after = await pool.query("SELECT status,attempt_count,lease_owner FROM public.ai_jobs WHERE id=$1", [job]);
    assert.deepEqual(after.rows[0], { status: "queued", attempt_count: 1, lease_owner: null });
    const state = await pool.query("SELECT status FROM public.prescriptions WHERE id=$1", [prescription]);
    assert.equal(state.rows[0]?.status, "queued");
    console.log("ISOLATED_POSTGRES_SECOND_CLAIM_ROLLBACK_OK");
  } finally {
    if (created) await pool.query("UPDATE public.meddecode_scoped_worker_scope SET enabled=false WHERE job_id=$1", [job]);
    await pool.end();
  }
}
main().catch(() => { console.error("ISOLATED_POSTGRES_SECOND_CLAIM_TEST_FAILED"); process.exitCode = 1; });
