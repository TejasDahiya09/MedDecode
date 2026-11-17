import { defineConfig } from '@playwright/test';

const configuredEnvironment = {
  VITE_API_BASE_URL: '/backend',
  VITE_SUPABASE_URL: 'https://mock.supabase.test',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic_browser_key',
};

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  reporter: 'list',
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    {
      name: 'auth-mocked',
      testMatch: /auth-browser\.spec\.ts/,
      use: { browserName: 'chromium', baseURL: 'http://localhost:5174' },
    },
    {
      name: 'auth-missing-config',
      testMatch: /auth-missing-config\.spec\.ts/,
      use: { browserName: 'chromium', baseURL: 'http://localhost:5175' },
    },
  ],
  webServer: [
    {
      command: 'npm run dev',
      url: 'http://localhost:5174',
      reuseExistingServer: true,
      timeout: 30_000,
      env: configuredEnvironment,
    },
    {
      command: 'npx --no-install vite --host localhost --port 5175 --strictPort',
      url: 'http://localhost:5175',
      reuseExistingServer: true,
      timeout: 30_000,
      env: { VITE_API_BASE_URL: '/backend', VITE_SUPABASE_URL: '', VITE_SUPABASE_PUBLISHABLE_KEY: '' },
    },
  ],
});
