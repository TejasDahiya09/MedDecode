import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/backend/**', (route) => route.abort());
});

for (const viewport of [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`${viewport.name} ${theme}: renders independently with accessible controls`, async ({ page, baseURL }) => {
      const errors: string[] = [];
      const serviceRequests: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
      page.on('request', (request) => { if (['fetch', 'xhr'].includes(request.resourceType())) serviceRequests.push(request.url()); });
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.goto('/home');
      await expect(page.getByRole('heading', { name: 'Welcome, Demo User.', exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: 'MedDecode home' })).toBeVisible();
      await expect(page.getByText('Demo Mode', { exact: true })).toBeVisible();
      await expect(page.locator('.md-demo-footnote')).toContainText('No account, cloud saving or background notifications');
      const opposite = theme === 'light' ? 'dark' : 'light';
      const control = page.getByRole('button', { name: `Switch to ${opposite} mode` });
      await control.focus();
      await expect(control).toBeFocused();
      expect(await control.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('solid');
      await page.keyboard.press('Enter');
      await expect(page.locator('html')).toHaveAttribute('data-theme', opposite);
      await page.getByRole('button', {name:`Switch to ${theme} mode`}).click();
      await page.reload();
      await expect(control).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const box = await control.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      // Verify actual demo text/background contrast, not only token declarations.
      const ratios = await page.locator('h1, .md-demo-footnote, .md-demo-muted, .md-demo-notice p').evaluateAll((elements) => {
        const luminance = (color: string) => {
          const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((v) => {
            const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          });
          return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
        };
        return elements.map((element) => {
          let parent: Element | null = element;
          while (parent && ['rgba(0, 0, 0, 0)', 'transparent'].includes(getComputedStyle(parent).backgroundColor)) parent = parent.parentElement;
          const surface = luminance(getComputedStyle(parent ?? document.documentElement).backgroundColor);
          const text = luminance(getComputedStyle(element).color);
          return (Math.max(text, surface) + 0.05) / (Math.min(text, surface) + 0.05);
        });
      });
      for (const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(4.5);
      await mkdir('test-results/evidence', { recursive: true });
      const mode = baseURL?.includes(':4174') ? 'preview' : 'dev';
      await page.screenshot({ path: `test-results/evidence/${mode}-shell-${viewport.name}-${theme}-${viewport.width}x${viewport.height}.png`, fullPage: true, animations: 'disabled' });
      expect(serviceRequests).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
}

test('system preference follows the OS; explicit preferences override it', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/home');
  expect(await page.evaluate(() => localStorage.getItem('meddecode-theme'))).toBeNull();
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.evaluate(() => localStorage.removeItem('meddecode-theme'));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('synchronizes preferences between real browser tabs', async ({ page, context }) => {
  await page.goto('/home');
  const second = await context.newPage();
  await second.goto('/home');
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await expect(second.getByRole('button', { name: 'Switch to light mode' })).toBeVisible();
  await expect(second.locator('html')).toHaveAttribute('data-theme', 'dark');
  await second.close();
});

test('pre-React initialization works with stored preference', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('meddecode-theme', 'dark'));
  await page.route(/\/(src\/main\.tsx|assets\/index-[^/]+\.js)(\?.*)?$/, (route) => route.abort());
  await page.goto('/home');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#root')).toBeEmpty();
});
