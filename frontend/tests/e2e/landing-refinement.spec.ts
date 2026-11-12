import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { capabilities } from '../../src/features/landing/landing-content';

const evidence = 'playwright-report/b3-1-after';
const readingText = '.cc-showcase-option small, .cc-feature-copy p, .cc-canvas-match p, .cc-journey-steps p, .cc-public-footer p, .cc-public-footer-nav a, .md-preview-note';

test.describe('mobile capability refinement', () => {
  test.use({ hasTouch: true });
  for (const width of [320, 390]) for (const theme of ['light', 'dark'] as const) {
    test(`${width}px ${theme}: all capabilities discoverable with touch, keyboard and larger text`, async ({ page, baseURL }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.goto('/');
      await page.evaluate(() => document.fonts.ready);
      const selector = page.getByRole('group', { name: 'Explore planned capabilities' });
      const buttons = selector.getByRole('button');
      await expect(buttons).toHaveCount(6);
      // All six complete cards must be reachable by vertical page scrolling, without swiping.
      const geometry = await selector.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        return {
          fits: el.scrollWidth <= el.clientWidth,
          cards: [...el.querySelectorAll('button')].map((button) => {
            const b = button.getBoundingClientRect();
            return { left: b.left, right: b.right, width: b.width, height: b.height, inside: b.left >= rect.left && b.right <= rect.right };
          }),
        };
      });
      expect(geometry.fits).toBe(true);
      for (const card of geometry.cards) {
        expect(card.inside).toBe(true);
        expect(card.height).toBeGreaterThanOrEqual(44);
        expect(card.width).toBeGreaterThanOrEqual(44);
      }
      for (const item of capabilities) {
        const button = selector.getByRole('button', { name: new RegExp(`^${item.title}`) });
        await button.tap();
        await expect(button).toHaveAttribute('aria-pressed', 'true');
        await expect(selector.locator('[aria-pressed="true"]')).toHaveCount(1);
        await expect(page.locator('#landing-module-scene h3')).toHaveText(item.title);
        await expect(page.locator('#landing-module-scene ul li')).toHaveText([...item.labels]);
      }
      await buttons.first().focus();
      for (let index = 0; index < capabilities.length; index++) {
        await expect(buttons.nth(index)).toBeFocused();
        await page.keyboard.press('Space');
        await expect(buttons.nth(index)).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('#landing-module-scene h3')).toHaveText(capabilities[index].title);
        if (index < capabilities.length - 1) await page.keyboard.press('Tab');
      }
      const type = await page.locator(readingText).evaluateAll((elements) => elements.map((el) => ({ size: parseFloat(getComputedStyle(el).fontSize), lineHeight: parseFloat(getComputedStyle(el).lineHeight) })));
      for (const text of type) {
        expect(text.size).toBeGreaterThanOrEqual(14);
        expect(text.lineHeight).toBeGreaterThanOrEqual(text.size * 1.49);
      }
      // Preserve the measured source palette: muted text against its lightest/darkest used surfaces.
      const contrast = await page.locator('.cc-landing-page').evaluate((el) => {
        const style = getComputedStyle(el);
        const luminance = (hex: string) => {
          const c = hex.trim().slice(1).match(/../g)!.slice(0, 3).map((v) => parseInt(v, 16) / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
          return c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
        };
        const fg = luminance(style.getPropertyValue('--cc-landing-muted'));
        return ['--cc-landing-surface', '--cc-landing-surface-2', '--cc-landing-tint', '--cc-landing-canvas', '--cc-landing-canvas-alt'].map((name) => {
          const bg = luminance(style.getPropertyValue(name));
          return (Math.max(bg, fg) + .05) / (Math.min(bg, fg) + .05);
        });
      });
      for (const ratio of contrast) expect(ratio).toBeGreaterThanOrEqual(4.5);
      await mkdir(evidence, { recursive: true });
      const prefix = `${evidence}/${baseURL?.includes(':4174') ? 'preview' : 'dev'}-mobile-${width}-${theme}`;
      // Capture a neutral initial selection, with no keyboard-focus ring, for owner comparison.
      await buttons.first().tap();
      await page.getByRole('heading', { level: 1 }).tap();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `${prefix}-full.png`, fullPage: true, animations: 'disabled' });
      await page.locator('#product').screenshot({ path: `${prefix}-capabilities.png`, animations: 'disabled', style: '.cc-public-header, .cc-skip-link { visibility: hidden !important; }' });
      await writeFile(`${prefix}-measurements.json`, JSON.stringify({ geometry, type, contrast }, null, 2));
      // Text-only 200% simulation in the reviewed content areas; no clipping or loss of controls.
      // This is distinct from the existing 720px zoom-equivalent reflow regression.
      await page.locator(`${readingText}, .cc-showcase-option strong`).evaluateAll((elements) => {
        for (const el of elements) {
          const element = el as HTMLElement;
          const size = parseFloat(getComputedStyle(element).fontSize);
          element.style.fontSize = `${size * 2}px`;
          element.style.lineHeight = '1.6';
        }
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      for (const item of capabilities) {
        const button = selector.getByRole('button', { name: new RegExp(`^${item.title}`) });
        await button.tap();
        await expect(page.locator('#landing-module-scene h3')).toHaveText(item.title);
        const fits = await button.evaluate((el) => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight);
        expect(fits).toBe(true);
      }
      await page.screenshot({ path: `${prefix}-larger-text-full.png`, fullPage: true, animations: 'disabled' });
    });
  }
});

for (const theme of ['light', 'dark'] as const) {
  test(`desktop ${theme} visual regression evidence`, async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);
    await mkdir(evidence, { recursive: true });
    const prefix = `${evidence}/${baseURL?.includes(':4174') ? 'preview' : 'dev'}-desktop-${theme}`;
    await page.screenshot({ path: `${prefix}-viewport.png`, animations: 'disabled' });
    await page.screenshot({ path: `${prefix}-full.png`, fullPage: true, animations: 'disabled' });
    await page.locator('#product').screenshot({ path: `${prefix}-capabilities.png`, animations: 'disabled' });
    await expect(page.getByRole('group', { name: 'Explore planned capabilities' }).getByRole('button')).toHaveCount(6);
  });
}
