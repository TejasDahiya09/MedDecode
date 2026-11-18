'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { PassThrough } = require('node:stream');
const { checkSettings, chooseFrontendPort, probePort, childEnvironment, pythonServiceEnvironment, controlledWorkerEnvironment, prefix } = require('./dev-launcher.cjs');
const valid = { MEDICINE_CATALOGUE_READ_ENABLED: 'true', MEDICINE_CATALOGUE_DEFAULT_SOURCE: 'official_catalogue', PROCESSING_JOB_STORE_ENABLED: 'true', PROCESSING_WORKER_ENABLED: 'false', SUPABASE_URL: 'https://example.invalid', SUPABASE_PUBLISHABLE_KEY: 'test' };
test('requires catalogue and job configuration and rejects a live worker', () => {
  assert.deepEqual(checkSettings(valid), []);
  assert.ok(checkSettings({ ...valid, PROCESSING_WORKER_ENABLED: 'true' }).includes('PROCESSING_WORKER_ENABLED'));
  assert.ok(checkSettings({ ...valid, MEDICINE_CATALOGUE_READ_ENABLED: 'false' }).includes('MEDICINE_CATALOGUE_READ_ENABLED'));
  assert.ok(checkSettings({ ...valid, PORT: '3001' }).includes('PORT'));
});
test('uses only the two explicitly allowed frontend ports', async () => {
  assert.equal(await chooseFrontendPort(async p => p === 5174), 5174);
  assert.equal(await chooseFrontendPort(async p => p === 5175), 5175);
  await assert.rejects(chooseFrontendPort(async () => false), /Neither frontend port/);
});
test('detects an actually occupied loopback port without touching its owner', async () => {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try { assert.equal(await probePort(server.address().port), false); assert.equal(server.listening, true); }
  finally { await new Promise(resolve => server.close(resolve)); }
});
test('prefix stream lifecycle removes every listener after repeated initialization', async () => {
  const target = new PassThrough();
  for (let index = 0; index < 25; index += 1) {
    const source = new PassThrough();
    prefix(source, `child-${index}`, target);
    source.end('ready\n');
    await new Promise(resolve => source.once('close', resolve));
    for (const event of ['data', 'end', 'close', 'error']) assert.equal(source.listenerCount(event), 0);
  }
  assert.equal(target.listenerCount('error'), 0);
  target.destroy();
});
test('service token and worker credentials are withheld from the frontend', () => {
  const source = { WORKER_DATABASE_URL: 'secret', AWS_SECRET_ACCESS_KEY: 'secret', SUPABASE_SECRET_KEY: 'secret', MEDDECODE_CATALOGUE_PASSWORD: 'secret', PROCESSING_WORKER_ENABLED: 'true' };
  const frontend = childEnvironment('frontend', source, 'test-token');
  for (const key of ['MEDDECODE_INTERNAL_TOKEN', 'WORKER_DATABASE_URL', 'AWS_SECRET_ACCESS_KEY', 'SUPABASE_SECRET_KEY', 'MEDDECODE_CATALOGUE_PASSWORD']) assert.equal(frontend[key], undefined);
  assert.equal(frontend.PROCESSING_WORKER_ENABLED, 'false');
  const backend = childEnvironment('backend', source, 'test-token');
  assert.equal(backend.MEDDECODE_INTERNAL_TOKEN, 'test-token');
  assert.equal(backend.WORKER_DATABASE_URL, undefined);
});
test('python service receives OCR configuration and resource limits but not backend or worker credentials', () => {
  const environment = pythonServiceEnvironment({ MEDDECODE_INTELLIGENCE_MAX_PDF_PAGES: '8', MEDDECODE_CATALOGUE_HOST: 'catalogue', MEDDECODE_EASYOCR_MODEL_DIRECTORY: 'models', MEDDECODE_ADAPTIVE_OCR_ENABLED: 'true', MEDDECODE_PADDLEOCR_DETECTION_MODEL_DIRECTORY: 'paddle-det', MEDDECODE_PADDLEOCR_RECOGNITION_MODEL_DIRECTORY: 'paddle-rec', MEDDECODE_TROCR_ENABLED: 'true', MEDDECODE_TROCR_PYTHON: 'trocr-python', MEDDECODE_TROCR_MODEL_DIRECTORY: 'trocr-model', WORKER_DATABASE_URL: 'secret', SUPABASE_SECRET_KEY: 'secret' });
  assert.equal(environment.MEDDECODE_INTELLIGENCE_MAX_PDF_PAGES, '8');
  assert.equal(environment.MEDDECODE_CATALOGUE_HOST, 'catalogue');
  assert.equal(environment.MEDDECODE_EASYOCR_MODEL_DIRECTORY, 'models');
  assert.equal(environment.MEDDECODE_ADAPTIVE_OCR_ENABLED, 'true');
  assert.equal(environment.MEDDECODE_PADDLEOCR_DETECTION_MODEL_DIRECTORY, 'paddle-det');
  assert.equal(environment.MEDDECODE_TROCR_ENABLED, 'true');
  assert.equal(environment.MEDDECODE_TROCR_PYTHON, 'trocr-python');
  assert.equal(environment.MEDDECODE_TROCR_MODEL_DIRECTORY, 'trocr-model');
  assert.equal(environment.MEDDECODE_PADDLEOCR_RECOGNITION_MODEL_DIRECTORY, 'paddle-rec');
  assert.equal(environment.WORKER_DATABASE_URL, undefined);
  assert.equal(environment.SUPABASE_SECRET_KEY, undefined);
});
test('optional worker requires explicit scoped single-attempt configuration and a separate AWS identity', () => {
  assert.equal(controlledWorkerEnvironment({}, 'test-token', {}), null);
  assert.throws(() => controlledWorkerEnvironment({ MEDDECODE_START_CONTROLLED_WORKER: 'true' }, 'test-token', {}));
  const source = { MEDDECODE_START_CONTROLLED_WORKER: 'true', MEDDECODE_PRESCRIPTION_REVIEW_V3_ENABLED: 'true', WORKER_RPC_MODE: 'scoped', WORKER_SINGLE_ATTEMPT: 'true', WORKER_AUTOMATIC_AUTHORIZATION_ENABLED: 'true', PROCESSING_WORKER_INSTANCE_ID: 'meddecode-auto-worker-001', WORKER_DATABASE_URL: 'postgresql://meddecode_auto_worker_login:fake@db.wyripeqruhvbksjfsvlr.supabase.co:5432/postgres', WORKER_DATABASE_CA_FILE: 'ca.pem', WORKER_AWS_ACCESS_KEY_ID: 'worker-id', WORKER_AWS_SECRET_ACCESS_KEY: 'worker-secret', WORKER_PYTHON_EXECUTABLE: process.execPath, WORKER_INTELLIGENCE_DIRECTORY: __dirname, SUPABASE_SECRET_KEY: 'must-not-pass' };
  const worker = controlledWorkerEnvironment(source, 'test-token', { AWS_REGION: 'region', AWS_S3_BUCKET: 'bucket' }, { MEDDECODE_CATALOGUE_ENV: 'hosted', MEDDECODE_CATALOGUE_HOST: 'catalogue.example', MEDDECODE_CATALOGUE_DATABASE: 'postgres', MEDDECODE_CATALOGUE_USER: 'meddecode_catalogue_python_reader', MEDDECODE_CATALOGUE_SSLROOTCERT: 'ca.pem', MEDDECODE_CATALOGUE_PASSWORD: 'catalogue-secret' });
  assert.equal(worker.PROCESSING_WORKER_ENABLED, 'true');
  assert.equal(worker.WORKER_SINGLE_ATTEMPT, 'true');
  assert.equal(worker.MEDDECODE_PRESCRIPTION_REVIEW_V3_ENABLED, 'true');
  assert.equal(worker.WORKER_PYTHON_EXECUTABLE, process.execPath);
  assert.equal(worker.WORKER_INTELLIGENCE_DIRECTORY, __dirname);
  assert.equal(worker.MEDDECODE_CATALOGUE_USER, 'meddecode_catalogue_python_reader');
  assert.equal(worker.SUPABASE_SECRET_KEY, undefined);
  const exact = { ...source, WORKER_EXACT_RETRY_PERMIT_ID: '60000000-0000-4000-8000-000000000001',
    WORKER_EXACT_RETRY_JOB_ID: '40000000-0000-4000-8000-000000000001', WORKER_EXACT_RETRY_PRESCRIPTION_ID: '30000000-0000-4000-8000-000000000001',
    WORKER_EXACT_RETRY_EXPECTED_GENERATION: '1' };
  const retryWorker = controlledWorkerEnvironment(exact, 'test-token', { AWS_REGION: 'region', AWS_S3_BUCKET: 'bucket' });
  assert.equal(retryWorker.WORKER_EXACT_RETRY_PERMIT_ID, exact.WORKER_EXACT_RETRY_PERMIT_ID);
  assert.equal(retryWorker.WORKER_SINGLE_ATTEMPT, 'true');
  assert.equal(childEnvironment('frontend', exact, 'test-token').WORKER_EXACT_RETRY_PERMIT_ID, undefined);
  assert.equal(pythonServiceEnvironment(exact).WORKER_EXACT_RETRY_PERMIT_ID, undefined);
  assert.throws(() => controlledWorkerEnvironment({ ...source, WORKER_PYTHON_EXECUTABLE: undefined }, 'test-token', { AWS_REGION: 'region', AWS_S3_BUCKET: 'bucket' }));
  assert.throws(() => controlledWorkerEnvironment({ ...source, WORKER_INTELLIGENCE_DIRECTORY: undefined }, 'test-token', { AWS_REGION: 'region', AWS_S3_BUCKET: 'bucket' }));
  assert.throws(() => controlledWorkerEnvironment({ ...source, WORKER_INTELLIGENCE_DIRECTORY: 'missing-directory' }, 'test-token', { AWS_REGION: 'region', AWS_S3_BUCKET: 'bucket' }), /Python runtime is unavailable/);
  assert.throws(() => controlledWorkerEnvironment({ ...source, MEDDECODE_PRESCRIPTION_REVIEW_V3_ENABLED: 'false' }, 'test-token', { AWS_REGION: 'region', AWS_S3_BUCKET: 'bucket' }));
  assert.throws(() => controlledWorkerEnvironment({ ...source, WORKER_SINGLE_ATTEMPT: 'false' }, 'test-token', {}));
  assert.throws(() => controlledWorkerEnvironment({ ...source, WORKER_DATABASE_URL: 'postgresql://meddecode_auto_worker_login.wyripeqruhvbksjfsvlr:fake@x.pooler.supabase.com:5432/postgres' }, 'test-token', {}));
});
