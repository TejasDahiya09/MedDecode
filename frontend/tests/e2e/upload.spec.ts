import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

const folder = 'playwright-report/c2b';
const fixture = { name: 'synthetic-prescription.pdf', mimeType: 'application/pdf', buffer: Buffer.from('Fictional demonstration only') };
async function guard(page: Page) {
  const calls: string[] = [], errors: string[] = [];
  page.on('request', request => { if (['fetch', 'xhr'].includes(request.resourceType())) calls.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const attempts: string[] = []; Object.assign(window, { uploadReadAttempts: attempts });
    for (const name of ['text', 'arrayBuffer', 'stream', 'bytes'] as const) {
      if (name in Blob.prototype) Object.defineProperty(Blob.prototype, name, { configurable: true, value() { attempts.push(name); throw Error('File contents must not be read'); } });
    }
    for (const name of ['readAsText', 'readAsArrayBuffer', 'readAsDataURL', 'readAsBinaryString'] as const) {
      FileReader.prototype[name] = function () { attempts.push(name); throw Error('File contents must not be read'); };
    }
    URL.createObjectURL = () => { attempts.push('objectURL'); throw Error('No document previews'); };
  });
  return async () => {
    expect(calls).toEqual([]); expect(errors).toEqual([]);
    expect(await page.evaluate(() => Reflect.get(window, 'uploadReadAttempts'))).toEqual([]);
  };
}

