import assert from "node:assert/strict";
import test from "node:test";
import { PostgresWorkerRpcCaller, type WorkerPgConnection } from "../src/repositories/postgres-worker-rpc.transport.js";
import { createInitialReviewDraft } from '../src/domain/prescription-review/index.js';

test('exact retry routes one pinned second attempt and cannot reach issuer, batch recovery or another job', async () => {
  const exact = { permitId: '60000000-0000-4000-8000-000000000001', jobId: '40000000-0000-4000-8000-000000000001',
    prescriptionId: '30000000-0000-4000-8000-000000000001', expectedClaimGeneration: 1 };
  const commands: string[] = []; let values: readonly unknown[] | undefined;
  let row: Record<string,unknown> = { job_id: exact.jobId, prescription_id: exact.prescriptionId, attempt_count: 2, claim_generation: '3' };
  const connection: WorkerPgConnection = { query: async (sql,args) => {
    commands.push(sql); if(sql.includes('current_user')) return {rows:[{role:'meddecode_scoped_worker'}]};
    if(sql.startsWith('SELECT *')) {values=args; return {rows:[row]};} return {rows:[]};
  }, release() {} };
  const pool={connect:async()=>connection};
  assert.throws(()=>new PostgresWorkerRpcCaller(pool,'scoped',false,exact));
  const caller=new PostgresWorkerRpcCaller(pool,'scoped',true,exact);
  for(const name of ['authorize_next_automatic_job_v1','meddecode_scoped_authorize_next_v3_job_v1','recover_expired_prescription_analysis_jobs_v1','complete_prescription_analysis_job_v1']) {
    assert.notEqual((await caller.rpc(name,{})).error,null);
  }
  assert.equal(commands.length,0);
  assert.notEqual((await caller.rpc('heartbeat_prescription_analysis_job_v1',{p_job_id:exact.jobId,p_worker_instance_id:'worker',p_claim_generation:1,p_extend_seconds:120})).error,null);
  const args={p_worker_instance_id:'meddecode-auto-worker-001',p_lease_seconds:120};
  assert.equal((await caller.rpc('claim_next_prescription_analysis_job_v1',args)).error,null);
  assert.deepEqual(values,[exact.permitId,exact.jobId,exact.prescriptionId,'meddecode-auto-worker-001',120]);
  assert.match(commands.find(sql=>sql.startsWith('SELECT *'))!,/meddecode_recover_claim_exact_job_v1/);
  commands.length=0;
  assert.notEqual((await caller.rpc('claim_next_prescription_analysis_job_v1',args)).error,null);
  assert.equal(commands.length,0);
  for(const invalid of [{...row,attempt_count:1},{...row,attempt_count:3},{...row,claim_generation:'2'},{...row,job_id:exact.permitId}]) {
    row=invalid; commands.length=0;
    assert.notEqual((await new PostgresWorkerRpcCaller(pool,'scoped',true,exact).rpc('claim_next_prescription_analysis_job_v1',args)).error,null);
    assert.equal(commands.at(-1),'ROLLBACK'); assert.equal(commands.includes('COMMIT'),false);
  }
});

