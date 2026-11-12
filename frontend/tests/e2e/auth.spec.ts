import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { authScreens, type AuthScreen } from '../../src/features/auth/auth-presentation';

const evidence = 'playwright-report/b4a2';
const sizes = [{ name: 'narrow', width: 320, height: 568 }, { name: 'desktop', width: 1440, height: 900 }, { name: 'tablet', width: 768, height: 1024 }, { name: 'mobile', width: 390, height: 844 }];
async function fill(page: Page, kind: AuthScreen) {
  if (kind === 'sign-up') await page.getByLabel('Full name', { exact: true }).fill('Preview Reader');
  if (kind !== 'reset-password') await page.getByLabel('Email address', { exact: true }).fill('preview@example.test');
  if (kind !== 'forgot-password') await page.getByLabel(kind === 'reset-password' ? 'New password' : 'Password', { exact: true }).fill('Preview-only-42!');
  if (kind === 'sign-up' || kind === 'reset-password') await page.getByLabel(kind === 'reset-password' ? 'Confirm new password' : 'Confirm password', { exact: true }).fill('Preview-only-42!');
}

for (const kind of Object.keys(authScreens) as AuthScreen[]) for (const size of sizes) for (const theme of ['light', 'dark'] as const) {
  test(`auth ${kind} ${size.name} ${theme}: independent presentation and screenshot`, async ({ page, baseURL }) => {
    const errors: string[] = []; const calls: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('request', (request) => { if (['fetch', 'xhr'].includes(request.resourceType())) calls.push(request.url()); });
    await page.setViewportSize(size); await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.goto('/' + kind); await page.evaluate(() => document.fonts.ready);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(authScreens[kind].title);
    await expect(page).toHaveTitle(`${authScreens[kind].pageTitle} | MedDecode`);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.getByText(/Account access is not connected yet/)).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('form').locator('input')).toHaveCount(authScreens[kind].fields.length);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    {
      const toolbar = await page.locator('.cc-login-panel-top').boundingBox();
      const form = await page.locator('.cc-login-form-wrap').boundingBox();
      expect(toolbar!.y + toolbar!.height).toBeLessThanOrEqual(form!.y);
    }
    if (size.name === 'desktop') await expect(page.getByRole('region', { name: 'MedDecode introduction' })).toBeVisible();
    else await expect(page.getByRole('region', { name: 'MedDecode introduction' })).toBeHidden();
    for (const input of await page.getByRole('form').locator('input').all()) {
      const id = await input.getAttribute('id');
      await expect(page.locator(`label[for="${id}"]`)).toBeVisible();
      const rect = await input.boundingBox(); expect(rect!.height).toBeGreaterThanOrEqual(44);
    }
    for (const button of await page.getByRole('button').all()) {
      const rect = await button.boundingBox(); expect(rect!.width).toBeGreaterThanOrEqual(44); expect(rect!.height).toBeGreaterThanOrEqual(44);
    }
    const contrast = await page.locator('.cc-login-page').evaluate((el) => {
      const style = getComputedStyle(el);
      const lum = (hex: string) => { const raw = hex.trim().slice(1); const c = (raw.length === 3 ? raw.split('').map((v) => v + v).join('') : raw).match(/../g)!.slice(0, 3).map((v) => parseInt(v, 16) / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); return c[0] * .2126 + c[1] * .7152 + c[2] * .0722; };
      const fg = lum(style.getPropertyValue('--login-muted'));
      return ['--login-panel', '--login-panel-elevated'].map((name) => { const bg = lum(style.getPropertyValue(name)); return (Math.max(bg, fg) + .05) / (Math.min(bg, fg) + .05); });
    });
    for (const ratio of contrast) expect(ratio).toBeGreaterThanOrEqual(4.5);
    const submit = page.getByRole('button', { name: authScreens[kind].action, exact: true });
    for (const hover of [false, true]) {
      if (hover) await submit.hover();
      const stops = await submit.evaluate((el) => {
        const style = getComputedStyle(el);
        const lum = (rgb: string) => {
          const c = rgb.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((v) => { const n = v / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; });
          return c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
        };
        const fg = lum(style.color);
        return [...style.backgroundImage.matchAll(/rgb\([^)]+\)/g)].map(([rgb]) => { const bg = lum(rgb); return (Math.max(bg, fg) + .05) / (Math.min(bg, fg) + .05); });
      });
      expect(stops).toHaveLength(2);
      for (const ratio of stops) expect(ratio).toBeGreaterThanOrEqual(4.5);
    }
    await page.mouse.move(0, 0);
    expect(await page.locator('.cc-login-form-wrap').evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
    await mkdir(evidence, { recursive: true });
    await page.screenshot({ path: `${evidence}/${baseURL?.includes(':4174') ? 'preview' : 'dev'}-${kind}-${size.name}-${theme}.png`, fullPage: true, animations: 'disabled' });
    expect(errors).toEqual([]); expect(calls).toEqual([]);
  });
}

