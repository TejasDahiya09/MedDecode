import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const frontendDir = fileURLToPath(new URL('.', import.meta.url));
const repositoryDir = fileURLToPath(new URL('..', import.meta.url));
const aliceSecret = randomBytes(32).toString('base64url');
const bobSecret = randomBytes(32).toString('base64url');
process.env.PHASE1F_ALICE_SECRET = aliceSecret;
process.env.PHASE1F_BOB_SECRET = bobSecret;

export default defineConfig({
  metadata: { phase1fAliceSecret: aliceSecret, phase1fBobSecret: bobSecret },
  testDir: './tests/e2e', testMatch: 'platform-repair-batch3.spec.ts',
  outputDir: 'C:/Users/dahiy/MedDecode/tmp/batch3-playwright-results', workers: 1, retries: 0, reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:5176', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: [
    {
      command: 'npx --no-install tsx scripts/prescription-review-phase1f-server.ts', cwd: `${repositoryDir}/backend`,
      url: 'http://127.0.0.1:3011/health', timeout: 30_000, reuseExistingServer: false,
      env: { ...process.env, PGHOST: '127.0.0.1', PGPORT: '55440', PHASE1F_DATABASE: 'meddecode_phase1f_20261115',
        PHASE1F_ALICE_SECRET: aliceSecret, PHASE1F_BOB_SECRET: bobSecret,
        PHASE1F_USER_MODULES_ONLY: 'true',
        PHASE1F_CONTRACT: 'C:\\Users\\dahiy\\MedDecode\\tmp\\phase1d4-contract.json',
        PHASE1F_DOCUMENT: 'C:\\Users\\dahiy\\MedDecode\\tmp\\phase1d4-scanned.pdf',
        PHASE1F_STORAGE_ROOT: 'C:\\Users\\dahiy\\MedDecode\\tmp\\batch3-documents',
        MEDDECODE_PYTHON: `${repositoryDir}/intelligence/.venv/Scripts/python.exe`, MEDDECODE_INTELLIGENCE_DIR: `${repositoryDir}/intelligence`,
        MEDDECODE_PRESCRIPTION_REVIEW_V3_ENABLED: 'false', PROCESSING_WORKER_ENABLED: 'false',
        SUPABASE_URL: 'https://phase1f.invalid', SUPABASE_PUBLISHABLE_KEY: 'phase1f-local-only-key',
        CORS_ORIGIN: 'http://127.0.0.1:5176', NODE_ENV: 'test' },
    },
    {
      command: 'npx vite --config vite.phase1f.config.ts', cwd: frontendDir,
      url: 'http://127.0.0.1:5176', timeout: 30_000, reuseExistingServer: false,
      env: { ...process.env, VITE_API_BASE_URL: '/', VITE_SUPABASE_URL: 'https://phase1f-auth.invalid',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'phase1f-local-only-key', VITE_PRESCRIPTION_REVIEW_ENABLED: 'true' },
    },
  ],
});