test('declared JSONB is encoded explicitly; scalar review responses are validated before commit', async () => {
  const name = 'meddecode_initialize_prescription_review_v1';
  const review = createInitialReviewDraft({ prescriptionId: '10000000-0000-4000-8000-000000000001',
    revisionId: '20000000-0000-4000-8000-000000000002',
    evidence: { evidenceSetId: '30000000-0000-4000-8000-000000000003', schemaVersion: '1.0' },
    medicines: [], now: '2026-11-16T00:00:00.000Z' });
  let rows: Record<string, unknown>[] = [{ [name]: review }];
  const commands: string[] = []; let values: readonly unknown[] = [];
  const connection: WorkerPgConnection = { async query(sql, args) {
    commands.push(sql);
    if (sql.includes('current_user')) return { rows: [{ role: 'meddecode_scoped_worker' }] };
    if (sql.startsWith('SELECT *')) { values = args!; return { rows }; }
    return { rows: [] };
  }, release() {} };
  const caller = new PostgresWorkerRpcCaller({ connect: async () => connection }, 'scoped');
  const parameters = { p_job_id: review.revisionId, p_prescription_id: review.prescriptionId,
    p_evidence: { payload: ['synthetic'] }, p_review: review, p_medicines: [{ synthetic: true }], p_event: null };
  assert.deepEqual((await caller.rpc(name, parameters)).data, review);
  assert.deepEqual(values, [review.revisionId, review.prescriptionId, JSON.stringify(parameters.p_evidence),
    JSON.stringify(review), JSON.stringify(parameters.p_medicines), 'null']);
  for (const invalid of [[], [{}], [{ [name]: null }], [{ [name]: [] }], [{ [name]: {} }], [{ [name]: 'secret' }], [{ [name]: review }, { [name]: review }]]) {
    rows = invalid; commands.length = 0;
    assert.notEqual((await caller.rpc(name, parameters)).error, null);
    assert.equal(commands.at(-1), 'ROLLBACK'); assert.equal(commands.includes('COMMIT'), false);
  }
  for (const invalid of [undefined, NaN, Infinity, 1n, { missing: undefined }, new Date(), [,], (() => { const a: unknown[] = []; a.push(a); return a; })()]) {
    commands.length = 0;
    assert.notEqual((await caller.rpc(name, { ...parameters, p_medicines: invalid })).error, null);
    assert.equal(commands.some(sql => sql.startsWith('SELECT *')), false);
  }
});

test("worker transaction assumes and verifies role, converts bigint and releases connection", async () => {
  const commands: string[] = []; let released = false;
  const connection: WorkerPgConnection = {
    async query(sql) { commands.push(sql); return { rows: sql.includes("current_user") ? [{ role: "meddecode_worker" }] : sql.startsWith("SELECT *") ? [{ claim_generation: "9", lease_expires_at: new Date("2026-11-14T00:00:00Z") }] : [] }; },
    release(destroy) { assert.equal(destroy, false); released = true; },
  };
  const result = await new PostgresWorkerRpcCaller({ connect: async () => connection }).rpc("claim_next_prescription_analysis_job_v1", { p_worker_instance_id: "worker-test-001", p_lease_seconds: 120 });
  assert.deepEqual(result.data, [{ claim_generation: 9, lease_expires_at: "2026-11-14T00:00:00.000Z" }]);
  assert.deepEqual(commands.slice(0, 3), ["BEGIN", "SET LOCAL ROLE meddecode_worker", "SELECT current_user AS role"]);
  assert.equal(commands.at(-1), "COMMIT"); assert.equal(released, true);
});

test("rejects arbitrary calls and rolls back unsafe bigint without exposing errors", async () => {
  const commands: string[] = [];
  const connection: WorkerPgConnection = {
    async query(sql) { commands.push(sql); return { rows: sql.includes("current_user") ? [{ role: "meddecode_worker" }] : sql.startsWith("SELECT *") ? [{ claim_generation: "9007199254740993" }] : [] }; },
    release() {},
  };
  const caller = new PostgresWorkerRpcCaller({ connect: async () => connection });
  assert.notEqual((await caller.rpc("arbitrary", {})).error, null);
  assert.equal(commands.length, 0);
  const result = await caller.rpc("claim_next_prescription_analysis_job_v1", { p_worker_instance_id: "worker-test-001", p_lease_seconds: 120 });
  assert.equal(result.data, null); assert.equal(commands.at(-1), "ROLLBACK");
  assert.doesNotMatch(JSON.stringify(result), /unsafe generation/);
});

