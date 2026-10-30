import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

const evidence = 'playwright-report/c3b';
const requests = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const calls: string[] = []; requests.set(page, calls);
  page.on('request', request => { if (['fetch', 'xhr'].includes(request.resourceType())) calls.push(request.url()); });
});
test.afterEach(({ page }) => { expect(requests.get(page)).toEqual([]); });

for (const theme of ['light', 'dark'] as const) for (const width of [1440, 1280, 768, 390, 320]) {
  test(`medicine explorer ${width} ${theme}: search, selection, focus and source presentation`, async ({ page, baseURL }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : width === 1280 ? 800 : width === 768 ? 1024 : 844 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.goto('/medicine-insights'); await page.evaluate(() => document.fonts.ready);
    const prefix = `${evidence}/${baseURL?.includes(':4174') ? 'preview' : 'dev'}-${width}-${theme}`;
    await mkdir(evidence, { recursive: true });
    const capture = async (state: string) => {
      await page.evaluate(() => scrollTo(0, 0)); await page.mouse.move(0, 0);
      await page.screenshot({ path: `${prefix}-${state}.png`, fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    };
    const search = page.getByRole('searchbox', { name: 'Search example medicines' });
    await expect(page.getByText('Demo Mode', { exact: true })).toHaveCount(1);
    await expect(page.locator('.md-insights-record')).toHaveCount(4);
    if (width >= 1024) await expect(page.getByRole('button', { name: 'Close details', includeHidden: true })).toBeHidden();
    await capture('initial');
    const measurements = await page.evaluate(() => Object.fromEntries(['.md-insights-page', '.md-insights-search', '.md-insights-search input', '.md-insights-workspace', '.md-insights-record', '.md-insights-record strong', '.md-insights-record-icon', '.md-insights-details', '.md-insights-identity h2', '.md-insights-information > section', '.md-insights-facts > div'].map(selector => {
      const node = document.querySelector(selector)!, rect = node.getBoundingClientRect(), css = getComputedStyle(node);
      return [selector, { x: rect.x, y: rect.y, width: rect.width, height: rect.height, font: css.fontFamily, size: css.fontSize, weight: css.fontWeight, lineHeight: css.lineHeight, radius: css.borderRadius, padding: css.padding, gap: css.gap, columns: css.gridTemplateColumns, display: css.display }];
    })));
    await writeFile(`${prefix}-measurements.json`, JSON.stringify(measurements, null, 2));
    await search.fill('  Aster  ');
    await expect(search).toHaveValue('  Aster  '); await expect(search).toBeFocused();
    await expect(page.locator('.md-insights-record')).toHaveCount(1);
    await expect(page.locator('.md-insights-count')).toContainText('1 example entry');
    await capture('search-results');
    await search.fill('no-match-synthetic');
    await expect(page.getByRole('heading', { name: 'No examples found' })).toBeVisible();
    await expect(page.locator('.md-insights-count')).toHaveAttribute('role', 'status');
    await expect(page.locator('.md-insights-count')).toContainText('0 example entries');
    await capture('no-results');
    await page.getByRole('button', { name: 'Clear search' }).click();
    await expect(search).toBeFocused(); await expect(search).toHaveValue('');
    await expect(page.locator('.md-insights-record')).toHaveCount(4);
    await expect(page.getByRole('status').filter({ hasText: 'Search cleared.' })).toBeAttached();
    const dune = page.getByRole('button', { name: /Dune/ });
    await dune.focus(); await page.keyboard.press('Enter');
    await expect(dune).toHaveAttribute('aria-pressed', 'true');
    const title = page.getByRole('heading', { name: 'Dune — Sample 04', exact: true });
    await expect(title).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: /Dune.*selected/ })).toBeAttached();
    await expect(page.getByText('Not available in this demo', { exact: true })).toBeVisible();
    await expect(page.getByText('MD / 004', { exact: true })).toBeVisible();
    if (width < 1024) {
      await expect(title).toBeFocused();
      const top = await title.evaluate(e => e.getBoundingClientRect().top);
      expect(top).toBeGreaterThanOrEqual(75); expect(top).toBeLessThan(300);
      expect(await page.getByRole('button', { name: 'Back to results' }).evaluate(e => e.getBoundingClientRect().top)).toBeGreaterThanOrEqual(75);
      await page.screenshot({ path: `${prefix}-selected-viewport.png` });
    }
    await capture('selected-details');
    const compare = page.locator('.md-insights-details').getByRole('link', { name: 'Compare Medicines' });
    await compare.focus(); await expect(compare).toBeVisible();
    const clearance = await compare.evaluate(e => {
      const nav = document.querySelector('.cc-mobile-nav'); const edge = nav && getComputedStyle(nav).display !== 'none' ? nav.getBoundingClientRect().top : innerHeight;
      return edge - e.getBoundingClientRect().bottom;
    });
    expect(clearance).toBeGreaterThanOrEqual(0);
    await page.screenshot({ path: `${prefix}-compare-action.png` });
    if (width < 1024) {
      await page.getByRole('button', { name: 'Close details' }).click();
      await expect(dune).toBeFocused();
      await expect(title).toBeHidden();
      await page.keyboard.press('Space'); await expect(title).toBeFocused();
      await page.getByRole('button', { name: 'Back to results' }).click(); await expect(dune).toBeFocused();
      await dune.click();
    }
    await compare.click();
    await expect(page).toHaveURL(/\/compare-medicines$/);
    await expect(page.getByLabel('First medicine')).toHaveValue('aster');
    await expect(page.getByLabel('Second medicine')).toHaveValue('birch');
    await page.goBack(); await expect(page.getByRole('heading', { level: 1 })).toHaveText('Medicine Insights');
  });
}

