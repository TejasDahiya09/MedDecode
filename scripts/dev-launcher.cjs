'use strict';
const net = require('node:net');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const backend = path.join(root, 'backend');
const frontend = path.join(root, 'frontend');
const intelligence = path.join(root, 'intelligence');

function checkSettings(values) {
  const expected = { MEDICINE_CATALOGUE_READ_ENABLED: 'true', MEDICINE_CATALOGUE_DEFAULT_SOURCE: 'official_catalogue', PROCESSING_JOB_STORE_ENABLED: 'true', PROCESSING_WORKER_ENABLED: 'false' };
  const problems = Object.entries(expected).filter(([key, value]) => values[key] !== value).map(([key]) => key);
  if (values.PORT && values.PORT !== '3000') problems.push('PORT');
  if (!values.SUPABASE_URL) problems.push('SUPABASE_URL');
  if (!values.SUPABASE_PUBLISHABLE_KEY) problems.push('SUPABASE_PUBLISHABLE_KEY');
  if (values.NODE_ENV && values.NODE_ENV !== 'development') problems.push('NODE_ENV');
  return problems;
}
function probePort(port) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => server.close(() => resolve(true)));
  });
}
async function chooseFrontendPort(probe = probePort) {
  if (await probe(5174)) return 5174;
  if (await probe(5175)) return 5175;
  throw new Error('Neither frontend port 5174 nor 5175 is available. Stop only the conflicting service and retry.');
}
function prefix(stream, name, target) {
  let pending = '';
  let disposed = false;
  const flush = () => { if (pending) target.write(`[${name}] ${pending}\n`); pending = ''; };
  const cleanup = () => {
    if (disposed) return; disposed = true;
    stream.removeListener('data', onData);
    stream.removeListener('end', onEnd);
    stream.removeListener('close', onClose);
    stream.removeListener('error', onError);
  };
  const onData = data => {
    pending += data;
    const lines = pending.split(/\r?\n/); pending = lines.pop();
    for (const line of lines) if (line) target.write(`[${name}] ${line}\n`);
  };
  const onEnd = () => { flush(); cleanup(); };
  const onClose = () => { flush(); cleanup(); };
  const onError = () => { cleanup(); };
  stream.setEncoding('utf8');
  stream.on('data', onData);
  stream.once('end', onEnd);
  stream.once('close', onClose);
  stream.once('error', onError);
  return cleanup;
}
function waitForHealth(child, timeout = 20000, port = 3000, route = '/health') {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeout;
    const poll = () => {
      if (child.exitCode !== null || child.signalCode !== null) return reject(new Error('Backend exited before health check passed.'));
      if (Date.now() >= deadline) return reject(new Error('Backend health check timed out.'));
      const req = http.get(`http://127.0.0.1:${port}${route}`, { timeout: 700 }, res => {
        res.resume(); if (res.statusCode === 200) resolve(); else setTimeout(poll, 250);
      });
      req.on('timeout', () => req.destroy());
      req.on('error', () => setTimeout(poll, 250));
    };
    poll();
  });
}
function stopTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  else { try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch {} } }
}
function childEnvironment(name, source, token) {
  const childEnv = { ...source, NODE_ENV: 'development', PROCESSING_WORKER_ENABLED: 'false', PYTHON_INTELLIGENCE_URL: 'http://127.0.0.1:8000' };
  if (name === 'backend') childEnv.MEDDECODE_INTERNAL_TOKEN = token;
  else delete childEnv.MEDDECODE_INTERNAL_TOKEN;
  for (const key of Object.keys(childEnv)) {
    if (key === 'WORKER_DATABASE_URL' || key === 'PGPASSWORD' || key.startsWith('WORKER_AWS_') || key === 'MEDDECODE_CATALOGUE_PASSWORD') delete childEnv[key];
    if (name === 'frontend' && (key.startsWith('AWS_') || key.startsWith('WORKER_') || key === 'SUPABASE_SECRET_KEY')) delete childEnv[key];
    if (name === 'backend' && source.MEDDECODE_START_CONTROLLED_WORKER === 'true' && ['AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN'].includes(key)) delete childEnv[key];
  }
  return childEnv;
}
function pythonServiceEnvironment(source) {
  const allowed = key => key.startsWith('MEDDECODE_CATALOGUE_') || key.startsWith('MEDDECODE_INTELLIGENCE_') ||
    key.startsWith('MEDDECODE_PADDLEOCR_') || key.startsWith('MEDDECODE_TROCR_') ||
    key === 'MEDDECODE_EASYOCR_MODEL_DIRECTORY' || key === 'MEDDECODE_ADAPTIVE_OCR_ENABLED';
  const target = Object.fromEntries(Object.entries(source).filter(([key]) => allowed(key)));
  for (const key of ['PATH', 'SystemRoot', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']) if (source[key]) target[key] = source[key];
  return target;
}
function controlledWorkerEnvironment(source, token, values, catalogueSource = source) {
  if (!source.MEDDECODE_START_CONTROLLED_WORKER || source.MEDDECODE_START_CONTROLLED_WORKER === 'false') return null;
  if (source.MEDDECODE_START_CONTROLLED_WORKER !== 'true' || source.WORKER_RPC_MODE !== 'scoped' || source.WORKER_SINGLE_ATTEMPT !== 'true' ||
      source.WORKER_AUTOMATIC_AUTHORIZATION_ENABLED !== 'true' || source.MEDDECODE_PRESCRIPTION_REVIEW_V3_ENABLED !== 'true' || source.PROCESSING_WORKER_INSTANCE_ID !== 'meddecode-auto-worker-001' ||
      !source.WORKER_DATABASE_URL || !source.WORKER_DATABASE_CA_FILE || !source.WORKER_AWS_ACCESS_KEY_ID || !source.WORKER_AWS_SECRET_ACCESS_KEY ||
      !source.WORKER_PYTHON_EXECUTABLE || !source.WORKER_INTELLIGENCE_DIRECTORY)
    throw new Error('Controlled worker configuration is incomplete or unsafe.');
  try {
    if (!fs.statSync(source.WORKER_PYTHON_EXECUTABLE).isFile() ||
        !fs.statSync(source.WORKER_INTELLIGENCE_DIRECTORY).isDirectory())
      throw new Error();
  } catch {
    throw new Error('Controlled worker Python runtime is unavailable.');
  }
  let url;
  try { url = new URL(source.WORKER_DATABASE_URL); } catch { throw new Error('Invalid controlled worker connection.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || decodeURIComponent(url.username) !== 'meddecode_auto_worker_login' ||
      url.hostname !== 'db.wyripeqruhvbksjfsvlr.supabase.co' || url.port !== '5432' || url.pathname !== '/postgres' || url.search || url.hash)
    throw new Error('The dedicated direct automatic worker connection is required.');
  const worker = {};
  for (const [key, value] of Object.entries(source)) if (['PATH','SystemRoot','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA'].includes(key) || key.startsWith('WORKER_') || key.startsWith('PROCESSING_WORKER_')) worker[key] = value;
  worker.AWS_ACCESS_KEY_ID = source.WORKER_AWS_ACCESS_KEY_ID;
  worker.AWS_SECRET_ACCESS_KEY = source.WORKER_AWS_SECRET_ACCESS_KEY;
  if (source.WORKER_AWS_SESSION_TOKEN) worker.AWS_SESSION_TOKEN = source.WORKER_AWS_SESSION_TOKEN;
  worker.AWS_REGION = source.WORKER_AWS_REGION || values.AWS_REGION;
  worker.AWS_S3_BUCKET = source.WORKER_AWS_S3_BUCKET || values.AWS_S3_BUCKET;
  if (!worker.AWS_REGION || !worker.AWS_S3_BUCKET) throw new Error('Worker S3 configuration is incomplete.');
  worker.PROCESSING_WORKER_ENABLED = 'true';
  // V3 is deliberately opt-in for the controlled worker only.  It is never
  // inherited from an arbitrary parent environment.
  worker.MEDDECODE_PRESCRIPTION_REVIEW_V3_ENABLED = 'true';
  for (const key of ['MEDDECODE_CATALOGUE_ENV', 'MEDDECODE_CATALOGUE_HOST', 'MEDDECODE_CATALOGUE_PORT', 'MEDDECODE_CATALOGUE_DATABASE', 'MEDDECODE_CATALOGUE_USER', 'MEDDECODE_CATALOGUE_SSLMODE', 'MEDDECODE_CATALOGUE_SSLROOTCERT', 'MEDDECODE_CATALOGUE_CONNECT_TIMEOUT_SECONDS', 'MEDDECODE_CATALOGUE_PASSFILE', 'MEDDECODE_CATALOGUE_PASSWORD']) {
    if (catalogueSource[key]) worker[key] = catalogueSource[key];
  }
  if (worker.MEDDECODE_CATALOGUE_ENV === 'hosted' && (!worker.MEDDECODE_CATALOGUE_HOST || !worker.MEDDECODE_CATALOGUE_DATABASE || !worker.MEDDECODE_CATALOGUE_USER || !worker.MEDDECODE_CATALOGUE_SSLROOTCERT || (!worker.MEDDECODE_CATALOGUE_PASSWORD && !worker.MEDDECODE_CATALOGUE_PASSFILE))) {
    throw new Error('Restricted catalogue configuration is incomplete.');
  }
  worker.PYTHON_INTELLIGENCE_URL = 'http://127.0.0.1:8000';
  worker.MEDDECODE_INTERNAL_TOKEN = token;
  // The worker receives only its own environment, not backend/.env credentials.
  worker.DOTENV_CONFIG_PATH = path.join(root, '.no-worker-dotenv');
  return worker;
}
async function main() {
  const envFile = path.join(backend, '.env');
  if (!fs.existsSync(envFile)) throw new Error('Missing backend/.env. Configure it from backend/.env.example.');
  const dotenv = require(path.join(backend, 'node_modules', 'dotenv'));
  const local = dotenv.parse(fs.readFileSync(envFile));
  const values = { ...local, ...process.env };
  const problems = checkSettings(values);
  if (problems.length) throw new Error(`Fix the following development settings in backend/.env or the current environment: ${problems.join(', ')}.`);
  if (!await probePort(3000)) throw new Error('Backend port 3000 is unavailable. Stop only the conflicting service and retry.');
  if (!await probePort(8000)) throw new Error('Intelligence port 8000 is unavailable. Stop only the conflicting service and retry.');
  const port = await chooseFrontendPort();
  const python = process.env.MEDDECODE_PYTHON_EXECUTABLE || path.join(intelligence, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  if (!fs.existsSync(python)) throw new Error('Python virtual environment is unavailable.');
  const token = process.env.MEDDECODE_INTERNAL_TOKEN || crypto.randomBytes(32).toString('hex');
  if (token.length < 32) throw new Error('Internal intelligence token must contain at least 32 characters.');
  const pythonFile = path.join(intelligence, '.env');
  const pythonLocal = fs.existsSync(pythonFile) ? dotenv.parse(fs.readFileSync(pythonFile)) : {};
  const pythonEnv = pythonServiceEnvironment({ ...pythonLocal, ...process.env });
  if (pythonEnv.MEDDECODE_CATALOGUE_ENV === 'local' && process.env.PGPASSFILE && !pythonEnv.MEDDECODE_CATALOGUE_PASSFILE) pythonEnv.PGPASSFILE = process.env.PGPASSFILE;
  pythonEnv.MEDDECODE_INTERNAL_TOKEN = token;
  const workerEnv = controlledWorkerEnvironment(process.env, token, values, { ...pythonLocal, ...process.env });
  if (workerEnv && !fs.existsSync(path.join(backend, 'dist', 'worker.js'))) throw new Error('Build the backend before starting a controlled worker.');
  const children = [];
  let stopping = false;
  const stop = code => {
    if (stopping) return; stopping = true;
    for (const child of children.reverse()) stopTree(child);
    process.exitCode = code;
  };
  process.once('SIGINT', () => stop(0));
  process.once('SIGTERM', () => stop(0));
  const launch = (name, command, args, cwd) => {
    const childEnv = childEnvironment(name, process.env, token);
    const child = spawn(process.execPath, [command, ...args], { cwd, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true });
    children.push(child); prefix(child.stdout, name, process.stdout); prefix(child.stderr, name, process.stderr);
    child.on('error', () => { console.error(`[${name}] Failed to start.`); stop(1); });
    child.on('exit', (code, signal) => { if (!stopping) { console.error(`[${name}] Exited unexpectedly (${code ?? signal}).`); stop(1); } });
    return child;
  };
  try {
    const pythonChild = spawn(python, ['-m', 'uvicorn', 'app.integration.http_service:app', '--host', '127.0.0.1', '--port', '8000'], { cwd: intelligence, env: pythonEnv, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true });
    children.push(pythonChild); prefix(pythonChild.stdout, 'intelligence', process.stdout); prefix(pythonChild.stderr, 'intelligence', process.stderr);
    pythonChild.on('error', () => { console.error('[intelligence] Failed to start.'); stop(1); });
    pythonChild.on('exit', (code, signal) => { if (!stopping) { console.error(`[intelligence] Exited unexpectedly (${code ?? signal}).`); stop(1); } });
    await waitForHealth(pythonChild, 30000, 8000);
    console.log('[intelligence] Service alive at http://127.0.0.1:8000; check /ready for model readiness.');
    const api = launch('backend', path.join(backend, 'node_modules', 'tsx', 'dist', 'cli.mjs'), ['watch', 'src/server.ts'], backend);
    await waitForHealth(api);
    console.log('[backend] API healthy at http://127.0.0.1:3000');
    console.log('[backend] Official catalogue enabled; processing job store enabled; worker disabled.');
    launch('frontend', path.join(frontend, 'node_modules', 'vite', 'bin', 'vite.js'), ['--host', '127.0.0.1', '--port', String(port), '--strictPort'], frontend);
    console.log(`[frontend] Starting at http://127.0.0.1:${port} (a different port may require signing in again).`);
    if (workerEnv) {
      await waitForHealth(pythonChild, 120000, 8000, '/ready');
      const worker = spawn(process.execPath, [path.join(backend, 'dist', 'worker.js')], { cwd: backend, env: workerEnv, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', windowsHide: true });
      children.push(worker); prefix(worker.stdout, 'worker', process.stdout); prefix(worker.stderr, 'worker', process.stderr);
      worker.on('error', () => { console.error('[worker] Failed to start.'); stop(1); });
      worker.on('exit', (code, signal) => { if (!stopping) console.log(`[worker] Controlled worker exited (${code ?? signal}).`); });
    }
  } catch (error) { stop(1); throw error; }
}
if (require.main === module) main().catch(error => { console.error(`[dev] ${error.message}`); process.exitCode = 1; });
module.exports = { checkSettings, chooseFrontendPort, probePort, childEnvironment, pythonServiceEnvironment, controlledWorkerEnvironment, prefix };
