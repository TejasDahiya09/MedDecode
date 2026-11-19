import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";

const database = process.env.MEDDECODE_INITIAL_REVIEW_TEST_DATABASE;
const enabled = database !== undefined;
const configuredPort = Number(process.env.MEDDECODE_INITIAL_REVIEW_TEST_PORT ?? "55440");
if (!Number.isInteger(configuredPort) || configuredPort < 1024 || configuredPort > 65535) {
  throw new Error("MEDDECODE_INITIAL_REVIEW_TEST_PORT_INVALID");
}
const config = {
  host: "127.0.0.1",
  port: configuredPort,
  database,
  user: process.env.MEDDECODE_INITIAL_REVIEW_TEST_ADMIN ?? "postgres",
};
const ids = { job: "40000000-0000-4000-8000-000000000001", prescription: "30000000-0000-4000-8000-000000000001", evidence: "50000000-0000-4000-8000-000000000001", revision: "60000000-0000-4000-8000-000000000001" };
const historical = { job: "40000000-0000-4000-8000-000000000003", prescription: "30000000-0000-4000-8000-000000000003", evidence: "50000000-0000-4000-8000-000000000003", revision: "60000000-0000-4000-8000-000000000003" };

async function prepare(admin: Pool): Promise<void> {
  await admin.query("BEGIN");
  await admin.query("INSERT INTO public.prescriptions(id,user_id,storage_provider,storage_bucket,object_key,status,file_type,file_size_bytes) VALUES($1,'10000000-0000-4000-8000-000000000001','aws_s3','synthetic-local','fictional.pdf','processing','application/pdf',1) ON CONFLICT(id) DO UPDATE SET user_id=EXCLUDED.user_id,status=EXCLUDED.status", [ids.prescription]);
  await admin.query("INSERT INTO public.ai_jobs(id,user_id,prescription_id,job_type,status,attempt_count,lease_owner,claim_generation,lease_expires_at,heartbeat_at,input_reference,max_attempts) VALUES($1,'10000000-0000-4000-8000-000000000001',$2,'prescription_analysis','processing',1,'meddecode-auto-worker-001',7,clock_timestamp()+interval '5 minutes',clock_timestamp(),'{}',3) ON CONFLICT(id) DO UPDATE SET user_id=EXCLUDED.user_id,prescription_id=EXCLUDED.prescription_id,status=EXCLUDED.status,attempt_count=EXCLUDED.attempt_count,lease_owner=EXCLUDED.lease_owner,claim_generation=EXCLUDED.claim_generation,lease_expires_at=EXCLUDED.lease_expires_at,heartbeat_at=EXCLUDED.heartbeat_at,result_reference=NULL", [ids.job, ids.prescription]);
  await admin.query("INSERT INTO public.meddecode_scoped_worker_scope(job_id,prescription_id,user_id,worker_login,worker_instance_id,enabled,expires_at) VALUES($1,$2,'10000000-0000-4000-8000-000000000001','meddecode_auto_worker_login','meddecode-auto-worker-001',true,clock_timestamp()+interval '5 minutes') ON CONFLICT(job_id) DO UPDATE SET prescription_id=EXCLUDED.prescription_id,user_id=EXCLUDED.user_id,worker_login=EXCLUDED.worker_login,worker_instance_id=EXCLUDED.worker_instance_id,enabled=true,expires_at=EXCLUDED.expires_at", [ids.job, ids.prescription]);
  await admin.query("UPDATE public.meddecode_auto_worker_policy SET enabled=true");
  await admin.query("INSERT INTO public.meddecode_auto_authorized_jobs(job_id,prescription_id,user_id,rollout_generation) VALUES($1,$2,'10000000-0000-4000-8000-000000000001',2) ON CONFLICT(job_id) DO UPDATE SET prescription_id=EXCLUDED.prescription_id,user_id=EXCLUDED.user_id,rollout_generation=EXCLUDED.rollout_generation", [ids.job, ids.prescription]);
  await admin.query("UPDATE public.ai_jobs SET status='processing',lease_owner='meddecode-auto-worker-001',attempt_count=1,claim_generation=7,lease_expires_at=clock_timestamp()+interval '5 minutes',result_reference=NULL WHERE id=$1", [ids.job]);
  await admin.query("UPDATE public.meddecode_scoped_worker_scope SET enabled=true,expires_at=clock_timestamp()+interval '5 minutes' WHERE job_id=$1", [ids.job]);
  await admin.query("DELETE FROM public.prescription_review_revisions; DELETE FROM public.prescription_ocr_evidence_sets");
  await admin.query("INSERT INTO public.prescription_ocr_evidence_sets(id,prescription_id,user_id,initial_processing_job_id,schema_version,provider_count,evidence_payload) VALUES($1,$2,'10000000-0000-4000-8000-000000000001',$3,'1.0',1,'{}')", [ids.evidence, ids.prescription, ids.job]);
  await admin.query("INSERT INTO public.prescription_review_revisions(id,prescription_id,user_id,evidence_set_id,revision_number,status,lock_version,review_schema_version,review_json,is_current) VALUES($1,$2,'10000000-0000-4000-8000-000000000001',$3,1,'draft',0,'1.0','{}',true)", [ids.revision, ids.prescription, ids.evidence]);
  await admin.query("COMMIT");
}
async function complete(worker: Pool, parameters: unknown[]): Promise<void> {
  const c = await worker.connect();
  try { await c.query("BEGIN"); await c.query("SET LOCAL ROLE meddecode_scoped_worker"); await c.query("SELECT * FROM public.meddecode_complete_initial_review_job_v1($1,$2,$3,$4,$5)", parameters); await c.query("COMMIT"); }
  catch (error) { await c.query("ROLLBACK"); throw error; } finally { c.release(); }
}

