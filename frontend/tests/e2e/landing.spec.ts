import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

for (const size of [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
]) for (const theme of ['light', 'dark'] as const) {
  test(`landing ${size.name} ${theme}: sections, independent rendering, layout and evidence`, async ({ page, baseURL }) => {
    const errors: string[] = []; const calls: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('request', (request) => { if (['fetch', 'xhr'].includes(request.resourceType())) calls.push(request.url()); });
    await page.setViewportSize(size);
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(page).toHaveTitle('MedDecode | Intelligence Behind Every Prescription');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Understand your prescriptions. Know your medicines.');
    await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Mobile navigation', exact: true })).toHaveCount(0);
    await expect(page.locator('input, form')).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.locator('.cc-public-theme-toggle')).toHaveCount(1);
    await expect(page.getByRole('button', { name: /Use system|Theme preference/ })).toHaveCount(0);
    const toggleBox = await page.locator('.cc-public-theme-toggle').boundingBox();
    expect(toggleBox!.width).toBeGreaterThanOrEqual(44); expect(toggleBox!.height).toBeGreaterThanOrEqual(44);
    const headerBox = await page.locator('.cc-public-header').boundingBox();
    expect(headerBox!.height).toBe(size.name === 'desktop' ? 81 : 79);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('.cc-journey-steps > li')).toHaveCount(3);
    await expect(page.getByRole('group', { name: 'Explore planned capabilities' }).getByRole('button')).toHaveCount(6);
    await expect(page.locator('#trust')).toContainText('Consult a qualified healthcare professional before making medication decisions.');
    // Actual text contrast on solid source surfaces (gradients need separate visual review).
    const ratios = await page.locator('.cc-landing-hero-copy h1, .cc-landing-lead, .md-capability-scene p').evaluateAll((elements) => {
      const luminance = (rgb: string) => {
        const c = rgb.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((v) => { const n = v / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4; });
        return c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
      };
      return elements.map((element) => {
        let parent: Element | null = element;
        while (parent && ['rgba(0, 0, 0, 0)', 'transparent'].includes(getComputedStyle(parent).backgroundColor)) parent = parent.parentElement;
        const bg = luminance(getComputedStyle(parent ?? document.documentElement).backgroundColor);
        const fg = luminance(getComputedStyle(element).color);
        return (Math.max(bg, fg) + .05) / (Math.min(bg, fg) + .05);
      });
    });
    for (const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(4.5);
    await page.evaluate(() => document.fonts.ready);
    await mkdir('test-results/evidence', { recursive: true });
    const prefix = `test-results/evidence/${baseURL?.includes(':4174') ? 'preview' : 'dev'}-landing-${size.name}-${theme}`;
    await page.screenshot({ path: `${prefix}-full.png`, fullPage: true, animations: 'disabled' });
    await page.screenshot({ path: `${prefix}-viewport.png`, animations: 'disabled' });
    if (theme === 'light' && size.name !== 'tablet') {
      await page.locator('footer.cc-public-footer').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${prefix}-footer.png`, animations: 'disabled' });
    }
    if (size.name === 'desktop' && theme === 'light') {
      await page.locator('#how-it-works').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${prefix}-process.png`, animations: 'disabled' });
      const cta = page.locator('.cc-landing-hero-actions').first().getByRole('link', { name: 'Get Started' });
      await page.keyboard.press('Tab'); await cta.focus();
      await expect(cta).toBeFocused();
      expect(await cta.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
      await page.screenshot({ path: `${prefix}-cta-focus.png`, animations: 'disabled' });
    }
    expect(errors).toEqual([]); expect(calls).toEqual([]);
  });
}