for (const theme of ['light', 'dark'] as const) for (const width of [1440, 768, 390, 320]) {
  test(`upload ${width} ${theme}: four states, reflow, focus and safe local sample`, async ({ page, baseURL }) => {
    const verify = await guard(page);
    await page.setViewportSize({ width, height: width === 1440 ? 900 : width === 768 ? 1024 : 844 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.goto('/upload-prescription'); await page.evaluate(() => document.fonts.ready);
    const prefix = `${folder}/${baseURL?.includes(':4174') ? 'preview' : 'dev'}-${width}-${theme}`;
    await mkdir(folder, { recursive: true });
    const capture = async (state: string) => {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: `${prefix}-${state}.png`, fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    };
    await expect(page.getByText('Demo Mode', { exact: true })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Browse files' })).toBeVisible();
    await capture('empty');
    const metrics = await page.evaluate(() => Object.fromEntries(['.md-page', '.md-upload-workspace', '.md-upload-form', '.md-upload-drop', '.md-upload-demo-entry', '.cc-page-title', '.cc-section-title', '.md-upload-drop .cc-icon-box', '.md-upload-demo-entry button'].map(selector => {
      const node = document.querySelector(selector)!; const rect = node.getBoundingClientRect(), css = getComputedStyle(node);
      return [selector, { x: rect.x, y: rect.y, width: rect.width, height: rect.height, font: css.fontFamily, size: css.fontSize, weight: css.fontWeight, lineHeight: css.lineHeight, radius: css.borderRadius, padding: css.padding, gap: css.gap, columns: css.gridTemplateColumns, color: css.color, background: css.backgroundColor }];
    })));
    await writeFile(`${prefix}-measurements.json`, JSON.stringify(metrics, null, 2));
    const input = page.getByLabel('Choose prescription file');
    await input.setInputFiles(fixture);
    await expect(page.getByRole('button', { name: 'Replace file' })).toBeFocused();
    await expect(page.getByRole('button', { name: 'Browse files' })).toHaveCount(0);
    await expect(page.getByRole('status')).toContainText('selected locally');
    await expect(page.getByText(`PDF · ${fixture.buffer.length} B`)).toBeVisible();
    await capture('selected');
    await input.setInputFiles({ name: 'invalid.txt', mimeType: 'text/plain', buffer: Buffer.from('synthetic') });
    await expect(page.getByRole('alert')).toContainText('Choose a JPG, PNG or PDF file.');
    await expect(page.getByRole('alert')).toContainText('The previous file is still selected.');
    await expect(page.getByText(fixture.name, { exact: true })).toBeVisible();
    await capture('error');
    await page.getByRole('button', { name: 'View Sample Analysis' }).click();
    await expect(page.getByRole('heading', { name: 'Sample Analysis — predefined example' })).toBeFocused();
    await expect(page.getByRole('button', { name: 'View Sample Analysis' })).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('region', { name: 'Sample analysis' })).toContainText('Not an analysis of your selected file');
    await capture('sample');
    await page.getByRole('button', { name: 'Back to file selection' }).click();
    await expect(page.getByRole('button', { name: 'Replace file' })).toBeFocused();
    await input.setInputFiles(fixture); // Same-file reselection clears the earlier error.
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.getByRole('button', { name: 'Remove file' }).click();
    await expect(page.getByRole('button', { name: 'Browse files' })).toBeFocused();
    await expect(page.getByRole('status')).toContainText('File removed');
    await page.getByRole('button', { name: 'View Sample Analysis' }).click();
    await input.setInputFiles([]); // Empty change / picker cancellation retains the open sample.
    await expect(page.getByRole('region', { name: 'Sample analysis' })).toBeVisible();
    await page.getByRole('button', { name: 'Close sample' }).click();
    await expect(page.getByRole('button', { name: 'View Sample Analysis' })).toBeFocused();
    await page.getByRole('button', { name: 'Browse files' }).focus();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'View Sample Analysis' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    const picker = page.waitForEvent('filechooser'); await page.keyboard.press('Enter'); await (await picker).setFiles(fixture);
    await expect(page.getByRole('button', { name: 'Replace file' })).toBeFocused();
    await page.getByRole('button', { name: 'View Sample Analysis' }).click();
    const back = page.getByRole('button', { name: 'Back to file selection' });
    await back.focus(); await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const clearance = await back.evaluate(element => {
      const nav = document.querySelector('.cc-mobile-nav');
      const bottom = nav && getComputedStyle(nav).display !== 'none' ? nav.getBoundingClientRect().top : innerHeight;
      return bottom - element.getBoundingClientRect().bottom;
    });
    expect(clearance).toBeGreaterThanOrEqual(0);
    await page.screenshot({ path: `${prefix}-bottom-clearance.png` });
    await verify();
  });
}

test('upload drag boundaries, replacement policy, size validation and memory reset', async ({ page }) => {
  const verify = await guard(page); await page.goto('/upload-prescription');
  const zone = page.locator('.md-upload-selection');
  const data = await page.evaluateHandle(() => { const transfer = new DataTransfer(); transfer.items.add(new File(['Synthetic only'], 'dropped.png', { type: 'image/png' })); return transfer; });
  await zone.dispatchEvent('dragenter', { dataTransfer: data });
  await expect(zone).toHaveClass(/is-dragging/);
  await zone.locator('strong').dispatchEvent('dragenter', { dataTransfer: data });
  await zone.locator('strong').dispatchEvent('dragleave', { dataTransfer: data });
  await expect(zone).toHaveClass(/is-dragging/);
  await zone.dispatchEvent('dragleave', { dataTransfer: data });
  await expect(zone).not.toHaveClass(/is-dragging/);
  // Native target transitions pair an enter on the child with a leave on the parent.
  await zone.dispatchEvent('dragenter', { dataTransfer: data });
  await zone.locator('strong').dispatchEvent('dragenter', { dataTransfer: data });
  await zone.evaluate((element) => element.dispatchEvent(new DragEvent('dragleave', { bubbles: true, relatedTarget: element.querySelector('strong') })));
  await expect(zone).toHaveClass(/is-dragging/);
  await zone.locator('strong').dispatchEvent('dragleave', { dataTransfer: data });
  await expect(zone).not.toHaveClass(/is-dragging/);
  await zone.dispatchEvent('drop', { dataTransfer: data });
  await expect(page.getByText('dropped.png', { exact: true })).toBeVisible();
  const multiple = await page.evaluateHandle(() => { const transfer = new DataTransfer(); for (const name of ['one.pdf', 'two.pdf']) transfer.items.add(new File(['Synthetic'], name, { type: 'application/pdf' })); return transfer; });
  await zone.dispatchEvent('drop', { dataTransfer: multiple });
  await expect(page.getByRole('alert')).toContainText('Choose one file at a time.');
  await expect(page.getByRole('button', { name: 'Replace file' })).toBeFocused();
  const input = page.getByLabel('Choose prescription file');
  await input.setInputFiles({ name: 'oversized.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(10 * 1024 * 1024 + 1) });
  await expect(page.getByRole('alert')).toContainText('Choose a non-empty file up to 10 MB.');
  await expect(page.getByText('dropped.png', { exact: true })).toBeVisible();
  await input.setInputFiles({ name: 'empty.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(0) });
  await expect(page.getByRole('alert')).toContainText('Choose a non-empty file up to 10 MB.');
  await input.setInputFiles({ ...fixture, name: `${'synthetic-'.repeat(25)}.pdf` });
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => {
    const sizes = [...document.querySelectorAll<HTMLElement>('.md-upload-page *')].map(node => ({ node, size: parseFloat(getComputedStyle(node).fontSize) }));
    sizes.forEach(({ node, size }) => { node.style.fontSize = `${size * 2}px`; });
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload(); await expect(page.getByRole('button', { name: 'Browse files' })).toBeVisible(); await expect(page.getByRole('region', { name: 'Sample analysis' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Browse files' }).focus();
  const picker = page.waitForEvent('filechooser'); await page.keyboard.press('Space'); await (await picker).setFiles(fixture);
  await expect(page.getByText(fixture.name, { exact: true })).toBeVisible();
  await verify();
});
