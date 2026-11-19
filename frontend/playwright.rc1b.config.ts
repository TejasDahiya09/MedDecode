import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const frontendDir = fileURLToPath(new URL('.', import.meta.url));
const repositoryDir = fileURLToPath(new URL('..', import.meta.url));
const aliceSecret = randomBytes(32).toString('base64url');
const bobSecret = randomBytes(32).toString('base64url');
const internalToken = randomBytes(48).toString('base64url');
process.env.PHASE1F_ALICE_SECRET = aliceSecret;
process.env.PHASE1F_BOB_SECRET = bobSecret;
const inheritedNames = ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'LOCALAPPDATA', 'APPDATA', 'USERPROFILE'];
const localBaseEnv = Object.fromEntries(inheritedNames.flatMap(name => process.env[name] === undefined ? [] : [[name, process.env[name]!]]));

export default defineConfig({
  metadata: { phase1fAliceSecret: aliceSecret, phase1fBobSecret: bobSecret },
  testDir: './tests/e2e', testMatch: 'prescription-review-rc1b.spec.ts',
  outputDir: 'C:/Users/dahiy/MedDecode/tmp/rc1b-playwright-results', workers: 1, retries: 0, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5176', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: [
    {
      command: `"${repositoryDir}/intelligence/.venv/Scripts/python.exe" -m uvicorn app.integration.http_service:app --host 127.0.0.1 --port 18000 --log-level warning`,
      cwd: `${repositoryDir}/intelligence`, url: 'http://127.0.0.1:18000/ready', timeout: 30_000, reuseExistingServer: false,
      env: { ...localBaseEnv, MEDDECODE_INTERNAL_TOKEN: internalToken,
        MEDDECODE_EASYOCR_MODEL_DIRECTORY: 'C:\\Users\\dahiy\\.EasyOCR\\model', MEDDECODE_CATALOGUE_ENV: 'local',
        MEDDECODE_CATALOGUE_HOST: '127.0.0.1', MEDDECODE_CATALOGUE_PORT: '55440',
        MEDDECODE_CATALOGUE_DATABASE: 'meddecode_phase1f_20261115', MEDDECODE_CATALOGUE_USER: 'meddecode_catalogue_rc1a_reader',
        MEDDECODE_CATALOGUE_SSLMODE: 'disable', MEDDECODE_ADAPTIVE_OCR_ENABLED: 'false', MEDDECODE_TROCR_ENABLED: 'false' },
    },
    {
      command: 'npx --no-install tsx scripts/prescription-review-phase1f-server.ts', cwd: `${repositoryDir}/backend`,
      url: 'http://127.0.0.1:3011/health', timeout: 30_000, reuseExistingServer: false,
      env: { ...localBaseEnv, PGHOST: '127.0.0.1', PGPORT: '55440', PHASE1F_DATABASE: 'meddecode_phase1f_20261115',
        PHASE1F_ALICE_SECRET: aliceSecret, PHASE1F_BOB_SECRET: bobSecret, RC1B_REAL_OCR: 'true',
        PHASE1F_DOCUMENT: 'C:\\Users\\dahiy\\MedDecode\\tmp\\phase1d4-scanned.pdf',
        PHASE1F_STORAGE_ROOT: 'C:\\Users\\dahiy\\MedDecode\\tmp\\rc1b-documents',
        MEDDECODE_PYTHON: `${repositoryDir}/intelligence/.venv/Scripts/python.exe`, MEDDECODE_INTELLIGENCE_DIR: `${repositoryDir}/intelligence`,
        MEDDECODE_INTERNAL_TOKEN: internalToken, PYTHON_INTELLIGENCE_URL: 'http://127.0.0.1:18000',
        MEDDECODE_PRESCRIPTION_REVIEW_V3_ENABLED: 'false', PROCESSING_WORKER_ENABLED: 'false',
        PROCESSING_JOB_STORE_ENABLED: 'true', PRESCRIPTION_AUTO_SUBMIT_ENABLED: 'true',
        SUPABASE_URL: 'https://phase1f.invalid', SUPABASE_PUBLISHABLE_KEY: 'phase1f-local-only-key',
        CORS_ORIGIN: 'http://127.0.0.1:5176', NODE_ENV: 'test' },
    },
    {
      command: 'npx vite --config vite.phase1f.config.ts', cwd: frontendDir,
      url: 'http://127.0.0.1:5176', timeout: 30_000, reuseExistingServer: false,
      env: { ...localBaseEnv, VITE_API_BASE_URL: '/', VITE_SUPABASE_URL: 'https://phase1f-auth.invalid',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'phase1f-local-only-key', VITE_PRESCRIPTION_REVIEW_ENABLED: 'true',
        VITE_PRESCRIPTION_AUTO_SUBMIT_ENABLED: 'true', VITE_PRESCRIPTION_AUTO_SUBMIT_BACKEND_ENABLED: 'true' },
    },
  ],
});
