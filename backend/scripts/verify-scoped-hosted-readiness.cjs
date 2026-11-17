// Explicit read-only preflight. Never starts a worker or reads document bytes.
'use strict';
const { readFileSync } = require('node:fs');
const crypto = require('node:crypto');
const { Pool } = require('pg');
const { SignatureV4 } = require('@smithy/signature-v4');
const { fromEnv } = require('@aws-sdk/credential-provider-env');
const { S3Client, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { workerStartupConfig } = require('../dist/worker.js');

class Sha256 {
  constructor(secret) { this.hash = secret ? crypto.createHmac('sha256', secret) : crypto.createHash('sha256'); }
  update(value) { this.hash.update(value); }
  async digest() { return this.hash.digest(); }
}
class ReadinessError extends Error {
  constructor(code) { super('readiness check failed'); this.code = code; }
}
const expect = (condition, code = 'CHECK_FAILED') => { if (!condition) throw new ReadinessError(code); };
const region = 'ap-south-1';
const bucket = 'meddecode-prescriptions-dev-226945380522-ap-south-1-an';
const key = 'private/prescriptions/9cde1d1a-e036-4c07-9f5f-cc8ec06930af/source.pdf';
let stage = 'CONFIGURATION';
const safeCodes = new Set(['28P01','42501','3D000','42P01','42703','ECONNREFUSED','ENOTFOUND',
  'ETIMEDOUT','ECONNRESET','CERT_HAS_EXPIRED','ERR_TLS_CERT_ALTNAME_INVALID',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE','SELF_SIGNED_CERT_IN_CHAIN', 'AWS_CREDENTIALS_MISSING',
  'InvalidClientTokenId','SignatureDoesNotMatch','ExpiredToken','AccessDenied','InvalidToken',
  'UnrecognizedClientException','RequestExpired','IncompleteSignature','InvalidAction',
  'STS_REJECTED','STS_RESPONSE_INVALID','WRONG_AWS_IDENTITY','S3_ACCESS_DENIED','S3_NOT_FOUND',
  'S3_SIZE_MISMATCH','S3_ENCRYPTION_MISMATCH','NETWORK_TIMEOUT','READINESS_APPLICATION_NAME_MISMATCH']);
function verifyStsResponse(ok, body) {
  if (!ok) {
    const code = /<Code>\s*([A-Za-z0-9]+)\s*<\/Code>/.exec(body)?.[1];
    throw new ReadinessError(code && safeCodes.has(code) ? code : 'STS_REJECTED');
  }
  const arn = /<Arn>\s*([^<]+?)\s*<\/Arn>/.exec(body)?.[1];
  expect(Boolean(arn), 'STS_RESPONSE_INVALID');
  expect(arn === 'arn:aws:iam::226945380522:user/meddecode-worker-dev', 'WRONG_AWS_IDENTITY');
}
function safeErrorCode(error, currentStage) {
  const candidate = typeof error?.code === 'string' ? error.code :
    typeof error?.cause?.code === 'string' ? error.cause.code : '';
  if (safeCodes.has(candidate)) return candidate;
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'NETWORK_TIMEOUT';
  if (currentStage === 'S3_METADATA') {
    if (error?.$metadata?.httpStatusCode === 403 || error?.name === 'AccessDenied') return 'S3_ACCESS_DENIED';
    if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound' || error?.name === 'NoSuchKey') return 'S3_NOT_FOUND';
  }
  return 'CHECK_FAILED';
}
async function main() {
  expect(process.env.WORKER_RPC_MODE === 'scoped' && process.env.WORKER_SINGLE_ATTEMPT === 'true');
  expect(process.env.PROCESSING_WORKER_INSTANCE_ID === 'meddecode-synthetic-32e120ce');
  const cfg = workerStartupConfig({ ...process.env, PROCESSING_WORKER_ENABLED: 'true' });
  expect(cfg.rpcMode === 'scoped' && cfg.singleAttempt && cfg.region === region && cfg.bucket === bucket);
  const url = new URL(cfg.databaseUrl);
  expect(decodeURIComponent(url.username) === 'meddecode_scoped_worker_login.wyripeqruhvbksjfsvlr');
  expect(url.hostname.endsWith('.pooler.supabase.com') && url.port === '5432' && url.pathname === '/postgres');
  stage = 'SCOPED_DATABASE';
  const readinessApplication = `meddecode-readiness-${crypto.randomBytes(8).toString('hex')}`;
  const worker = new Pool({ connectionString: cfg.databaseUrl, connectionTimeoutMillis: 10000,
    application_name: readinessApplication,
    ssl: { ca: readFileSync(cfg.databaseCaPath, 'utf8'), rejectUnauthorized: true } });
  try {
    const c = await worker.connect();
    try {
      await c.query('BEGIN READ ONLY');
      await c.query('SET LOCAL ROLE meddecode_scoped_worker');
      // Supavisor replaces startup application_name. Tag only this transaction;
      // a retained idle backend must still pass the launcher's zero-session guard.
      await c.query("SELECT set_config('application_name', $1, true)", [readinessApplication]);
      const result = await c.query(`SELECT session_user='meddecode_scoped_worker_login' AND current_user='meddecode_scoped_worker'
        AND NOT pg_has_role(session_user,'meddecode_worker','MEMBER')
        AND NOT has_function_privilege(current_user,'public.claim_next_prescription_analysis_job_v1(text,integer)','EXECUTE')
        AND NOT has_function_privilege(current_user,'public.recover_expired_prescription_analysis_jobs_v1(integer)','EXECUTE')
        AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
          CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS p(priv)
          WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
            AND (has_table_privilege(current_user,c.oid,p.priv) OR has_table_privilege(session_user,c.oid,p.priv)
              OR (p.priv IN ('SELECT','INSERT','UPDATE','REFERENCES') AND
                (has_any_column_privilege(current_user,c.oid,p.priv) OR has_any_column_privilege(session_user,c.oid,p.priv)))))
        AND has_function_privilege(current_user,'public.meddecode_scoped_claim_next_prescription_analysis_job_v1(text,integer)','EXECUTE')
        AND has_function_privilege(current_user,'public.meddecode_scoped_heartbeat_prescription_analysis_job_v1(uuid,text,bigint,integer)','EXECUTE')
        AND has_function_privilege(current_user,'public.meddecode_scoped_complete_prescription_analysis_job_v1(uuid,uuid,text,bigint,jsonb)','EXECUTE')
        AND has_function_privilege(current_user,'public.meddecode_scoped_fail_prescription_analysis_job_v1(uuid,uuid,text,bigint,text,boolean,text,timestamptz)','EXECUTE')
        AND has_function_privilege(current_user,'public.meddecode_scoped_recover_expired_prescription_analysis_jobs_v1(integer)','EXECUTE') AS ok,
        pg_backend_pid() AS backend_pid, current_setting('application_name') AS application_name`);
      expect(result.rows[0]?.ok === true);
      expect(Number.isSafeInteger(result.rows[0]?.backend_pid) && result.rows[0].backend_pid > 0);
      expect(result.rows[0]?.application_name === readinessApplication, 'READINESS_APPLICATION_NAME_MISMATCH');
      console.log(`SCOPED_READINESS_SESSION:${result.rows[0].backend_pid}:${readinessApplication}`);
      await c.query('ROLLBACK');
    } finally { c.release(true); }
  } finally { await worker.end(); }
  console.log('SCOPED_DATABASE_IDENTITY_OK');
  if (process.argv.includes('--database-only')) return;

  stage = 'CATALOGUE_READER';
  expect(cfg.catalogueEnvironment.MEDDECODE_CATALOGUE_ENV === 'hosted');
  const e = cfg.catalogueEnvironment;
  expect(e.MEDDECODE_CATALOGUE_USER === 'meddecode_catalogue_python_reader.wyripeqruhvbksjfsvlr');
  expect(e.MEDDECODE_CATALOGUE_HOST === url.hostname && (e.MEDDECODE_CATALOGUE_PORT || '5432') === '5432' && e.MEDDECODE_CATALOGUE_DATABASE === 'postgres');
  expect(Boolean(e.MEDDECODE_CATALOGUE_PASSWORD));
  const reader = new Pool({ host: e.MEDDECODE_CATALOGUE_HOST, port: 5432, database: 'postgres', user: e.MEDDECODE_CATALOGUE_USER,
    password: e.MEDDECODE_CATALOGUE_PASSWORD, connectionTimeoutMillis: 10000,
    ssl: { ca: readFileSync(e.MEDDECODE_CATALOGUE_SSLROOTCERT, 'utf8'), rejectUnauthorized: true } });
  try {
    const c = await reader.connect();
    try {
      await c.query('BEGIN READ ONLY');
      const r = await c.query("SELECT session_user='meddecode_catalogue_python_reader' AS ok, (SELECT count(*) FROM official_catalogue.catalogue_entities WHERE entity_type='formulation' AND identity_hash=$1) AS matches", ['0'.repeat(64)]);
      expect(r.rows[0]?.ok === true && /^\d+$/.test(r.rows[0].matches));
      await c.query('ROLLBACK');
    } finally { c.release(true); }
  } finally { await reader.end(); }
  console.log('CATALOGUE_READER_QUERY_OK');

  stage = 'AWS_IDENTITY';
  expect(Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY), 'AWS_CREDENTIALS_MISSING');
  const credentials = fromEnv();
  const hostname = 'sts.ap-south-1.amazonaws.com';
  const signer = new SignatureV4({ credentials, region, service: 'sts', sha256: Sha256 });
  const query = { Action: 'GetCallerIdentity', Version: '2011-06-15' };
  const req = await signer.sign({ protocol: 'https:', hostname, method: 'GET', path: '/',
    headers: { host: hostname }, query });
  const response = await fetch(`https://${hostname}/?${new URLSearchParams(query)}`, { method: 'GET', headers: req.headers, signal: AbortSignal.timeout(10000) });
  const body = await response.text();
  verifyStsResponse(response.ok, body);
  console.log('AWS_WORKER_IDENTITY_OK');
  stage = 'S3_METADATA';
  const s3 = new S3Client({ region, credentials });
  try {
    const object = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(10000) });
    expect(object.ContentLength === 1230, 'S3_SIZE_MISMATCH');
    expect(object.ServerSideEncryption === 'AES256', 'S3_ENCRYPTION_MISMATCH');
  } finally { s3.destroy(); }
  console.log('WORKER_IDENTITY_AND_S3_OBJECT_METADATA_OK');
}
if (require.main === module) main().catch((error) => {
  console.error(`SCOPED_READINESS_FAILED:${stage}:${safeErrorCode(error, stage)}; do not insert scope or start worker`);
  process.exitCode = 1;
});
module.exports = { verifyStsResponse, safeErrorCode, Sha256 };
