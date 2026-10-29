import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const folder = 'playwright-report/b4a1';
test('source ribbon visibly morphs, drifts, pauses offscreen and becomes static for reduced motion', async ({ page, baseURL }) => {
  const mode = baseURL?.includes(':4174') ? 'preview' : 'dev';
  await mkdir(folder, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'dark' });
  await page.goto('/sign-in'); await page.evaluate(() => document.fonts.ready);
  const ribbon = page.locator('.cc-login-ribbon'); const svg = ribbon.locator('svg');
  await expect(ribbon.locator('animate')).toHaveCount(4);
  expect(await ribbon.locator('animate').evaluateAll((els) => els.map((el) => el.getAttribute('dur')))).toEqual(['12s', '9s', '11s', '6.5s']);
  const sample = () => svg.evaluate((el: SVGSVGElement) => ({
    time: el.getCurrentTime(), paused: el.animationsPaused(),
    point: (() => { const p = el.querySelector<SVGPathElement>('.cc-login-ribbon-layer--main path')!.getPointAtLength(150); return { x: p.x, y: p.y }; })(),
    transform: getComputedStyle(el.querySelector('.cc-login-ribbon-layer--main')!).transform,
  }));
  await expect.poll(async () => (await sample()).time).toBeGreaterThan(.8);
  const first = await sample();
  await page.screenshot({ path: `${folder}/${mode}-ribbon-frame-1.png` });
  await expect.poll(async () => Math.abs((await sample()).point.y - first.point.y)).toBeGreaterThan(.5);
  const second = await sample(); expect(second.transform).not.toBe(first.transform);
  await page.screenshot({ path: `${folder}/${mode}-ribbon-frame-2.png` });
  // Real intersection callback pauses both source CSS and SVG timelines.
  await ribbon.evaluate((el) => { (el as HTMLElement).style.top = '2000px'; });
  await expect(ribbon).toHaveClass(/--paused/);
  expect((await sample()).paused).toBe(true);
  expect(await ribbon.locator('.cc-login-ribbon-layer--main').evaluate((el) => getComputedStyle(el).animationPlayState)).toBe('paused');
  await ribbon.evaluate((el) => { (el as HTMLElement).style.top = ''; });
  await expect(ribbon).not.toHaveClass(/--paused/); await expect.poll(async () => (await sample()).paused).toBe(false);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(ribbon.locator('animate')).toHaveCount(0);
  expect(await ribbon.locator('.cc-login-ribbon-layer--main').evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  const reducedFirst = await sample();
  await page.waitForTimeout(300); const reducedSecond = await sample();
  expect(reducedSecond).toEqual(reducedFirst);
  await page.screenshot({ path: `${folder}/${mode}-ribbon-reduced-motion.png` });
  await writeFile(`${folder}/${mode}-motion-observations.json`, JSON.stringify({ first, second, reducedFirst, reducedSecond }, null, 2));
});

for (const size of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobile', width: 390, height: 844 }]) {
  test(`contextual source theme controls ${size.name}: keyboard, values, persistence, System and header evidence`, async ({ page, context, baseURL }) => {
    const mode = baseURL?.includes(':4174') ? 'preview' : 'dev';
    await page.setViewportSize(size); await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
    await page.goto('/sign-in'); await page.getByLabel('Email address').fill('preview@example.test');
    await page.getByLabel('Password', { exact: true }).fill('Preview-only-42!');
    const toggle = page.getByRole('button', { name: 'Switch to dark mode' });
    await toggle.focus(); expect(await toggle.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
    await page.screenshot({ path: `${folder}/${mode}-theme-focused-${size.name}.png`, fullPage: true });
    await page.keyboard.press('Enter'); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByLabel('Email address')).toHaveValue('preview@example.test');
    await expect(page.getByLabel('Password', { exact: true })).toHaveValue('Preview-only-42!');
    expect(await page.evaluate(() => localStorage.getItem('meddecode-theme'))).toBe('dark');
    await page.reload(); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const options = page.getByRole('button', { name: /Theme preference:/ });
    await options.focus(); await page.keyboard.press('Enter'); await expect(page.getByRole('button', { name: 'Use system theme' })).toBeVisible();
    await page.keyboard.press('Escape'); await expect(options).toBeFocused(); await expect(page.getByRole('button', { name: 'Use system theme' })).toBeHidden();
    await options.click(); await page.getByRole('button', { name: 'Use system theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.emulateMedia({ colorScheme: 'dark' }); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const second = await context.newPage(); await second.goto('/');
    await page.getByRole('button', { name: 'Switch to light mode' }).click();
    await expect(second.locator('html')).toHaveAttribute('data-theme', 'light'); await second.close();
    await page.goto('/');
    for (const theme of ['light', 'dark']) {
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      const header = page.locator('.cc-public-header');
      await header.screenshot({ path: `${folder}/${mode}-landing-header-${size.name}-${theme}.png` });
      await page.screenshot({ path: `${folder}/${mode}-landing-${size.name}-${theme}.png`, fullPage: true });
      const button = page.getByRole('button', { name: `Switch to ${theme === 'light' ? 'dark' : 'light'} mode` });
      const rect = await button.boundingBox(); expect(rect!.height).toBeGreaterThanOrEqual(44); expect(rect!.width).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await button.click();
    }
  });
}

test('all forms reflow at 320px in both themes with expanded theme options and enlarged text', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const theme of ['light', 'dark'] as const) for (const route of ['sign-in', 'sign-up', 'forgot-password', 'reset-password']) {
    await page.emulateMedia({ colorScheme: theme }); await page.goto('/' + route);
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    const options = page.getByRole('button', { name: /Theme preference:/ }); await options.click();
    await expect(page.getByRole('button', { name: 'Use system theme' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const popup = await page.locator('.md-theme-preferences-panel').boundingBox();
    expect(popup!.x).toBeGreaterThanOrEqual(0); expect(popup!.x + popup!.width).toBeLessThanOrEqual(320);
    await page.keyboard.press('Escape');
    const toolbar = await page.locator('.cc-login-panel-top').boundingBox(); const form = await page.locator('.cc-login-form-wrap').boundingBox();
    expect(toolbar!.y + toolbar!.height).toBeLessThanOrEqual(form!.y);
    await page.getByRole('button', { name: /^(Sign In|Create Account|Request reset link|Update password)$/ }).click();
    await expect(page.locator('[aria-invalid="true"]').first()).toBeFocused();
  }
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme }); await page.goto('/');
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await page.getByRole('button', { name: /Theme preference:/ }).click();
    await expect(page.getByRole('button', { name: 'Use system theme' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const bounds = await page.locator('.md-theme-preferences-panel').boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Open Explore menu' }).click();
    await expect(page.getByRole('navigation', { name: 'Mobile public navigation' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