test('public CTAs, anchor focus, capability controls, footer and history', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto('/');
  await page.getByRole('link', { name: 'Explore Features', exact: true }).click();
  await expect(page).toHaveURL(/\/#product$/); await expect(page.locator('#product')).toBeFocused();
  await page.locator('#how-it-works').scrollIntoViewIfNeeded();
  await page.getByRole('navigation', { name: 'Public navigation' }).getByRole('link', { name: 'Features', exact: true }).click();
  await expect(page.locator('#product')).toBeFocused();
  expect(await page.locator('#product').evaluate((el) => el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(80);
  expect(await page.locator('#product').evaluate((el) => el.getBoundingClientRect().top)).toBeLessThan(120);
  await expect(page.getByRole('navigation', { name: 'Public navigation' }).getByRole('link', { name: 'Features', exact: true })).toHaveAttribute('aria-current', 'location');
  await page.getByRole('button', { name: /^Safety Awareness/ }).click();
  await expect(page.locator('#landing-module-scene h3')).toHaveText('Safety Awareness');
  await page.getByRole('navigation', { name: 'Public navigation' }).getByRole('link', { name: 'How it works' }).click();
  await expect(page.locator('#how-it-works')).toBeFocused();
  expect(await page.locator('#how-it-works').evaluate((el) => el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(80);
  await page.getByRole('navigation', { name: 'Public navigation' }).getByRole('link', { name: 'Responsible use' }).click();
  await expect(page.locator('#trust')).toBeFocused();
  await page.locator('header.cc-public-header').getByRole('link', { name: 'Get Started', exact: true }).click();
  await expect(page).toHaveURL(/\/sign-up$/); await expect(page.getByRole('heading', { level: 1 })).toHaveText('Create your account.');
  await expect(page.getByRole('main')).toBeFocused(); await expect(page.getByRole('form', { name: 'Create Account' }).locator('input')).toHaveCount(4);
  await expect(page.getByText(/Account access is not connected yet/)).toBeVisible();
  await page.getByRole('link', { name: 'Back to MedDecode' }).click();
  await page.locator('header.cc-public-header').getByRole('link', { name: 'Sign In', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Welcome back.');
  await page.goBack(); await expect(page).toHaveURL(/\/$/);
  await page.getByRole('navigation', { name: 'Footer navigation' }).getByRole('link', { name: 'Learn & Resources preview' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Learn & Resources');
});

test('public mobile disclosure supports focus, Escape, outside click and navigation', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  const trigger = page.getByRole('button', { name: 'Open Explore menu' });
  await trigger.click();
  const nav = page.getByRole('navigation', { name: 'Mobile public navigation' });
  await expect(nav.getByRole('link', { name: 'Features', exact: true })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Close Explore menu' })).toHaveAttribute('aria-expanded', 'true');
  await page.screenshot({ path: `test-results/evidence/${baseURL?.includes(':4174') ? 'preview' : 'dev'}-landing-mobile-menu-open.png`, animations: 'disabled' });
  await page.keyboard.press('Escape'); await expect(nav).toHaveCount(0); await expect(trigger).toBeFocused();
  await trigger.click();
  for (let index = 0; index < 5; index++) await page.keyboard.press('Tab');
  await expect(nav).toHaveCount(0);
  await expect(page.locator('.cc-landing-hero-actions').first().getByRole('link', { name: 'Get Started' })).toBeFocused();
  await trigger.click(); await page.locator('.cc-landing-lead').click(); await expect(nav).toHaveCount(0);
  await trigger.click(); await nav.getByRole('link', { name: 'How it works' }).click();
  await expect(nav).toHaveCount(0); await expect(page.locator('#how-it-works')).toBeFocused();
  await trigger.click(); await nav.getByRole('link', { name: 'Sign In' }).click();
  await expect(page).toHaveURL(/\/sign-in$/); await expect(nav).toHaveCount(0);
});

test('public themes persist across workspace routes, reload, OS and real tabs', async ({ page, context }) => {
  await page.emulateMedia({ colorScheme: 'light' }); await page.goto('/');
  await page.getByRole('button', { name: 'Switch to dark mode' }).click(); await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('navigation', { name: 'Footer navigation' }).getByRole('link', { name: 'Workspace preview' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark'); await expect(page.getByRole('main')).toBeFocused();
  const second = await context.newPage(); await second.goto('/');
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(second.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(second.getByRole('button', { name: 'Switch to dark mode' })).toBeVisible();
  await page.evaluate(() => localStorage.removeItem('meddecode-theme')); await page.reload(); await page.goto('/');
  await page.emulateMedia({ colorScheme: 'dark' }); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await second.close();
});

test('narrow and 200-percent-equivalent reflow, reduced motion and deep anchors', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const width of [320, 720]) {
    await page.setViewportSize({ width, height: 450 }); await page.goto('/#trust');
    await expect(page.locator('#trust')).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Open Explore menu' }).click();
    await page.keyboard.press('Escape');
    expect(await page.locator('.cc-product-canvas').evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  }
});
