import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const frontendDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'prescription-results-responsive.spec.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5175',
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: process.platform === 'win32'
      ? 'cmd /c npm run dev -- --host 127.0.0.1 --port 5175 --strictPort'
      : 'npm run dev -- --host 127.0.0.1 --port 5175 --strictPort',
    url: 'http://127.0.0.1:5175',
    cwd: frontendDir,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      VITE_API_BASE_URL: '/backend',
      VITE_SUPABASE_URL: 'https://mock.supabase.test',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_key',
    },
  },
});
