// Isolated synthetic worker database only. Leaves uniquely identified synthetic
// records in that database for inspection; it never deletes or resets data.
import { randomUUID } from "node:crypto";
import pg from "pg";
const { Client } = pg;
const config = { host: "127.0.0.1", port: 5433, user: "postgres",
  database: "meddecode_worker_final_20261113", connectionTimeoutMillis: 5000 };
const admin = new Client(config);
const locks = new Client(config);
const first = new Client(config);
const second = new Client(config);
async function main() {
await Promise.all([admin.connect(), locks.connect(), first.connect(), second.connect()]);
try {
  const check = await admin.query(`SELECT current_database() AS db,current_user AS usr,
    inet_server_addr()::text AS addr,inet_server_port() AS port,current_setting('server_version_num')::int AS version,
    to_regprocedure('public.cancel_prescription_analysis_job_v1(uuid,uuid)') IS NOT NULL AS installed`);
  const id = check.rows[0];
  if (id.db !== config.database || id.usr !== "postgres" || !["127.0.0.1", "127.0.0.1/32"].includes(id.addr) ||
      id.port !== 5433 || Math.floor(id.version / 10000) !== 17 || !id.installed) throw new Error("isolated target guard failed");
  await admin.query("SET lock_timeout='5s'");
  const req = { extract_prescription: true, match_medicines: true,
    find_alternatives: false, generate_recommendations: true };
  async function seed() {
    const owner = randomUUID(), prescription = randomUUID();
    await admin.query("BEGIN");
    try {
      await admin.query("INSERT INTO public.users(id) VALUES($1)", [owner]);
      await admin.query(`INSERT INTO public.prescriptions(id,user_id,storage_provider,storage_bucket,object_key,status)
        VALUES($1,$2,'aws_s3','synthetic-test','private/prescriptions/fictional/source.pdf','uploaded')`, [prescription, owner]);
      await admin.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [owner]);
      const submitted = await admin.query("SELECT job_id FROM public.submit_prescription_analysis_job_v1($1,$2)", [prescription, req]);
      await admin.query("COMMIT");
      return { owner, prescription, job: submitted.rows[0].job_id as string };
    } catch (error) { await admin.query("ROLLBACK"); throw error; }
  }
  // Lock every unrelated queued test row, so the claim RPC cannot modify it.
  async function lockOthers(job: string) {
    await locks.query("BEGIN");
    await locks.query("SELECT id FROM public.ai_jobs WHERE job_type='prescription_analysis' AND status='queued' AND id<>$1 FOR UPDATE", [job]);
  }
  const cancelled = await seed();
  await lockOthers(cancelled.job);
  await first.query("BEGIN");
  await first.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [cancelled.owner]);
  await first.query("SELECT * FROM public.cancel_prescription_analysis_job_v1($1,$2)", [cancelled.prescription, cancelled.job]);
  await second.query("BEGIN");
  await second.query("SET LOCAL ROLE meddecode_worker");
  const skipped = await second.query("SELECT job_id FROM public.claim_next_prescription_analysis_job_v1('cancellation-race',120)");
  if (skipped.rows.some((row: { job_id: string }) => row.job_id === cancelled.job)) throw new Error("claimed a locked cancellation");
  await second.query("COMMIT");
  await first.query("COMMIT");
  await locks.query("ROLLBACK");

  const claimed = await seed();
  await lockOthers(claimed.job);
  await first.query("BEGIN");
  await first.query("SET LOCAL ROLE meddecode_worker");
  const won = await first.query("SELECT job_id FROM public.claim_next_prescription_analysis_job_v1('cancellation-race',120)");
  if (won.rows.length !== 1 || won.rows[0].job_id !== claimed.job) throw new Error("claim did not select synthetic target");
  await second.query("BEGIN");
  await second.query("SET LOCAL lock_timeout='5s'");
  await second.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [claimed.owner]);
  const pending = second.query("SELECT * FROM public.cancel_prescription_analysis_job_v1($1,$2)", [claimed.prescription, claimed.job]);
  await new Promise((resolve) => setTimeout(resolve, 150));
  await first.query("COMMIT");
  let rejected = false;
  try { await pending; } catch (error) { rejected = (error as { code?: string }).code === "55000"; }
  if (!rejected) throw new Error("claim winner was not protected from cancellation");
  await second.query("ROLLBACK");
  await locks.query("ROLLBACK");
  console.log("PASS: cancellation wins; claim skips the locked job");
  console.log("PASS: claim wins; queued-only cancellation rejects after lock wait");
} finally {
  await Promise.allSettled([admin.end(), locks.end(), first.end(), second.end()]);
}
}
void main().catch((error: unknown) => {
  console.error("Cancellation concurrency test failed:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
});
