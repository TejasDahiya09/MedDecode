import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { Pool, type PoolClient } from 'pg';
import { PostgresWorkerRpcCaller } from '../src/repositories/postgres-worker-rpc.transport.js';
import { RpcPrescriptionReviewWorkerStore } from '../src/repositories/prescription-review-worker.rpc-store.js';
import type { IntelligenceSuccessV1 } from '../src/types/intelligence-contract-v1.js';

// Explicit opt-in; fixed loopback only. The connected postgres database is used
// only to create/drop our uniquely named disposable database and missing roles.
test('PG17 real transport: JSONB, scalar review, fenced initial completion and zero premature results',
  { skip: process.env.MEDDECODE_RPC_PG17 !== 'true' }, async () => {
  const config = { host: '127.0.0.1', port: 5433, user: 'postgres', password: process.env.PGPASSWORD ?? '1234', connectionTimeoutMillis: 3000 };
  const db = `meddecode_rpc_${randomUUID().replaceAll('-', '')}`;
  const control = new Pool({ ...config, database: 'postgres', max: 1 });
  const admin = new Pool({ ...config, database: db, max: 1 });
  const createdRoles: string[] = [];
  const sessions: PoolClient[] = [];
  const actorPools: Pool[] = [];
  let created = false;
  try {
    assert.equal((await control.query("SELECT current_setting('server_version_num')::int / 10000 AS major")).rows[0].major, 17);
    for (const role of ['meddecode_worker', 'meddecode_scoped_worker', 'meddecode_auto_worker_login', 'anon', 'authenticated']) {
      if (!(await control.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount) {
        await control.query(`CREATE ROLE ${role} NOLOGIN NOINHERIT`); createdRoles.push(role);
      }
    }
    if (createdRoles.includes('meddecode_auto_worker_login')) await control.query('GRANT meddecode_scoped_worker TO meddecode_auto_worker_login');
    await control.query(`CREATE DATABASE ${db}`); created = true;
    const fixture = await readFile(resolve('tests/prescription-review-initial-completion.local.sql'), 'utf8');
    await admin.query(fixture.split(/\r?\n/).filter(line => !line.startsWith('\\')).join('\n'));
    const migration = resolve('database/integration-migrations/202611160010_prescription_review_initial_completion_v1');
    const preflight = await readFile(resolve(migration, '001_preflight.sql'), 'utf8');
    // Resolve psql's database variable; execute the unchanged SQL body via pg.
    const sql = preflight.split(/\r?\n/).filter(line => !line.startsWith('\\')).join('\n')
      .replace(":'meddecode_expected_database'", `'${db}'`);
    const pre = await admin.query(sql);
    assert.match(JSON.stringify(pre), /PRESCRIPTION_REVIEW_INITIAL_COMPLETION_PREFLIGHT_OK/);
    const up = await readFile(resolve(migration, '002_up.sql'), 'utf8');
    await admin.query(up.replace(/^\\set.*$/m, ''));
    const verify = await readFile(resolve(migration, '003_verify.sql'), 'utf8');
    assert.match(JSON.stringify(await admin.query(verify.replace(/^\\set.*$/m, ''))), /PRESCRIPTION_REVIEW_INITIAL_COMPLETION_VERIFY_OK/);
    // The minimal transport fixture's helpers were placeholders. Record the
    // exact JSON medicines/event in bounded synthetic tables instead.
    await admin.query(`ALTER TABLE public.prescription_review_revisions ALTER COLUMN is_current SET DEFAULT true;
      CREATE TABLE public.synthetic_json_evidence(kind text PRIMARY KEY,payload jsonb);
      CREATE OR REPLACE FUNCTION public.meddecode_review_write_medicines_v1(uuid,uuid,jsonb) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
        INSERT INTO public.synthetic_json_evidence VALUES('medicines',$3)$$;
      CREATE OR REPLACE FUNCTION public.meddecode_review_append_event_v1(uuid,uuid,uuid,jsonb) RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
        INSERT INTO public.synthetic_json_evidence VALUES('event',$4)$$;
      REVOKE ALL ON FUNCTION public.meddecode_initialize_prescription_review_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
      GRANT EXECUTE ON FUNCTION public.meddecode_initialize_prescription_review_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb) TO meddecode_scoped_worker;
      UPDATE public.meddecode_auto_worker_policy SET enabled=true;
      UPDATE public.meddecode_scoped_worker_scope SET enabled=true;`);
    const claim = { jobId: '40000000-0000-4000-8000-000000000001', prescriptionId: '30000000-0000-4000-8000-000000000001',
      userId: '10000000-0000-4000-8000-000000000001', attemptCount: 1, claimGeneration: 7,
      leaseExpiresAt: new Date(Date.now()+300000).toISOString(), storageProvider: 'aws_s3', storageBucket: 'synthetic',
      objectKey: 'fictional.pdf', fileType: 'application/pdf', inputReference: null } as const;
    const session = async (role: string) => {
      const pool = new Pool({ ...config, database: db, max: 1 });
      actorPools.push(pool);
      const c = await pool.connect(); sessions.push(c);
      await c.query(`SET SESSION AUTHORIZATION ${role}`);
      return { c, pool };
    };
    const worker = await session('meddecode_auto_worker_login');
    // Use actual restricted PostgreSQL role, never grant direct table access.
    const caller = new PostgresWorkerRpcCaller({ connect: async () => ({
      query: (sql, values) => worker.c.query(sql, values as unknown[]), release() {},
    }) }, 'scoped', true);
    const store = new RpcPrescriptionReviewWorkerStore(caller);
    const result: IntelligenceSuccessV1 = { schema_version: '1.0', job_id: claim.jobId, prescription_id: claim.prescriptionId,
      status: 'completed_with_warnings', prescription: { prescription_date: null, doctor: { name: null, registration_number: null },
      facility: { name: null, address: null, phone: null } }, patient: { name: null, age: null, gender: null },
      medicines: [], recommendations: [], warnings: [], processing_metadata: { overall_confidence: null } };
    const input = { claim, result, now: new Date().toISOString(), evidence: {
      evidenceSetId: randomUUID(), schemaVersion: '1.0', documentSha256: null, pageCount: 1, providerCount: 1,
      payload: { synthetic: ['array', { object: true }] } } };
    const review = await store.initializeFromOcr(input);
    assert.equal(review.status, 'draft');
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.prescription_review_revisions')).rows[0].n, 1);
    assert.deepEqual((await admin.query("SELECT payload FROM public.synthetic_json_evidence WHERE kind='medicines'")).rows[0].payload, []);
    assert.deepEqual((await admin.query('SELECT evidence_payload FROM public.prescription_ocr_evidence_sets')).rows[0].evidence_payload, input.evidence.payload);
    const snapshot = async () => (await admin.query(`SELECT jsonb_build_object(
      'jobs',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.ai_jobs t),
      'reviews',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.prescription_review_revisions t),
      'evidence',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.prescription_ocr_evidence_sets t),
      'prescriptions',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.prescriptions t),
      'admissions',(SELECT jsonb_agg(to_jsonb(t) ORDER BY job_id) FROM public.meddecode_auto_authorized_jobs t),
      'scopes',(SELECT jsonb_agg(to_jsonb(t) ORDER BY job_id) FROM public.meddecode_scoped_worker_scope t),
      'results',(SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.prescription_intelligence_results t)) AS state`)).rows[0].state;
    const before = await snapshot();
    for (const bad of [{ ...claim, claimGeneration: 8 }, { ...claim, attemptCount: 2 },
      { ...claim, prescriptionId: '30000000-0000-4000-8000-000000000002' },
      { ...claim, jobId: '40000000-0000-4000-8000-000000000002' }]) {
      await assert.rejects(store.completeInitialReview({ claim: bad, workerInstanceId: 'meddecode-auto-worker-001' }));
      assert.deepEqual(await snapshot(), before);
    }
    await assert.rejects(store.completeInitialReview({ claim, workerInstanceId: 'wrong-worker' }));
    assert.deepEqual(await snapshot(), before);
    for (const [invalid, restore] of [
      ["UPDATE public.meddecode_scoped_worker_scope SET expires_at=clock_timestamp()-interval '1 second'", "UPDATE public.meddecode_scoped_worker_scope SET expires_at=clock_timestamp()+interval '5 minutes'"],
      ["UPDATE public.ai_jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE status='processing'", "UPDATE public.ai_jobs SET lease_expires_at=clock_timestamp()+interval '5 minutes' WHERE status='processing'"],
      ['UPDATE public.meddecode_auto_authorized_jobs SET rollout_generation=1', 'UPDATE public.meddecode_auto_authorized_jobs SET rollout_generation=2'],
      ['UPDATE public.meddecode_auto_worker_policy SET enabled=false', 'UPDATE public.meddecode_auto_worker_policy SET enabled=true'],
    ]) {
      await admin.query(invalid!); const fenced = await snapshot();
      await assert.rejects(store.completeInitialReview({ claim, workerInstanceId: 'meddecode-auto-worker-001' }));
      assert.deepEqual(await snapshot(), fenced); await admin.query(restore!);
    }
    const authorized = await snapshot();
    for (const role of ['anon', 'authenticated']) {
      const actor = await session(role);
      await assert.rejects(actor.c.query('SELECT * FROM public.meddecode_complete_initial_review_job_v1($1,$2,$3,$4,$5)',
        [claim.jobId,claim.prescriptionId,'meddecode-auto-worker-001',1,7]), { code: '42501' });
      assert.deepEqual(await snapshot(), authorized);
      actor.c.release(); sessions.splice(sessions.indexOf(actor.c),1);
    }
    const second = await session('meddecode_auto_worker_login');
    const secondStore = new RpcPrescriptionReviewWorkerStore(new PostgresWorkerRpcCaller({ connect: async () => ({
      query: (sql, values) => second.c.query(sql, values as unknown[]), release() {},
    }) }, 'scoped', true));
    const pids = [(await worker.c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,
      (await second.c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid];
    // A row-lock barrier holds both real sessions at the same completion point.
    // Observe actual database lock waits, rather than timing with sleeps.
    await admin.query('BEGIN');
    await admin.query('SELECT id FROM public.ai_jobs WHERE id=$1 FOR UPDATE', [claim.jobId]);
    const completions = Promise.allSettled([store, secondStore].map(s => s.completeInitialReview({ claim, workerInstanceId: 'meddecode-auto-worker-001' })));
    try {
      const deadline = Date.now()+5000; let blocked = false;
      while (Date.now()<deadline) {
        if ((await control.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid=ANY($1::int[]) AND wait_event_type='Lock'", [pids])).rows[0].n === 2) { blocked = true; break; }
      }
      assert.equal(blocked, true, 'both completion sessions must reach the lock barrier');
    } finally { await admin.query('COMMIT'); }
    const completedCalls = await completions;
    assert.equal(completedCalls.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal(completedCalls.filter(item => item.status === 'rejected').length, 1);
    assert.equal((await admin.query('SELECT status,result_reference FROM public.ai_jobs WHERE id=$1',[claim.jobId])).rows[0].status, 'completed');
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.prescription_intelligence_results')).rows[0].n, 0);
    const completed = await snapshot();
    await assert.rejects(store.completeInitialReview({ claim, workerInstanceId: 'meddecode-auto-worker-001' }));
    assert.deepEqual(await snapshot(), completed);
    for (const expression of ['NULL::jsonb', "'null'::jsonb", "'{}'::jsonb", "'[]'::jsonb", "'\"private detail\"'::jsonb"]) {
      await admin.query(`CREATE OR REPLACE FUNCTION public.meddecode_initialize_prescription_review_v1(
        p_job_id uuid,p_prescription_id uuid,p_evidence jsonb,p_review jsonb,p_medicines jsonb,p_event jsonb)
        RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$SELECT ${expression}$$`);
      const response = await caller.rpc('meddecode_initialize_prescription_review_v1', {
        p_job_id: claim.jobId, p_prescription_id: claim.prescriptionId, p_evidence: input.evidence,
        p_review: review, p_medicines: [], p_event: null });
      assert.notEqual(response.error, null); assert.equal(response.data, null);
      assert.doesNotMatch(JSON.stringify(response), /private detail/);
      assert.deepEqual(await snapshot(), completed);
    }
    worker.c.release(); sessions.splice(sessions.indexOf(worker.c),1);
  } finally {
    for (const c of sessions) c.release(true);
    await Promise.all(actorPools.map(pool => pool.end()));
    await admin.end();
    if (created) await control.query(`DROP DATABASE ${db} WITH (FORCE)`);
    for (const role of createdRoles.reverse()) await control.query(`DROP ROLE ${role}`);
    await control.end();
  }
});
