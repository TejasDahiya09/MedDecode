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
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'MedDecode', exact: true })).toBeVisible();
      await expect(page.getByText('Intelligence Behind Every Prescription')).toBeVisible();
      await expect(page.getByText(/Product workflows are not yet implemented/)).toBeVisible();
      const select = page.getByLabel('Appearance');
      await page.keyboard.press('Tab');
      await expect(select).toBeFocused();
      expect(await select.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('solid');
      await page.keyboard.press('Home');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await expect(select).toHaveValue('dark');
      await select.selectOption(theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await page.reload();
      await expect(select).toHaveValue(theme);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      const box = await select.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
      // Verify actual provisional text/background contrast, not only token declarations.
      const ratios = await page.locator('h1, .muted, .tagline').evaluateAll((elements) => {
        const luminance = (color: string) => {
          const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((v) => {
            const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          });
          return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
        };
        const surface = luminance(getComputedStyle(document.querySelector('.foundation-panel')!).backgroundColor);
        return elements.map((element) => {
          const text = luminance(getComputedStyle(element).color);
          return (Math.max(text, surface) + 0.05) / (Math.min(text, surface) + 0.05);
        });
      });
      for (const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(4.5);
      await mkdir('test-results/evidence', { recursive: true });
      const mode = baseURL?.includes(':4174') ? 'preview' : 'dev';
      await page.screenshot({ path: `test-results/evidence/${mode}-${viewport.name}-${theme}-${viewport.width}x${viewport.height}.png`, fullPage: true });
      expect(serviceRequests).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
}

test('system preference follows the OS; explicit preferences override it', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const select = page.getByLabel('Appearance');
  await expect(select).toHaveValue('system');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await select.selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await select.selectOption('system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('synchronizes preferences between real browser tabs', async ({ page, context }) => {
  await page.goto('/');
  const second = await context.newPage();
  await second.goto('/');
  await page.getByLabel('Appearance').selectOption('dark');
  await expect(second.getByLabel('Appearance')).toHaveValue('dark');
  await expect(second.locator('html')).toHaveAttribute('data-theme', 'dark');
  await second.close();
});

test('pre-React initialization works with stored preference', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('meddecode-theme', 'dark'));
  await page.route(/\/(src\/main\.tsx|assets\/index-[^/]+\.js)(\?.*)?$/, (route) => route.abort());
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#root')).toBeEmpty();
});
