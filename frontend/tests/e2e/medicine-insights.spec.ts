import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
const out = 'playwright-report/c3b1';
const calls = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => { const requests: string[] = []; calls.set(page, requests); page.on('request', r => { if (['fetch', 'xhr'].includes(r.resourceType())) requests.push(r.url()); }); });
test.afterEach(({ page }) => { expect(calls.get(page)).toEqual([]); });

for (const theme of ['light', 'dark'] as const) for (const width of [1440, 1280, 768, 390, 320]) {
  test(`medicine marketplace ${width} ${theme}: discovery, filters, dialog, compare and evidence`, async ({ page, baseURL }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : width === 1280 ? 800 : width === 768 ? 1024 : 844 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' }); await page.goto('/medicine-insights'); await page.evaluate(() => document.fonts.ready);
    await mkdir(out, { recursive: true }); const prefix = `${out}/${baseURL?.includes(':4174') ? 'preview' : 'dev'}-${width}-${theme}`;
    const capture = async (state: string) => { await page.evaluate(() => scrollTo(0, 0)); await page.mouse.move(0, 0); await page.screenshot({ path: `${prefix}-${state}.png`, fullPage: true }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); };
    await expect(page.getByText('Demo Mode', { exact: true })).toBeVisible(); await expect(page.locator('.cc-market-product')).toHaveCount(12);
    await expect(page.getByRole('status').filter({ hasText: '16 fictional references' })).toBeVisible();
    await capture('initial'); await page.screenshot({ path: `${prefix}-viewport.png` });
    const metrics = await page.evaluate(() => Object.fromEntries(['.md-catalog', '.cc-market-hero', '.cc-market-layout', '.cc-market-filter-rail', '.cc-market-search', '.cc-market-categories', '.cc-market-grid', '.cc-market-product', '.cc-market-product h3'].map(selector => { const node = document.querySelector(selector)!, r = node.getBoundingClientRect(), s = getComputedStyle(node); return [selector, { x: r.x, y: r.y, width: r.width, height: r.height, size: s.fontSize, font: s.fontFamily, radius: s.borderRadius, padding: s.padding, gap: s.gap, columns: s.gridTemplateColumns, display: s.display }]; })));
    await writeFile(`${prefix}-measurements.json`, JSON.stringify(metrics, null, 2));
    if (width === 1440) { expect(metrics['.cc-market-hero'].height).toBeLessThan(280); expect(metrics['.cc-market-hero'].height).toBeGreaterThanOrEqual(220); expect(metrics['.cc-market-grid'].y).toBeLessThan(900); }
    await page.getByRole('button', { name: 'Next', exact: true }).click(); await expect(page.locator('.cc-market-product')).toHaveCount(4); await page.getByRole('button', { name: 'Previous', exact: true }).click();
    const search = page.getByLabel('Search example medicines'); await search.fill('  Aster  '); await expect(search).toHaveValue('  Aster  '); await expect(search).toBeFocused(); await expect(page.locator('.cc-market-product')).toHaveCount(1); await capture('search');
    await search.fill('no-match-synthetic'); await expect(page.getByRole('heading', { name: 'No examples found' })).toBeVisible(); await capture('no-results');
    await page.getByRole('button', { name: 'Clear search', exact: true }).click(); await expect(search).toBeFocused(); await expect(page.locator('.cc-market-product')).toHaveCount(12);
    const categories = page.getByRole('group', { name: 'Categories', exact: true }); await categories.getByRole('button', { name: 'Capsules', exact: true }).click(); await expect(categories.getByRole('button', { name: 'Capsules', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.cc-market-product')).toHaveCount(3); await categories.getByRole('button', { name: 'All', exact: true }).click();
    await categories.getByRole('button', { name: 'Tablets', exact: true }).focus(); await page.keyboard.press('End'); await expect(categories.getByRole('button', { name: 'Daily care', exact: true })).toBeFocused(); await page.keyboard.press('Home'); await expect(categories.getByRole('button', { name: 'All', exact: true })).toBeFocused();
    let filters = page.getByRole('complementary', { name: 'Medicine catalog filters' });
    if (width < 1100) { await page.getByRole('button', { name: 'Filters', exact: true }).click(); filters = page.getByRole('dialog'); await expect(filters.getByRole('button', { name: 'Close dialog' })).toBeFocused(); }
    await filters.getByRole('combobox', { name: 'Formulation', exact: true }).selectOption('Capsule');
    await expect(page.locator('.cc-market-product')).toHaveCount(12); // Draft does not apply early.
    await filters.getByRole('button', { name: 'Apply filters' }).click(); await expect(page.locator('.cc-market-product')).toHaveCount(3);
    if (width < 1100) await expect(page.locator('.cc-market-filter-trigger')).toBeFocused();
    else await expect(page.locator('.cc-market-results')).toBeFocused();
    await capture('filtered');
    await page.getByRole('button', { name: 'Clear all filters', exact: true }).click(); await expect(search).toBeFocused();
    await page.getByRole('combobox', { name: 'Sort medicine examples' }).selectOption('name_desc'); await expect(page.locator('.cc-market-product h3').first()).toContainText('Pine');
    await page.getByRole('combobox', { name: 'Sort medicine examples' }).selectOption('category'); await page.getByRole('combobox', { name: 'Sort medicine examples' }).selectOption('formulation'); await page.getByRole('combobox', { name: 'Sort medicine examples' }).selectOption('name_asc');
    await search.fill('Dune'); const opener = page.getByRole('button', { name: /View details for Dune/ }); await opener.focus(); await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog'); await expect(dialog).toHaveAccessibleName('Dune — Sample 04'); await expect(dialog.getByRole('button', { name: 'Close dialog' })).toBeFocused(); await expect(dialog.getByText('Not available in this demo', { exact: true })).toBeVisible();
    await page.keyboard.press('Shift+Tab'); await expect(dialog.getByRole('button', { name: 'Back to catalog' })).toBeFocused(); await page.keyboard.press('Tab'); await expect(dialog.getByRole('button', { name: 'Close dialog' })).toBeFocused();
    await page.screenshot({ path: `${prefix}-details.png` });
    const compare = dialog.getByRole('link', { name: 'Compare Medicines', exact: true }); await compare.focus(); await expect(compare).toBeVisible(); await page.screenshot({ path: `${prefix}-compare.png` });
    await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
    await page.keyboard.press('Space'); await expect(page.getByRole('dialog')).toBeVisible(); await page.getByRole('dialog').getByRole('link', { name: 'Compare Medicines', exact: true }).click();
    await expect(page).toHaveURL(/\/compare-medicines\?a=dune$/); await expect(page.getByRole('article', { name: /Medicine A: Dune/ })).toBeVisible(); await expect(page.getByRole('article', { name: /Medicine B: no selection/ })).toBeVisible();
    await page.goBack(); await expect(page.getByRole('heading', { level: 1 })).toHaveText('Medicine Insights'); await expect(page.locator('.cc-market-product')).toHaveCount(12);
  });
}

test('catalog narrow enlarged text and filter-dialog dismissal preserve keyboard access', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 }); await page.goto('/medicine-insights');
  const trigger = page.getByRole('button', { name: 'Filters', exact: true }); await trigger.click(); await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
  await page.getByLabel('Search example medicines').fill('Cedar'); await page.getByRole('button', { name: /View details for Cedar/ }).click();
  const dialog = page.getByRole('dialog'); await dialog.evaluate(node => { const sizes = [...node.querySelectorAll<HTMLElement>('*')].map(e => [e, parseFloat(getComputedStyle(e).fontSize)] as const); sizes.forEach(([e, size]) => { e.style.fontSize = `${size * 2}px`; }); });
  expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true); await dialog.getByRole('button', { name: 'Back to catalog' }).click(); await expect(page.getByRole('button', { name: /View details for Cedar/ })).toBeFocused();
  await page.evaluate(() => { const nodes = [...document.querySelectorAll<HTMLElement>('.md-catalog *')].map(node => [node, parseFloat(getComputedStyle(node).fontSize)] as const); nodes.forEach(([node, size]) => { node.style.fontSize = `${size * 2}px`; }); });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const theme of ['light', 'dark'] as const) test(`catalog ${theme} text contrast on cards, categories and hover`, async ({ page }) => {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' }); await page.goto('/medicine-insights'); await page.evaluate(() => document.fonts.ready);
  const measure = () => page.evaluate(() => {
    const rgba = (value: string) => { const n = value.match(/[\d.]+/g)!.map(Number); return [...n.slice(0, 3), n.length === 4 ? n[3]! : 1]; };
    const over = (a: number[], b: number[]) => { const alpha = a[3]! + b[3]! * (1 - a[3]!); return [0, 1, 2].map(i => (a[i]! * a[3]! + b[i]! * b[3]! * (1 - a[3]!)) / alpha).concat(alpha); };
    const bg = (node: Element | null): number[] => node ? over(rgba(getComputedStyle(node).backgroundColor), bg(node.parentElement)) : [255, 255, 255, 1];
    const lum = (c: number[]) => c.slice(0, 3).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i]!, 0);
    return [...document.querySelectorAll('.cc-market-product h3,.md-catalog-ingredient,.cc-market-product-condition,.md-catalog-reference-status,.cc-market-product-footer>span,.cc-market-category-label')].map(node => {
      const background = bg(node), a = lum(background), b = lum(over(rgba(getComputedStyle(node).color), background)); return { text: node.textContent, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
    });
  });
  const normal = await measure(); await page.locator('.cc-market-product').first().hover(); const hover = await measure();
  [...normal, ...hover].forEach(item => expect(item.ratio).toBeGreaterThanOrEqual(4.5));
  await mkdir(out, { recursive: true }); await writeFile(`${out}/contrast-${theme}.json`, JSON.stringify({ normal, hover }, null, 2));
});
