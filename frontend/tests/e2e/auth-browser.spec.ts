import { expect, test, type Page, type Route } from '@playwright/test';

const userId = '10000000-0000-4000-8000-000000000001';
const email = 'synthetic.user@example.test';
const password = 'Synthetic-password-123!';

function base64Url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function accessToken(): string {
  const now = Math.floor(Date.now() / 1000);
  return `${base64Url({ alg: 'HS256', typ: 'JWT' })}.${base64Url({ sub: userId, email, aud: 'authenticated', role: 'authenticated', iat: now, exp: now + 3600 })}.synthetic-signature`;
}

function authPayload() {
  const now = new Date().toISOString();
  return {
    access_token: accessToken(), token_type: 'bearer', expires_in: 3600,
    refresh_token: 'synthetic-refresh-token',
    user: {
      id: userId, aud: 'authenticated', role: 'authenticated', email,
      email_confirmed_at: now, created_at: now, updated_at: now,
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {}, identities: [],
    },
  };
}

async function json(route: Route, status: number, body: object): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function installMocks(page: Page) {
  const state = { identityStatus: 200, bearerHeaders: [] as string[], authRequests: [] as string[] };
  await page.route('https://mock.supabase.test/**', async (route) => {
    const request = route.request();
    state.authRequests.push(`${request.method()} ${new URL(request.url()).pathname}`);
    const url = new URL(request.url());
    if (url.pathname.endsWith('/auth/v1/token') && request.method() === 'POST') return json(route, 200, authPayload());
    if (url.pathname.endsWith('/auth/v1/recover') && request.method() === 'POST') return json(route, 200, {});
    if (url.pathname.endsWith('/auth/v1/logout') && request.method() === 'POST') return json(route, 204, {});
    return json(route, 404, { error: 'unexpected synthetic auth request' });
  });
  await page.route('http://127.0.0.1:5174/backend/**', async (route) => {
    const authorization = route.request().headers().authorization ?? '';
    state.bearerHeaders.push(authorization);
    if (state.identityStatus === 401) return json(route, 401, { error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } });
    return json(route, 200, { user: { id: userId, email } });
  });
  return state;
}

async function signIn(page: Page, destination = '/home') {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page).toHaveURL(new RegExp(`${destination.replace('/', '\\/')}$`));
  if (destination === '/home') await expect(page.getByRole('heading', { name: 'Welcome, Demo User.' })).toBeVisible();
}

test('redirects protected routes and completes verified sign-in with bearer identity', async ({ page }) => {
  const state = await installMocks(page);
  await page.goto('/my-cabinet');
  await expect(page).toHaveURL(/\/sign-in$/);
  await signIn(page, '/my-cabinet');
  expect(state.bearerHeaders.some((header) => header.startsWith('Bearer ') && header.split('.').length === 3)).toBe(true);
  await page.getByRole('link', { name: 'My Cabinet' }).first().click();
  await expect(page).toHaveURL(/\/my-cabinet$/);
});

test('restores a persisted session on refresh without flashing protected content', async ({ page }) => {
  const state = await installMocks(page);
  await signIn(page);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Welcome, Demo User.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toHaveCount(0);
  expect(state.bearerHeaders.filter(Boolean).length).toBeGreaterThanOrEqual(2);
});

test('backend 401 invalidates the browser session and prevents restoration', async ({ page }) => {
  const state = await installMocks(page);
  await signIn(page);
  state.identityStatus = 401;
  await page.reload();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto('/home');
  await expect(page).toHaveURL(/\/sign-in$/);
});

test('sign-out clears persisted identity and returns to public auth state', async ({ page }) => {
  await installMocks(page);
  await signIn(page);
  await page.locator('summary[aria-label="Account menu"]').click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
});

test('auth network failure stays unauthenticated and reports a safe retry message', async ({ page }) => {
  await installMocks(page);
  await page.unroute('https://mock.supabase.test/**');
  await page.route('https://mock.supabase.test/**', (route) => route.abort('failed'));
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.getByRole('alert')).toContainText('Authentication is temporarily unavailable');
  await expect(page).toHaveURL(/\/sign-in$/);
});

test('mobile sign-in remains usable and password recovery reports a non-sensitive state', async ({ page }) => {
  await installMocks(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/sign-in');
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Request reset link' }).click();
  await expect(page.getByRole('alert')).toContainText('If the account exists');
  await expect(page.getByRole('alert')).not.toContainText(email);
});