test("scoped transport assumes only the scoped role and cannot fall back to global RPCs", async () => {
  const commands: string[] = [];
  const connection: WorkerPgConnection = {
    async query(sql) { commands.push(sql); return { rows: sql.includes('current_user') ? [{ role: 'meddecode_scoped_worker' }] : [] }; },
    release() {},
  };
  const caller = new PostgresWorkerRpcCaller({ connect: async () => connection }, 'scoped');
  assert.equal((await caller.rpc('claim_next_prescription_analysis_job_v1', { p_worker_instance_id: 'test-worker', p_lease_seconds: 120 })).error, null);
  assert.equal(commands[1], 'SET LOCAL ROLE meddecode_scoped_worker');
  assert.match(commands[3] ?? '', /^SELECT \* FROM public\.meddecode_scoped_claim_next_prescription_analysis_job_v1\(/);
  commands.length = 0;
  assert.notEqual((await caller.rpc('recover_expired_prescription_analysis_jobs_v1; DROP TABLE public.ai_jobs', {})).error, null);
  assert.equal(commands.length, 0);
});

test("automatic issuer is available only through the scoped RPC transport", async () => {
  const commands: string[] = [];
  const connection: WorkerPgConnection = {
    async query(sql) { commands.push(sql); return { rows: sql.includes("current_user") ? [{ role: "meddecode_scoped_worker" }] : [{ authorized: true }] }; },
    release() {},
  };
  const pool = { connect: async () => connection };
  const params = { p_worker_instance_id: "auto-test-worker-001" };
  assert.notEqual((await new PostgresWorkerRpcCaller(pool, "standard").rpc("authorize_next_automatic_job_v1", params)).error, null);
  assert.equal(commands.length, 0);
  assert.equal((await new PostgresWorkerRpcCaller(pool, "scoped").rpc("authorize_next_automatic_job_v1", params)).error, null);
  assert.match(commands[3] ?? "", /^SELECT \* FROM public\.meddecode_scoped_authorize_next_automatic_job_v1\(/);
});

test("revision failure is available only through the scoped transport with exact fenced parameters", async () => {
  const commands: Array<{ sql: string; parameters?: readonly unknown[] }> = [];
  const connection: WorkerPgConnection = {
    async query(sql, parameters) {
      commands.push({ sql, ...(parameters === undefined ? {} : { parameters }) });
      return { rows: sql.includes("current_user") ? [{ role: "meddecode_scoped_worker" }] : [{ job_status: "failed", replay_ready: true }] };
    },
    release() {},
  };
  const params = {
    p_job_id: "10000000-0000-4000-8000-000000000001",
    p_prescription_id: "20000000-0000-4000-8000-000000000002",
    p_review_revision_id: "30000000-0000-4000-8000-000000000003",
    p_input_fingerprint: "a".repeat(64),
    p_worker_instance_id: "worker-test-001",
    p_claim_generation: 1,
    p_failure_code: "INTELLIGENCE_REJECTED",
  };
  const pool = { connect: async () => connection };
  assert.notEqual((await new PostgresWorkerRpcCaller(pool, "standard").rpc("meddecode_fail_review_job_v1", params)).error, null);
  assert.equal(commands.length, 0);
  assert.equal((await new PostgresWorkerRpcCaller(pool, "scoped").rpc("meddecode_fail_review_job_v1", params)).error, null);
  assert.equal(commands[3]?.sql, "SELECT * FROM public.meddecode_fail_review_job_v1($1, $2, $3, $4, $5, $6, $7)");
  assert.deepEqual(commands[3]?.parameters, Object.values(params));
});

test("controlled transport rolls back a second claim before commit and rejects recovery", async () => {
  const commands: string[] = [];
  let attempt = 2;
  const connection: WorkerPgConnection = {
    async query(sql) { commands.push(sql); return { rows: sql.includes("current_user") ? [{ role: "meddecode_scoped_worker" }] : sql.startsWith("SELECT *") ? [{ attempt_count: attempt }] : [] }; },
    release() {},
  };
  const caller = new PostgresWorkerRpcCaller({ connect: async () => connection }, "scoped", true);
  const args = { p_worker_instance_id: "auto-test-worker-001", p_lease_seconds: 120 };
  const refused = await caller.rpc("claim_next_prescription_analysis_job_v1", args);
  assert.equal((refused.error as { code: string }).code, "MD_PRIOR_ATTEMPT");
  assert.equal(commands.at(-1), "ROLLBACK");
  assert.equal(commands.includes("COMMIT"), false);
  commands.length = 0;
  assert.notEqual((await caller.rpc("recover_expired_prescription_analysis_jobs_v1", { p_limit: 1 })).error, null);
  assert.equal(commands.length, 0);
  attempt = 1;
  const first = await caller.rpc("claim_next_prescription_analysis_job_v1", args);
  assert.equal(first.error, null);
  assert.equal(commands.at(-1), "COMMIT");
  assert.throws(() => new PostgresWorkerRpcCaller({ connect: async () => connection }, "standard", true));
});