for (const kind of Object.keys(authScreens) as AuthScreen[]) {
  test(`auth ${kind}: keyboard validation, unavailable submission and no persistence`, async ({ page, baseURL }) => {
    const calls: string[] = []; const logs: string[] = [];
    page.on('request', (request) => { if (['fetch', 'xhr'].includes(request.resourceType())) calls.push(request.url()); });
    page.on('console', (message) => logs.push(message.text()));
    await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/' + kind);
    const first = page.getByRole('form').locator('input').first();
    await first.focus(); await page.keyboard.press('Enter');
    await expect(page.getByRole('alert')).toHaveText('Please check the highlighted fields.');
    await expect(first).toBeFocused();
    for (const input of await page.locator('[aria-invalid="true"]').all()) {
      const ids = (await input.getAttribute('aria-describedby'))!.split(' ');
      for (const id of ids) await expect(page.locator(`#${id}`)).toBeVisible();
    }
    const mode = baseURL?.includes(':4174') ? 'preview' : 'dev';
    await page.screenshot({ path: `${evidence}/${mode}-${kind}-validation-mobile.png`, fullPage: true, animations: 'disabled' });
    if (kind !== 'reset-password') {
      await page.getByLabel('Email address', { exact: true }).fill('not-an-email');
      await page.getByLabel('Email address', { exact: true }).blur();
      await expect(page.getByText('Enter a valid email address.')).toBeVisible();
    }
    await fill(page, kind);
    await expect(page.locator('[aria-invalid="true"]')).toHaveCount(0);
    const last = page.getByRole('form').locator('input').last();
    await last.focus(); await page.keyboard.press('Enter');
    await expect(page.getByRole('status')).toHaveText(authScreens[kind].unavailable);
    await expect(page).toHaveURL(new RegExp(`/${kind}$`));
    expect(await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage }, cookie: document.cookie }))).toEqual({ local: {}, session: {}, cookie: '' });
    expect(calls).toEqual([]); expect(logs.some((entry) => /Preview-only|preview@example|Preview Reader/.test(entry))).toBe(false);
    await page.reload();
    await expect(page.getByRole('form').locator('input').first()).toHaveValue('');
    await expect(page.getByRole('status')).toBeEmpty();
  });
}

test('password visibility, matching corrections and focused-control evidence', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto('/sign-up');
  await fill(page, 'sign-up');
  await page.getByLabel('Confirm password', { exact: true }).fill('Mismatch-preview');
  await page.getByRole('button', { name: 'Create Account', exact: true }).click();
  await expect(page.getByText('Passwords do not match.')).toBeVisible();
  await page.getByLabel('Confirm password', { exact: true }).fill('Preview-only-42!');
  await expect(page.getByText('Passwords do not match.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show password', exact: true }).click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
  await expect(page.getByLabel('Confirm password', { exact: true })).toHaveAttribute('type', 'password');
  await expect(page.getByRole('button', { name: 'Hide password', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('status')).toBeEmpty();
  const mode = baseURL?.includes(':4174') ? 'preview' : 'dev';
  await page.screenshot({ path: `${evidence}/${mode}-sign-up-password-visible-desktop.png`, fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Hide password', exact: true }).click();
  await page.keyboard.press('Tab');
  const password = page.getByLabel('Password', { exact: true }); await password.focus();
  expect(await password.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
  await page.screenshot({ path: `${evidence}/${mode}-sign-up-focused-control-desktop.png`, fullPage: true, animations: 'disabled' });
});

test('auth routes, landing CTA alias, history and shared theme remain coherent', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto('/');
  await page.locator('.cc-landing-hero-actions').first().getByRole('link', { name: 'Get Started' }).click();
  await expect(page).toHaveURL(/\/sign-up$/); await expect(page.getByRole('main')).toBeFocused();
  await page.getByRole('link', { name: 'Back to Sign In' }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await page.getByRole('link', { name: 'Forgot password?' }).click(); await expect(page).toHaveURL(/\/forgot-password$/);
  await page.goBack(); await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('link', { name: 'Back to MedDecode' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Understand your prescriptions. Know your medicines.');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.goto('/reset-password?token=synthetic-not-consumed#access_token=synthetic-not-consumed');
  await expect(page.getByLabel('New password', { exact: true })).toHaveValue('');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage } }))).toEqual({ local: { 'meddecode-theme': 'dark' }, session: {} });
  await page.goto('/home'); await page.evaluate(() => localStorage.removeItem('meddecode-theme')); await page.reload();
  await page.goto('/sign-in'); await page.emulateMedia({ colorScheme: 'light' }); await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByRole('button', { name: 'Use system theme' })).toHaveCount(0);
});

test('320px enlarged text and constrained keyboard viewport retain every form control', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const kind of Object.keys(authScreens) as AuthScreen[]) {
    await page.setViewportSize({ width: 320, height: 568 }); await page.goto('/' + kind);
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const toolbar = await page.locator('.cc-login-panel-top').boundingBox();
    const form = await page.locator('.cc-login-form-wrap').boundingBox();
    expect(toolbar!.y + toolbar!.height).toBeLessThanOrEqual(form!.y);
    await fill(page, kind);
    await page.getByRole('button', { name: authScreens[kind].action, exact: true }).click();
    await expect(page.getByRole('status')).toHaveText(authScreens[kind].unavailable);
    await page.goto('/' + kind); await page.setViewportSize({ width: 390, height: 360 });
    const last = page.getByRole('form').locator('input').last(); await last.focus();
    await last.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const rect = await last.boundingBox(); expect(rect!.y).toBeGreaterThanOrEqual(0); expect(rect!.y + rect!.height).toBeLessThanOrEqual(360);
    await fill(page, kind); await last.focus(); await page.keyboard.press('Enter');
    await expect(page.getByRole('status')).toHaveText(authScreens[kind].unavailable);
    await expect(page.getByRole('link', { name: 'Back to MedDecode' })).toBeVisible();
  }
});