test('insights uses available container width, retains search selection and stays usable with larger text', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto('/medicine-insights');
  await page.locator('.md-insights-page').evaluate(node => { (node as HTMLElement).style.maxWidth = '850px'; });
  await expect(page.locator('.md-insights-details')).toBeHidden();
  await page.getByRole('button', { name: /Birch/ }).click();
  await expect(page.getByRole('heading', { name: 'Birch — Sample 02', exact: true })).toBeFocused();
  const search = page.getByLabel('Search example medicines');
  await search.fill('Aster'); await expect(search).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Birch — Sample 02', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to results' }).click();
  await expect(search).toBeFocused(); // Origin is filtered out: safe fallback.
  await page.getByRole('button', { name: 'Clear search' }).click();
  await page.locator('.md-insights-page').evaluate(node => { (node as HTMLElement).style.maxWidth = ''; });
  await page.setViewportSize({ width: 1440, height: 900 });
  const compare = page.locator('.md-insights-details').getByRole('link', { name: 'Compare Medicines' });
  await compare.focus();
  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(compare).toBeFocused(); await expect(compare).toBeVisible();
  await page.getByRole('button', { name: 'Close details' }).focus();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole('heading', { name: 'Birch — Sample 02', exact: true })).toBeFocused();
  await page.setViewportSize({ width: 768, height: 1024 });
  expect(await page.locator('.md-insights-workspace').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length)).toBe(1);
  await page.getByRole('button', { name: /Cedar/ }).click();
  await page.getByRole('button', { name: 'Clear selection' }).click();
  await expect(page.getByRole('button', { name: /Cedar/ })).toBeFocused();
  await expect(page.getByRole('button', { pressed: true })).toHaveCount(0);
  for (const width of [960, 1040, 320]) {
    await page.setViewportSize({ width, height: 844 }); await page.locator('.md-insights-page').evaluate(node => { (node as HTMLElement).style.maxWidth = ''; });
    await search.fill('  ingredient   A  '); await expect(page.locator('.md-insights-record')).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.evaluate(() => { const sizes = [...document.querySelectorAll<HTMLElement>('.md-insights-page *')].map(node => [node, parseFloat(getComputedStyle(node).fontSize)] as const); sizes.forEach(([node, size]) => { node.style.fontSize = `${size * 2}px`; }); });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const theme of ['light', 'dark'] as const) test(`insights ${theme}: selected, unselected, hover and keyboard text contrast`, async ({ page }) => {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' }); await page.goto('/medicine-insights');
  const values = [];
  for (const state of ['selected', 'unselected', 'hover', 'focus']) {
    const row = page.locator('.md-insights-record').nth(state === 'selected' ? 0 : 1);
    if (state === 'hover') await row.hover(); if (state === 'focus') await row.focus();
    const contrasts = await row.evaluate(element => {
      const rgba = (value: string) => { const n = value.match(/[\d.]+/g)!.map(Number); return [...n.slice(0, 3), n.length === 4 ? n[3]! : 1]; };
      const over = (a: number[], b: number[]) => { const alpha = a[3]! + b[3]! * (1 - a[3]!); return [0, 1, 2].map(i => (a[i]! * a[3]! + b[i]! * b[3]! * (1 - a[3]!)) / alpha).concat(alpha); };
      const bg = (node: Element | null): number[] => node ? over(rgba(getComputedStyle(node).backgroundColor), bg(node.parentElement)) : [255, 255, 255, 1];
      const lum = (c: number[]) => c.slice(0, 3).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i]!, 0);
      return [...element.querySelectorAll('.md-insights-record-copy > *')].map(node => { const background = bg(node), a = lum(background), b = lum(over(rgba(getComputedStyle(node).color), background)); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); });
    });
    contrasts.forEach(ratio => expect(ratio).toBeGreaterThanOrEqual(4.5)); values.push({ state, contrasts });
  }
  await mkdir(evidence, { recursive: true }); await writeFile(`${evidence}/contrast-${theme}.json`, JSON.stringify(values, null, 2));
});
