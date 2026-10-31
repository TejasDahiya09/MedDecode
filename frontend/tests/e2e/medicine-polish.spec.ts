import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';

const out = 'playwright-report/c3b2';
async function viewportBounds(dialog: Locator) {
  return dialog.evaluate(node => {
    const r = node.getBoundingClientRect(), v = window.visualViewport;
    const left = v?.offsetLeft ?? 0, top = v?.offsetTop ?? 0;
    return { fits: r.left >= left - 1 && r.top >= top - 1 && r.right <= left + (v?.width ?? innerWidth) + 1 && r.bottom <= top + (v?.height ?? innerHeight) + 1, width: r.width, height: r.height };
  });
}
async function unobscured(control: Locator) {
  return control.evaluate(node => {
    const r = node.getBoundingClientRect();
    return !!r.width && !!r.height && !!document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('.md-catalog-dialog');
  });
}
function serviceGuard(page: Page) {
  const requests: string[] = [], errors: string[] = [];
  page.on('request', r => { if (['fetch', 'xhr'].includes(r.resourceType())) requests.push(r.url()); });
  page.on('pageerror', e => errors.push(e.message));
  return () => { expect(requests).toEqual([]); expect(errors).toEqual([]); };
}

for (const theme of ['light', 'dark'] as const) for (const width of [1440, 768, 390, 320]) {
  test(`catalog polish ${width} ${theme}: order, readable cards, modal, skip link and preservation`, async ({ page, baseURL }) => {
    const verify = serviceGuard(page);
    await page.setViewportSize({ width, height: width === 1440 ? 900 : width === 768 ? 1024 : 844 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.goto('/medicine-insights'); await page.evaluate(() => document.fonts.ready);
    await mkdir(out, { recursive: true });
    const mode = baseURL?.includes(':4174') ? 'preview' : 'dev', prefix = `${out}/${mode}-${width}-${theme}`;
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `${prefix}-initial.png`, fullPage: true });
    await page.screenshot({ path: `${prefix}-viewport.png` });
    const layout = await page.evaluate(() => {
      const selectors = ['.cc-market-header', '.cc-market-hero', '.cc-market-categories', '.cc-market-toolbar', '.cc-market-results'];
      return selectors.map(selector => { const r = document.querySelector(selector)!.getBoundingClientRect(); return { selector, top: r.top, bottom: r.bottom }; });
    });
    if (width < 700) layout.slice(1).forEach((item, i) => expect(item.top).toBeGreaterThanOrEqual(layout[i]!.bottom - 1));
    const metrics = await page.evaluate(() => Object.fromEntries(['.md-catalog', '.cc-market-hero', '.cc-market-layout', '.cc-market-filter-rail', '.cc-market-search', '.cc-market-categories', '.cc-market-grid', '.cc-market-product', '.cc-market-product h3'].map(selector => { const n = document.querySelector(selector)!, r = n.getBoundingClientRect(), s = getComputedStyle(n); return [selector, { x: r.x, y: r.y, width: r.width, height: r.height, size: s.fontSize, font: s.fontFamily, radius: s.borderRadius, padding: s.padding, gap: s.gap, columns: s.gridTemplateColumns, display: s.display }]; })));
    if (width === 1440) {
      const baseline = JSON.parse(await readFile(`${out}/catalog-before/dev-${width}-${theme}-measurements.json`, 'utf8')) as typeof metrics;
      expect(metrics).toEqual(baseline);
      expect(metrics['.cc-market-grid'].columns.split(' ')).toHaveLength(4);
    }
    await writeFile(`${prefix}-measurements.json`, JSON.stringify({ layout, metrics }, null, 2));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    const skip = page.locator('.cc-skip-link');
    expect(await skip.evaluate(node => node.getBoundingClientRect().bottom)).toBeLessThanOrEqual(0);
    await page.keyboard.press('Tab'); await expect(skip).toBeFocused();
    await expect.poll(() => skip.evaluate(node => node.getBoundingClientRect().top)).toBeGreaterThanOrEqual(0);
    await page.screenshot({ path: `${prefix}-skip-keyboard.png` });
    await page.keyboard.press('Enter'); await expect(page.locator('#main-content')).toBeFocused();
    await expect.poll(() => skip.evaluate(node => node.getBoundingClientRect().bottom)).toBeLessThanOrEqual(0);

    const cards = page.locator('.cc-market-product'); await expect(cards).toHaveCount(12);
    if (width < 700) {
      const readability = await cards.evaluateAll(nodes => nodes.map(node => {
        const name = node.querySelector('h3')!, ingredient = node.querySelector('.md-catalog-ingredient')!, form = node.querySelector('.cc-market-product-condition')!, view = node.querySelector('.md-catalog-view')!, compare = node.querySelector('.cc-market-share')!;
        const names = [name, ingredient, form]; const v = view.getBoundingClientRect(), c = compare.getBoundingClientRect();
        return { sizes: names.map(n => parseFloat(getComputedStyle(n).fontSize)), lineHeights: names.map(n => parseFloat(getComputedStyle(n).lineHeight)), unclipped: names.every(n => n.scrollHeight <= n.clientHeight + 1 && n.scrollWidth <= n.clientWidth + 1), viewHeight: v.height, compareHeight: c.height, compareWidth: c.width, separate: c.top >= v.bottom, nameWeight: +getComputedStyle(name).fontWeight };
      }));
      readability.forEach(card => { card.sizes.forEach(size => expect(size).toBeGreaterThanOrEqual(14)); card.lineHeights.forEach(line => expect(line).toBeGreaterThanOrEqual(20)); expect(card.unclipped).toBe(true); expect(card.viewHeight).toBeGreaterThanOrEqual(44); expect(card.compareHeight).toBeGreaterThanOrEqual(44); expect(card.compareWidth).toBeGreaterThanOrEqual(44); expect(card.separate).toBe(true); expect(card.nameWeight).toBeGreaterThanOrEqual(700); });
      expect(metrics['.cc-market-grid'].columns.split(' ')).toHaveLength(width === 320 ? 1 : 2);
      await writeFile(`${prefix}-readability.json`, JSON.stringify(readability, null, 2));
    }
    await cards.first().evaluate(node => scrollTo({ top: node.getBoundingClientRect().top + scrollY - 90, behavior: 'instant' }));
    await page.mouse.move(0, 0); await page.screenshot({ path: `${prefix}-cards.png` });
    const opener = page.getByRole('button', { name: /View details for Aster/ });
    await opener.focus(); const beforeScroll = await page.evaluate(() => scrollY); await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog'), close = dialog.getByRole('button', { name: 'Close dialog' });
    const content = dialog.locator('.md-catalog-dialog-content');
    await expect(dialog).toHaveAccessibleName('Aster — Sample 01'); await expect(close).toBeFocused();
    expect((await viewportBounds(dialog)).fits).toBe(true); expect(await unobscured(close)).toBe(true);
    await expect(skip).toHaveCSS('visibility', 'hidden');
    expect(await page.evaluate(() => document.body.style.position)).toBe('fixed');
    const lock = await page.evaluate(() => ({ top: document.body.style.top, scroll: scrollY }));
    await page.mouse.move(5, 5); await page.mouse.wheel(0, 400);
    expect(await page.evaluate(() => ({ top: document.body.style.top, scroll: scrollY }))).toEqual(lock);
    await page.screenshot({ path: `${prefix}-dialog-top.png` });
    const closeTop = await close.boundingBox();
    await content.evaluate(node => { node.scrollTop = node.scrollHeight; });
    await expect.poll(() => content.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
    expect(await close.boundingBox()).toEqual(closeTop);
    const compare = dialog.getByRole('link', { name: 'Compare Medicines', exact: true }), back = dialog.getByRole('button', { name: 'Back to catalog' });
    expect(await unobscured(compare)).toBe(true); expect(await unobscured(back)).toBe(true); expect(await unobscured(close)).toBe(true);
    await page.screenshot({ path: `${prefix}-dialog-bottom.png` });
    await page.keyboard.press('Shift+Tab'); await expect(back).toBeFocused(); await page.keyboard.press('Tab'); await expect(close).toBeFocused();
    await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
    expect(await page.evaluate(() => scrollY)).toBeCloseTo(beforeScroll, 0);
    expect(await page.evaluate(() => document.body.style.position)).not.toBe('fixed');
    await page.keyboard.press('Space'); await expect(dialog).toBeVisible();
    await dialog.locator('.md-demo-dialog-head h2').click(); await expect(dialog).toBeVisible();
    const bounds = await dialog.boundingBox(); await page.mouse.click(5, Math.max(1, bounds!.y / 2));
    await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
    await page.keyboard.press('Enter'); await close.click(); await expect(opener).toBeFocused();

    if (width < 1100) {
      const filterTrigger = page.locator('.cc-market-filter-trigger'); await filterTrigger.click();
      await expect(dialog).toHaveAccessibleName('Refine your medicine examples');
      expect((await viewportBounds(dialog)).fits).toBe(true);
      await page.screenshot({ path: `${prefix}-filters.png` });
      await page.keyboard.press('Escape'); await expect(filterTrigger).toBeFocused();
    }
    verify();
  });
}

for (const theme of ['light', 'dark'] as const) for (const width of [390, 320]) {
  test(`catalog visual viewport ${width} ${theme}: reduced height and pinch remain bounded`, async ({ page, baseURL }) => {
    const verify = serviceGuard(page);
    await page.setViewportSize({ width, height: 844 }); await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' }); await page.goto('/medicine-insights');
    const opener = page.getByRole('button', { name: /View details for Cedar/ }); await opener.click();
    const dialog = page.getByRole('dialog'), close = dialog.getByRole('button', { name: 'Close dialog' });
    await page.setViewportSize({ width, height: 500 });
    await expect.poll(async () => (await viewportBounds(dialog)).fits).toBe(true); expect(await unobscured(close)).toBe(true);
    const content = dialog.locator('.md-catalog-dialog-content'); await content.evaluate(node => { node.scrollTop = node.scrollHeight; });
    expect(await unobscured(dialog.getByRole('link', { name: 'Compare Medicines' }))).toBe(true);
    const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1.5 });
    await expect.poll(() => page.evaluate(() => window.visualViewport!.width < innerWidth)).toBe(true);
    await expect.poll(async () => (await viewportBounds(dialog)).fits).toBe(true);
    expect(await unobscured(close)).toBe(true);
    expect(await content.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    await mkdir(out, { recursive: true }); await page.screenshot({ path: `${out}/${baseURL?.includes(':4174') ? 'preview' : 'dev'}-${width}-${theme}-visual-viewport.png` });
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 }); await cdp.detach();
    await page.keyboard.press('Escape'); await expect(opener).toBeFocused(); verify();
  });
}
