import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { Pool, type PoolClient } from 'pg';
import { PostgresWorkerRpcCaller } from '../src/repositories/postgres-worker-rpc.transport.js';
import { RpcPrescriptionReviewWorkerStore } from '../src/repositories/prescription-review-worker.rpc-store.js';
import type { IntelligenceSuccessV1 } from '../src/types/intelligence-contract-v1.js';
import { createInitialReviewDraft } from '../src/domain/prescription-review/index.js';

const job = '40000000-0000-4000-8000-000000000001';
const prescription = '30000000-0000-4000-8000-000000000001';
const otherJob = '40000000-0000-4000-8000-000000000002';
const otherPrescription = '30000000-0000-4000-8000-000000000002';
const otherUser = '20000000-0000-4000-8000-000000000002';
const workerId = 'meddecode-auto-worker-001';
const directory = resolve('database/integration-migrations/202611160013_exact_job_recovery_v1');
const clean = (sql: string) => sql.split(/\r?\n/).filter(line => !line.startsWith('\\')).join('\n');

test('PG17 exact recovery authorization, security, concurrency, initialization and cleanup',
 { skip: process.env.MEDDECODE_EXACT_RETRY_PG17 !== 'true' }, async t => {
  const config = { host: '127.0.0.1', port: 5433, user: 'postgres', password: process.env.PGPASSWORD ?? '1234', connectionTimeoutMillis: 3000 };
  const database = `meddecode_exact_${randomUUID().replaceAll('-', '')}`;
  const control = new Pool({ ...config, database: 'postgres', max: 1 });
  const admin = new Pool({ ...config, database, max: 1 });
  admin.on('error', error => console.error('LOCAL_POOL_ERROR','code' in error ? error.code : 'UNKNOWN'));
  const createdRoles: string[] = []; let created = false;
  const workerPassword = randomUUID();
  const pools: Pool[] = [];
  const clients = new Set<PoolClient>();
  const connect = async (role = 'meddecode_auto_worker_login') => {
    const pool = new Pool({ ...config, database, ...(role === 'meddecode_auto_worker_login' ? { user: role, password: workerPassword } : {}), max: 1 });
    pools.push(pool); const client = await pool.connect();
    clients.add(client);
    if (role !== 'meddecode_auto_worker_login' && role !== 'postgres') await client.query(`SET SESSION AUTHORIZATION ${role}`);
    return { client, close: async () => { client.release(); clients.delete(client); await pool.end(); pools.splice(pools.indexOf(pool),1); } };
  };
  const workerCall = async (client: PoolClient, sql: string, values: unknown[]) => {
    await client.query('BEGIN');
    try { await client.query('SET LOCAL ROLE meddecode_scoped_worker'); const r = await client.query(sql, values); await client.query('COMMIT'); return r; }
    catch (e) { await client.query('ROLLBACK'); throw e; }
  };
  const claimSql = 'SELECT * FROM public.meddecode_recover_claim_exact_job_v1($1,$2,$3,$4,$5)';
  const authorizeSql = 'SELECT * FROM public.meddecode_authorize_exact_job_retry_v1($1,$2,$3,$4)';
  const snapshot = async () => {
    const out: Record<string,unknown> = {};
    for (const table of ['ai_jobs','prescriptions','prescription_ocr_evidence_sets','prescription_review_revisions','prescription_intelligence_results','meddecode_auto_authorized_jobs','meddecode_scoped_worker_scope','meddecode_auto_worker_policy','meddecode_auto_test_account','meddecode_exact_job_retry_permits']) {
      out[table] = (await admin.query(`SELECT to_jsonb(t) AS row FROM public.${table} t ORDER BY to_jsonb(t)::text`)).rows;
    }
    return out;
  };
  const barrier = async (clients: PoolClient[], invoke: (c: PoolClient) => Promise<unknown>) => {
    const pids = await Promise.all(clients.map(async c => (await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid));
    await admin.query('BEGIN'); await admin.query('SELECT singleton FROM public.meddecode_auto_worker_policy FOR UPDATE');
    const pending = Promise.allSettled(clients.map(invoke));
    try {
      let ready = false; const until = Date.now()+5000;
      while (Date.now()<until) {
        if ((await control.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid=ANY($1::int[]) AND wait_event_type='Lock'",[pids])).rows[0].n===clients.length) { ready=true; break; }
      }
      assert.equal(ready,true,'both sessions must reach policy row-lock barrier');
    } finally { await admin.query('COMMIT'); }
    return pending;
  };
  try {
    assert.equal((await control.query("SELECT current_setting('server_version_num')::int/10000 AS major")).rows[0].major,17);
    assert.equal((await control.query("SELECT 1 FROM pg_roles WHERE rolname='meddecode_auto_worker_login'")).rowCount,0,'isolated test needs an unused local worker identity; never rotate existing credentials');
    for (const role of ['meddecode_worker','meddecode_scoped_worker','meddecode_auto_worker_login','anon','authenticated']) {
      if (!(await control.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role])).rowCount) {
        await control.query(`CREATE ROLE ${role} NOINHERIT ${role === 'meddecode_auto_worker_login' ? `LOGIN PASSWORD '${workerPassword}'` : 'NOLOGIN'}`);
        createdRoles.push(role);
      }
    }
    await control.query('GRANT meddecode_scoped_worker TO meddecode_auto_worker_login');
    await control.query(`CREATE DATABASE ${database}`); created=true;
    const fixture = clean(await readFile(resolve('tests/prescription-review-initial-completion.local.sql'),'utf8'));
    await admin.query(fixture);
    await admin.query(`ALTER TABLE public.prescriptions ADD COLUMN storage_provider text DEFAULT 'aws_s3', ADD COLUMN storage_bucket text DEFAULT 'synthetic', ADD COLUMN object_key text DEFAULT 'fictional.pdf', ADD COLUMN file_type text DEFAULT 'application/pdf';
      ALTER TABLE public.ai_jobs ADD COLUMN max_attempts integer DEFAULT 3, ADD COLUMN started_at timestamptz, ADD COLUMN created_at timestamptz DEFAULT clock_timestamp(), ADD COLUMN error_message text;
      ALTER TABLE public.meddecode_auto_worker_policy ADD COLUMN scope_seconds integer DEFAULT 600, ADD COLUMN activated_at timestamptz DEFAULT clock_timestamp();
      CREATE TABLE public.meddecode_auto_test_account(singleton boolean PRIMARY KEY,user_id uuid NOT NULL);
      ALTER TABLE public.prescription_review_revisions ALTER COLUMN is_current SET DEFAULT true;`);
    await admin.query(clean(await readFile(resolve('database/integration-migrations/202611160010_prescription_review_initial_completion_v1/002_up.sql'),'utf8')));
    const scoped = (await readFile(resolve('database/scoped-worker-isolation-review.sql'),'utf8')).replaceAll('\r','');
    const automatic = (await readFile(resolve('database/integration-migrations/202611160008_automatic_rollout_generation_v1/002_up.sql'),'utf8')).replaceAll('\r','');
    const extract = (source: string,name: string,delimiter: string) => source.match(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION public\\.${name}\\([\\s\\S]*?END\\s+\\$${delimiter}\\$;`))![0];
    for (const name of ['meddecode_scoped_claim_next_prescription_analysis_job_v1','meddecode_scoped_recover_expired_prescription_analysis_jobs_v1','meddecode_scoped_heartbeat_prescription_analysis_job_v1']) await admin.query(extract(scoped,name,'function'));
    await admin.query(extract(automatic,'meddecode_scoped_authorize_next_automatic_job_v1','fn'));
    await admin.query(`REVOKE ALL ON FUNCTION public.meddecode_initialize_prescription_review_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
      GRANT EXECUTE ON FUNCTION public.meddecode_initialize_prescription_review_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb),public.meddecode_scoped_claim_next_prescription_analysis_job_v1(text,integer),public.meddecode_scoped_recover_expired_prescription_analysis_jobs_v1(integer),public.meddecode_scoped_heartbeat_prescription_analysis_job_v1(uuid,text,bigint,integer),public.meddecode_scoped_authorize_next_automatic_job_v1(text) TO meddecode_scoped_worker;`);
    const run = async (name: string) => admin.query(clean(await readFile(resolve(directory,name),'utf8')));
    assert.match(JSON.stringify(await run('001_preflight.sql')),/EXACT_JOB_RETRY_PREFLIGHT_OK/);
    await run('002_up.sql');
    assert.match(JSON.stringify(await run('003_verify.sql')),/EXACT_JOB_RETRY_VERIFY_OK/);
    // Guarded rollback/reapply before any audit permit exists.
    await admin.query("SET meddecode.exact_retry_rollback_review='approved'");
    await run('004_rollback_review.sql');
    await run('001_preflight.sql'); await run('002_up.sql'); await run('003_verify.sql');
    const seed = fixture.split('\n').filter(line => line.startsWith('INSERT INTO')).join('\n');
    const reset = async () => {
      await admin.query(`TRUNCATE public.meddecode_exact_job_retry_permits,public.prescription_review_revisions,public.prescription_ocr_evidence_sets,public.prescription_intelligence_results,public.meddecode_scoped_worker_scope,public.meddecode_auto_authorized_jobs,public.ai_jobs,public.prescriptions,public.meddecode_auto_worker_policy,public.meddecode_auto_test_account,public.users CASCADE`);
      await admin.query(seed);
      await admin.query(`UPDATE public.meddecode_auto_worker_policy SET enabled=true,activated_at=clock_timestamp()-interval '1 hour';
        UPDATE public.ai_jobs SET claim_generation=1,lease_expires_at=clock_timestamp()-interval '5 minutes' WHERE id='${job}';
        UPDATE public.meddecode_scoped_worker_scope SET enabled=true,expires_at=clock_timestamp()-interval '5 minutes';
        INSERT INTO public.meddecode_auto_test_account VALUES(true,'10000000-0000-4000-8000-000000000001');
        INSERT INTO public.meddecode_auto_authorized_jobs VALUES('${otherJob}','${otherPrescription}','${otherUser}',1);
        INSERT INTO public.prescription_intelligence_results VALUES('70000000-0000-4000-8000-000000000001','${otherPrescription}');`);
    };
    const authorize = async () => (await admin.query(authorizeSql,[job,prescription,1,1])).rows[0].permit_id as string;
    for (const [label,mutation,args] of [
      ['wrong job','',[otherJob,prescription,1,1]], ['wrong prescription','',[job,otherPrescription,1,1]],
      ['wrong expected attempt','',[job,prescription,2,1]], ['wrong expected generation','',[job,prescription,1,2]],
      ['exhausted attempts',`UPDATE public.ai_jobs SET max_attempts=1 WHERE id='${job}'`],
      ['missing admission','DELETE FROM public.meddecode_auto_authorized_jobs WHERE rollout_generation=2'],
      ['cross-owner admission',`UPDATE public.meddecode_auto_authorized_jobs SET user_id='${otherUser}' WHERE rollout_generation=2`],
      ['disabled generation','UPDATE public.meddecode_auto_worker_policy SET enabled=false'],
      ['historical generation','UPDATE public.meddecode_auto_authorized_jobs SET rollout_generation=1 WHERE rollout_generation=2'],
      ['live lease',"UPDATE public.ai_jobs SET lease_expires_at=clock_timestamp()+interval '5 minutes' WHERE status='processing'"],
      ['live scope',"UPDATE public.meddecode_scoped_worker_scope SET expires_at=clock_timestamp()+interval '5 minutes'"],
      ['existing result',`INSERT INTO public.prescription_intelligence_results VALUES('${randomUUID()}','${prescription}')`],
    ] as const) await t.test(`administrative rejection: ${label}`,async()=>{
      await reset(); if(mutation) await admin.query(mutation); const before=await snapshot();
      await assert.rejects(admin.query(authorizeSql,args ? [...args] : [job,prescription,1,1]));
      assert.deepEqual(await snapshot(),before);
    });
    await t.test('administrative authorization rejects a connected worker',async()=>{
      await reset(); const actor=await connect(); const before=await snapshot();
      await assert.rejects(admin.query(authorizeSql,[job,prescription,1,1]));
      assert.deepEqual(await snapshot(),before); await actor.close();
    });
    await t.test('legacy recovery, issuer and global claim cannot adopt or renew a permitted job',async()=>{
      await reset(); await authorize(); const actor=await connect(); const before=await snapshot();
      assert.equal((await workerCall(actor.client,'SELECT * FROM public.meddecode_scoped_recover_expired_prescription_analysis_jobs_v1($1)',[1])).rowCount,0);
      assert.deepEqual((await workerCall(actor.client,'SELECT * FROM public.meddecode_scoped_authorize_next_automatic_job_v1($1)',[workerId])).rows,[{authorized:false}]);
      assert.deepEqual(await snapshot(),before);
      await admin.query("UPDATE public.ai_jobs SET status='queued' WHERE id=$1",[job]);
      await admin.query("UPDATE public.prescriptions SET status='queued' WHERE id=$1",[prescription]);
      const queued=await snapshot();
      assert.equal((await workerCall(actor.client,'SELECT * FROM public.meddecode_scoped_claim_next_prescription_analysis_job_v1($1,$2)',[workerId,120])).rowCount,0);
      assert.deepEqual(await snapshot(),queued); await actor.close();
    });
    await t.test('a legacy initializer already waiting when authorization commits is fenced',async()=>{
      await reset(); await admin.query('BEGIN'); await authorize();
      const authorized=await snapshot(); const actor=await connect();
      const pid=(await actor.client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const evidence={evidenceSetId:randomUUID(),schemaVersion:'1.0',providerCount:1,payload:{synthetic:true}};
      const review=createInitialReviewDraft({prescriptionId:prescription,revisionId:randomUUID(),
        evidence:{evidenceSetId:evidence.evidenceSetId,schemaVersion:'1.0'},medicines:[],now:new Date().toISOString()});
      const pending=Promise.allSettled([workerCall(actor.client,'SELECT public.meddecode_initialize_prescription_review_v1($1,$2,$3,$4,$5,$6)',
        [job,prescription,JSON.stringify(evidence),JSON.stringify(review),'[]','{}'])]);
      try {
        let waiting=false; const until=Date.now()+5000;
        while(Date.now()<until) if((await control.query("SELECT 1 FROM pg_stat_activity WHERE pid=$1 AND wait_event_type='Lock'",[pid])).rowCount===1){waiting=true;break;}
        assert.equal(waiting,true);
      } finally {await admin.query('COMMIT');}
      const [call]=await pending; assert.equal(call?.status,'rejected');
      if(call?.status==='rejected') assert.equal(call.reason.code,'42501');
      await actor.close(); assert.deepEqual(await snapshot(),authorized);
    });
    await t.test('two concurrent administrative authorizations mint exactly one permit',async()=>{
      await reset(); const a=await connect('postgres'),b=await connect('postgres');
      const r=await barrier([a.client,b.client],c=>c.query(authorizeSql,[job,prescription,1,1]));
      assert.equal(r.filter(x=>x.status==='fulfilled').length,1); assert.equal(r.filter(x=>x.status==='rejected').length,1);
      await a.close(); await b.close();
      assert.equal((await admin.query('SELECT attempt_count,claim_generation FROM public.ai_jobs WHERE id=$1',[job])).rows[0].attempt_count,1);
    });
    await t.test('legacy recovery and claim remain unchanged for a job without a retry permit',async()=>{
      await reset(); await admin.query("UPDATE public.meddecode_scoped_worker_scope SET expires_at=clock_timestamp()+interval '5 minutes'");
      const actor=await connect();
      const recovered=await workerCall(actor.client,'SELECT * FROM public.meddecode_scoped_recover_expired_prescription_analysis_jobs_v1($1)',[1]);
      assert.equal(recovered.rows[0].job_id,job); assert.equal(recovered.rows[0].job_status,'queued');
      const claimed=await workerCall(actor.client,'SELECT * FROM public.meddecode_scoped_claim_next_prescription_analysis_job_v1($1,$2)',[workerId,120]);
      assert.equal(claimed.rows[0].attempt_count,2); assert.equal(claimed.rows[0].claim_generation,'3');
      await actor.close(); assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.meddecode_exact_job_retry_permits')).rows[0].n,0);
    });
    await t.test('legacy first-attempt initialization and completion remain unchanged without a permit',async()=>{
      await reset(); await admin.query("UPDATE public.meddecode_scoped_worker_scope SET expires_at=clock_timestamp()+interval '5 minutes'; UPDATE public.ai_jobs SET lease_expires_at=clock_timestamp()+interval '5 minutes' WHERE status='processing'");
      const evidence={evidenceSetId:randomUUID(),schemaVersion:'1.0',providerCount:1,payload:{synthetic:true}};
      const review=createInitialReviewDraft({prescriptionId:prescription,revisionId:randomUUID(),evidence:{evidenceSetId:evidence.evidenceSetId,schemaVersion:'1.0'},medicines:[],now:new Date().toISOString()});
      const actor=await connect();
      const initialized=await workerCall(actor.client,'SELECT public.meddecode_initialize_prescription_review_v1($1,$2,$3,$4,$5,$6)',[job,prescription,JSON.stringify(evidence),JSON.stringify(review),'[]','{}']);
      assert.equal(initialized.rows[0].meddecode_initialize_prescription_review_v1.status,'draft');
      const completed=await workerCall(actor.client,'SELECT * FROM public.meddecode_complete_initial_review_job_v1($1,$2,$3,$4,$5)',[job,prescription,workerId,1,1]);
      assert.equal(completed.rows[0].job_status,'completed'); await actor.close();
      assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.prescription_intelligence_results WHERE prescription_id=$1',[prescription])).rows[0].n,0);
    });
    for (const [label,mutation,args] of [
      ['wrong job','',[null,otherJob,prescription,workerId,120]], ['wrong prescription','',[null,job,otherPrescription,workerId,120]],
      ['wrong permit','',[randomUUID(),job,prescription,workerId,120]], ['wrong worker','',[null,job,prescription,'wrong-worker',120]],
      ['expired scope',"UPDATE public.meddecode_scoped_worker_scope SET expires_at=clock_timestamp()-interval '1 second'"],
      ['disabled scope','UPDATE public.meddecode_scoped_worker_scope SET enabled=false'],
      ['changed attempt',"UPDATE public.ai_jobs SET attempt_count=2 WHERE status='processing'"],
      ['stale generation',"UPDATE public.ai_jobs SET claim_generation=2 WHERE status='processing'"],
      ['wrong owner',`UPDATE public.ai_jobs SET user_id='${otherUser}' WHERE status='processing'`],
      ['missing admission','DELETE FROM public.meddecode_auto_authorized_jobs WHERE rollout_generation=2'],
      ['disabled policy','UPDATE public.meddecode_auto_worker_policy SET enabled=false'],
      ['historical admission','UPDATE public.meddecode_auto_authorized_jobs SET rollout_generation=1 WHERE rollout_generation=2'],
      ['expired permit',"UPDATE public.meddecode_exact_job_retry_permits SET authorized_at=clock_timestamp()-interval '2 minutes',expires_at=clock_timestamp()-interval '1 minute'"],
      ['insufficient lease window',"UPDATE public.meddecode_exact_job_retry_permits SET expires_at=clock_timestamp()+interval '10 seconds'"],
    ] as const) await t.test(`worker rejection: ${label}`,async()=>{
      await reset(); const permit=await authorize(); if(mutation) await admin.query(mutation);
      const before=await snapshot(); const w=await connect();
      const values: unknown[]=args ? [...args] : [permit,job,prescription,workerId,120]; if(values[0]===null) values[0]=permit;
      await assert.rejects(workerCall(w.client,claimSql,values)); await w.close();
      assert.deepEqual(await snapshot(),before);
    });
    for (const role of ['anon','authenticated','meddecode_worker','meddecode_auto_worker_login']) await t.test(`role ${role} cannot authorize permits or mutate audit table`,async()=>{
      await reset(); const before=await snapshot(); const actor=await connect(role);
      await assert.rejects(actor.client.query(authorizeSql,[job,prescription,1,1]),{code:'42501'});
      await assert.rejects(actor.client.query('DELETE FROM public.meddecode_exact_job_retry_permits'),{code:'42501'});
      await assert.rejects(actor.client.query(claimSql,[randomUUID(),job,prescription,workerId,120]),{code:'42501'});
      if(role==='meddecode_auto_worker_login') await assert.rejects(workerCall(actor.client,'DELETE FROM public.meddecode_exact_job_retry_permits',[]),{code:'42501'});
      await actor.close(); assert.deepEqual(await snapshot(),before);
    });
    await t.test('atomic exact claim races once, preserves history, fences stale initialization and completes review only',async()=>{
      await reset(); const permit=await authorize(); const before=await snapshot();
      const a=await connect(),b=await connect();
      const exact={permitId:permit,jobId:job,prescriptionId:prescription,expectedClaimGeneration:1};
      const transportFor=(c: PoolClient)=>new PostgresWorkerRpcCaller({connect:async()=>({query:(sql,values)=>c.query(sql,values as unknown[]),release(){}})},'scoped',true,exact);
      const r=await barrier([a.client,b.client],async c=>{
        const response=await transportFor(c).rpc('claim_next_prescription_analysis_job_v1',{p_worker_instance_id:workerId,p_lease_seconds:120});
        if(response.error) throw new Error('rejected'); return response.data;
      });
      assert.equal(r.filter(x=>x.status==='fulfilled').length,1); assert.equal(r.filter(x=>x.status==='rejected').length,1);
      await b.close();
      const state=(await admin.query('SELECT attempt_count,claim_generation FROM public.ai_jobs WHERE id=$1',[job])).rows[0];
      assert.deepEqual(state,{attempt_count:2,claim_generation:'3'});
      assert.deepEqual((await snapshot()).meddecode_auto_authorized_jobs,before.meddecode_auto_authorized_jobs);
      const claimed=await snapshot();
      await assert.rejects(workerCall(a.client,claimSql,[permit,job,prescription,workerId,120]));
      await assert.rejects(workerCall(a.client,'SELECT * FROM public.meddecode_scoped_heartbeat_prescription_analysis_job_v1($1,$2,$3,$4)',[job,workerId,1,120]));
      await assert.rejects(workerCall(a.client,'SELECT * FROM public.meddecode_complete_initial_review_job_v1($1,$2,$3,$4,$5)',[job,prescription,workerId,1,1]));
      await assert.rejects(workerCall(a.client,'SELECT public.meddecode_initialize_prescription_review_v1($1,$2,$3,$4,$5,$6)',[job,prescription,'{}','{}','[]','{}']));
      await assert.rejects(workerCall(a.client,'SELECT public.meddecode_initialize_retry_review_core_v1($1,$2,$3,$4,$5,$6)',[job,prescription,'{}','{}','[]','{}']),{code:'42501'});
      await assert.rejects(workerCall(a.client,'SELECT public.meddecode_initialize_exact_retry_review_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[job,prescription,'{}','{}','[]','{}',workerId,1,1,permit]),{code:'55000'});
      assert.notEqual((await transportFor(a.client).rpc('claim_next_prescription_analysis_job_v1',{p_worker_instance_id:workerId,p_lease_seconds:120})).error,null,'a fresh process cannot silently reclaim a consumed permit');
      assert.deepEqual(await snapshot(),claimed);
      const caller=new PostgresWorkerRpcCaller({connect:async()=>({query:(sql,values)=>a.client.query(sql,values as unknown[]),release(){}})},'scoped',true,
        {permitId:permit,jobId:job,prescriptionId:prescription,expectedClaimGeneration:1});
      const store=new RpcPrescriptionReviewWorkerStore(caller);
      const claim={jobId:job,prescriptionId:prescription,userId:'10000000-0000-4000-8000-000000000001',attemptCount:2,claimGeneration:3,
        leaseExpiresAt:new Date(Date.now()+120000).toISOString(),storageProvider:'aws_s3',storageBucket:'synthetic',objectKey:'fictional.pdf',fileType:'application/pdf',inputReference:null} as const;
      const result: IntelligenceSuccessV1={schema_version:'1.0',job_id:job,prescription_id:prescription,status:'completed_with_warnings',
        prescription:{prescription_date:null,doctor:{name:null,registration_number:null},facility:{name:null,address:null,phone:null}},patient:{name:null,age:null,gender:null},medicines:[],recommendations:[],warnings:[],processing_metadata:{overall_confidence:null}};
      const input={claim,result,now:new Date().toISOString(),evidence:{evidenceSetId:randomUUID(),schemaVersion:'1.0',documentSha256:null,pageCount:1,providerCount:1,payload:{synthetic:true}}};
      assert.equal((await store.initializeFromOcr(input)).status,'draft');
      await store.completeInitialReview({claim,workerInstanceId:workerId});
      assert.equal((await admin.query('SELECT status FROM public.ai_jobs WHERE id=$1',[job])).rows[0].status,'completed');
      assert.equal((await admin.query('SELECT count(*)::int AS n FROM public.prescription_intelligence_results WHERE prescription_id=$1',[prescription])).rows[0].n,0);
      assert.deepEqual((await snapshot()).prescription_intelligence_results,before.prescription_intelligence_results);
      await a.close();
      await assert.rejects(run('004_rollback_review.sql')); await admin.query('ROLLBACK');
      await assert.rejects(run('002_up.sql')); await admin.query('ROLLBACK');
      await run('003_verify.sql');
    });
    await t.test('independent verifier rejects grant and function-security drift',async()=>{
      await admin.query('GRANT SELECT ON public.meddecode_exact_job_retry_permits TO anon');
      await assert.rejects(run('003_verify.sql')); await admin.query('ROLLBACK');
      await admin.query('REVOKE SELECT ON public.meddecode_exact_job_retry_permits FROM anon');
      await admin.query("ALTER FUNCTION public.meddecode_recover_claim_exact_job_v1(uuid,uuid,uuid,text,integer) SET search_path=public");
      await assert.rejects(run('003_verify.sql')); await admin.query('ROLLBACK');
      await admin.query('ALTER FUNCTION public.meddecode_recover_claim_exact_job_v1(uuid,uuid,uuid,text,integer) SET search_path=pg_catalog,public');
      await run('003_verify.sql');
    });
  } catch(error) {
    console.error('LOCAL_SQL_FAILURE', error instanceof Error ? error.message : 'unknown');
    throw error;
  } finally {
    for(const client of clients) client.release(true);
    for(const pool of pools) await pool.end();
    await admin.end();
    if(created) await control.query(`DROP DATABASE ${database} WITH (FORCE)`);
    for(const role of createdRoles.reverse()) await control.query(`DROP ROLE ${role}`);
    assert.equal((await control.query('SELECT 1 FROM pg_database WHERE datname=$1',[database])).rowCount,0);
    await control.end();
  }
});
