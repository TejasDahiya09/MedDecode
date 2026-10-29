import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const routes = ['sign-in', 'sign-up', 'forgot-password', 'reset-password'];
const folder = 'playwright-report/b4a3';
for (const viewport of [
  { name: 'desktop', width: 1440, height: 900, heading: 36 },
  { name: 'tablet', width: 768, height: 1024, heading: 32 },
  { name: 'mobile', width: 390, height: 844, heading: 39 },
  { name: 'narrow', width: 320, height: 568, heading: 32 },
]) for (const theme of ['light', 'dark'] as const) {
  test(`shared auth headings ${viewport.name} ${theme}: source typography, wrapping and separation`, async ({ page, baseURL }) => {
    const mode = baseURL?.includes(':4174') ? 'preview' : 'dev';
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    const rows = [];
    const typography = [];
    for (const route of routes) {
      await page.goto('/' + route);
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.fonts.check('730 36px "Manrope Variable"'))).toBe(true);
      await page.mouse.move(0, 0);
      const row = await page.locator('#auth-page-title').evaluate(el => {
        const s = getComputedStyle(el), r = el.getBoundingClientRect();
        const card = el.closest('.cc-login-form-wrap')!;
        const intro = card.querySelector('.cc-login-intro')!;
        const d = getComputedStyle(intro), description = intro.getBoundingClientRect();
        return {
          family: s.fontFamily, size: s.fontSize, weight: s.fontWeight,
          lineHeight: s.lineHeight, letterSpacing: s.letterSpacing, margin: s.margin,
          maxWidth: s.maxWidth, whiteSpace: s.whiteSpace, textWrap: s.textWrap,
          width: r.width, lines: Math.round(r.height / parseFloat(s.lineHeight)),
          cardHeight: card.getBoundingClientRect().height,
          description: { family: d.fontFamily, size: d.fontSize, lineHeight: d.lineHeight, margin: d.margin },
          fits: el.scrollWidth <= el.clientWidth && r.x >= 0 && r.right <= innerWidth,
          separated: r.bottom <= description.top && description.bottom <= card.querySelector('.cc-login-form-body')!.getBoundingClientRect().top,
        };
      });
      const style = {
        family: row.family, size: row.size, weight: row.weight, lineHeight: row.lineHeight,
        letterSpacing: row.letterSpacing, margin: row.margin, maxWidth: row.maxWidth,
        whiteSpace: row.whiteSpace, textWrap: row.textWrap, description: row.description,
      };
      expect(row.fits).toBe(true); expect(row.separated).toBe(true);
      expect(row.family).toContain('Manrope Variable'); expect(row.weight).toBe('730');
      expect(parseFloat(row.size)).toBe(viewport.heading);
      expect(parseFloat(row.lineHeight)).toBe(viewport.heading);
      expect(parseFloat(row.letterSpacing)).toBeCloseTo(-.055 * viewport.heading, 4);
      expect(row.margin).toBe('6.4px 0px 0px'); expect(row.maxWidth).toBe('none');
      expect(row.whiteSpace).toBe('normal'); expect(row.textWrap).toBe('balance');
      expect(parseFloat(row.description.lineHeight)).toBeCloseTo(parseFloat(row.description.size) * 1.5, 3);
      typography.push(style); rows.push({ route, ...row });
      if (viewport.name === 'desktop' || (viewport.name === 'mobile' && ['sign-up', 'forgot-password'].includes(route))) {
        await mkdir(folder, { recursive: true });
        await page.screenshot({ path: `${folder}/${mode}-${route}-${viewport.name}-${theme}.png`, fullPage: true });
      }
      if (viewport.name === 'narrow') {
        await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
        const heading = page.locator('#auth-page-title');
        await expect(heading).toHaveCSS('font-size', '64px');
        expect(await heading.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
        const title = await heading.boundingBox(); const intro = await page.locator('.cc-login-intro').boundingBox();
        expect(title!.y + title!.height).toBeLessThanOrEqual(intro!.y);
        await page.getByRole('form').locator('button[type=submit]').click();
        await expect(page.locator('[aria-invalid=true]').first()).toBeFocused();
      }
    }
    for (const style of typography) expect(style).toEqual(typography[0]);
    await mkdir(folder, { recursive: true });
    await writeFile(`${folder}/${mode}-headings-${viewport.name}-${theme}.json`, JSON.stringify(rows, null, 2));
  });
}