test("PG17 initial completion rejects fenced bad calls without mutation and allows exactly one concurrent transition", { skip: !enabled }, async () => {
  const admin = new Pool(config); const worker = new Pool({ ...config, user: "meddecode_auto_worker_login" });
  const anon = new Pool({ ...config, user: "anon" }); const authenticated = new Pool({ ...config, user: "authenticated" });
  try {
    assert.equal((await admin.query("SELECT pg_has_role('authenticated','meddecode_scoped_worker','member') AS member")).rows[0]?.member, false);
    for (const bad of [[ids.job, ids.prescription, "wrong", 1, 7], [ids.job, ids.prescription, "meddecode-auto-worker-001", 2, 7], [ids.job, ids.prescription, "meddecode-auto-worker-001", 1, 8], [ids.job, "30000000-0000-4000-8000-000000000002", "meddecode-auto-worker-001", 1, 7]]) {
      await prepare(admin); const before = await admin.query("SELECT status,lease_owner,claim_generation FROM public.ai_jobs WHERE id=$1", [ids.job]);
      await assert.rejects(complete(worker, bad));
      assert.deepEqual((await admin.query("SELECT status,lease_owner,claim_generation FROM public.ai_jobs WHERE id=$1", [ids.job])).rows, before.rows);
      assert.equal((await admin.query("SELECT count(*)::int AS n FROM public.prescription_intelligence_results WHERE prescription_id=$1", [ids.prescription])).rows[0]?.n, 0);
    }
    for (const [mutation, message] of [["UPDATE public.meddecode_scoped_worker_scope SET expires_at=clock_timestamp()-interval '1 second'", "expired scope"], ["UPDATE public.ai_jobs SET lease_expires_at=clock_timestamp()-interval '1 second'", "expired lease"], ["DELETE FROM public.prescription_review_revisions", "missing draft"], ["DELETE FROM public.meddecode_auto_authorized_jobs", "missing admission"], ["UPDATE public.meddecode_auto_worker_policy SET enabled=false", "disabled generation"]] as const) {
      await prepare(admin); await admin.query(mutation); const before = await admin.query("SELECT status,lease_owner,attempt_count,claim_generation,result_reference FROM public.ai_jobs WHERE id=$1", [ids.job]);
      await assert.rejects(complete(worker, [ids.job, ids.prescription, "meddecode-auto-worker-001", 1, 7]), new RegExp(".+", "s"), message);
      assert.deepEqual((await admin.query("SELECT status,lease_owner,attempt_count,claim_generation,result_reference FROM public.ai_jobs WHERE id=$1", [ids.job])).rows, before.rows, message);
    }
    await prepare(admin);
    const [left, right] = await Promise.allSettled([complete(worker, [ids.job, ids.prescription, "meddecode-auto-worker-001", 1, 7]), complete(worker, [ids.job, ids.prescription, "meddecode-auto-worker-001", 1, 7])]);
    assert.equal([left, right].filter(item => item.status === "fulfilled").length, 1);
    assert.equal([left, right].filter(item => item.status === "rejected").length, 1);
    assert.equal((await admin.query("SELECT status FROM public.ai_jobs WHERE id=$1", [ids.job])).rows[0]?.status, "completed");
    assert.equal((await admin.query("SELECT count(*)::int AS n FROM public.prescription_intelligence_results WHERE prescription_id=$1", [ids.prescription])).rows[0]?.n, 0);
    await prepare(admin);
    const snapshot = await admin.query("SELECT status,lease_owner,attempt_count,claim_generation,result_reference FROM public.ai_jobs WHERE id=$1", [ids.job]);
    await assert.rejects(complete(worker, ["40000000-0000-4000-8000-000000000002", "30000000-0000-4000-8000-000000000002", "meddecode-auto-worker-001", 0, 0]));
    assert.deepEqual((await admin.query("SELECT status,lease_owner,attempt_count,claim_generation,result_reference FROM public.ai_jobs WHERE id=$1", [ids.job])).rows, snapshot.rows);
    for (const pool of [anon, authenticated]) {
      await assert.rejects(pool.query("SELECT * FROM public.meddecode_complete_initial_review_job_v1($1,$2,$3,$4,$5)", [ids.job, ids.prescription, "meddecode-auto-worker-001", 1, 7]));
      assert.deepEqual((await admin.query("SELECT status,lease_owner,attempt_count,claim_generation,result_reference FROM public.ai_jobs WHERE id=$1", [ids.job])).rows, snapshot.rows);
    }
    await admin.query("DELETE FROM public.meddecode_scoped_worker_scope WHERE job_id=$1", [historical.job]);
    await admin.query("DELETE FROM public.meddecode_auto_authorized_jobs WHERE job_id=$1", [historical.job]);
    await admin.query("DELETE FROM public.ai_jobs WHERE id=$1", [historical.job]);
    await admin.query("DELETE FROM public.prescriptions WHERE id=$1", [historical.prescription]);
    await admin.query("INSERT INTO public.prescriptions(id,user_id,storage_provider,storage_bucket,object_key,status,file_type,file_size_bytes) VALUES($1,'10000000-0000-4000-8000-000000000001','aws_s3','synthetic-local','historical-fictional.pdf','processing','application/pdf',1)", [historical.prescription]);
    await admin.query("INSERT INTO public.ai_jobs(id,user_id,prescription_id,job_type,status,attempt_count,lease_owner,claim_generation,lease_expires_at,heartbeat_at,input_reference,max_attempts) VALUES($1,'10000000-0000-4000-8000-000000000001',$2,'prescription_analysis','processing',1,'meddecode-auto-worker-001',9,clock_timestamp()+interval '5 minutes',clock_timestamp(),'{}',3)", [historical.job, historical.prescription]);
    await admin.query("INSERT INTO public.meddecode_auto_authorized_jobs(job_id,prescription_id,user_id,rollout_generation) VALUES($1,$2,'10000000-0000-4000-8000-000000000001',1)", [historical.job, historical.prescription]);
    await admin.query("INSERT INTO public.meddecode_scoped_worker_scope(job_id,prescription_id,user_id,worker_login,worker_instance_id,enabled,expires_at) VALUES($1,$2,'10000000-0000-4000-8000-000000000001','meddecode_auto_worker_login','meddecode-auto-worker-001',true,clock_timestamp()+interval '5 minutes')", [historical.job, historical.prescription]);
    await admin.query("INSERT INTO public.prescription_ocr_evidence_sets(id,prescription_id,user_id,initial_processing_job_id,schema_version,provider_count,evidence_payload) VALUES($1,$2,'10000000-0000-4000-8000-000000000001',$3,'1.0',1,'{}')", [historical.evidence, historical.prescription, historical.job]);
    await admin.query("INSERT INTO public.prescription_review_revisions(id,prescription_id,user_id,evidence_set_id,revision_number,status,lock_version,review_schema_version,review_json,is_current) VALUES($1,$2,'10000000-0000-4000-8000-000000000001',$3,1,'draft',0,'1.0','{}',true)", [historical.revision, historical.prescription, historical.evidence]);
    const historicalBefore = await admin.query("SELECT status,attempt_count,claim_generation,result_reference FROM public.ai_jobs WHERE id=$1", [historical.job]);
    await assert.rejects(complete(worker, [historical.job, historical.prescription, "meddecode-auto-worker-001", 1, 9]));
    assert.deepEqual((await admin.query("SELECT status,attempt_count,claim_generation,result_reference FROM public.ai_jobs WHERE id=$1", [historical.job])).rows, historicalBefore.rows);
  } finally { await anon.end(); await authenticated.end(); await worker.end(); await admin.end(); }
});
