import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

const folder = 'playwright-report/b4a2';
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
  await expect.poll(async () => (await sample()).time).toBeGreaterThan(first.time + .75);
  const second = await sample(); expect(second.transform).not.toBe(first.transform);
  await page.screenshot({ path: `${folder}/${mode}-ribbon-frame-2.png` });
  // Headless live geometry sampling can remain stale while compositor transforms advance.
  // Verify SMIL morphing separately at exact SVG times, without depending on paint timing.
  const morph = await svg.evaluate((el: SVGSVGElement) => {
    const time = el.getCurrentTime(); el.pauseAnimations();
    const points = [0, 3].map((at) => {
      el.setCurrentTime(at);
      return [...el.querySelectorAll<SVGPathElement>('path')].map(path => {
        const point = path.getPointAtLength(150); return { x: point.x, y: point.y };
      });
    });
    el.setCurrentTime(time); el.unpauseAnimations(); return points;
  });
  expect(morph[0]).toHaveLength(4);
  for (let i = 0; i < 4; i++) expect(Math.abs(morph[1][i].y - morph[0][i].y)).toBeGreaterThan(.5);
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
  // Flush the reduced-motion paint before comparing the static SVG timeline.
  await page.screenshot({ path: `${folder}/${mode}-ribbon-reduced-motion.png` });
  const reducedFirst = await sample();
  await page.waitForTimeout(300); const reducedSecond = await sample();
  expect(reducedSecond).toEqual(reducedFirst);
  await writeFile(`${folder}/${mode}-motion-observations.json`, JSON.stringify({ first, second, morph, reducedFirst, reducedSecond }, null, 2));
});

for (const size of [{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobile', width: 390, height: 844 }]) {
 test(`source binary theme control ${size.name}: effective System fallback, values, keyboard and persistence`, async ({ page, context, baseURL }) => {
  const mode = baseURL?.includes(':4174') ? 'preview' : 'dev'; await page.setViewportSize(size);
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' }); await page.goto('/sign-in');
  await expect(page.locator('.cc-public-theme-toggle')).toHaveCount(1);
  await expect(page.locator('details')).toHaveCount(0); await expect(page.getByRole('button', { name: /Use system|Theme preference/ })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('meddecode-theme'))).toBeNull();
  await page.emulateMedia({ colorScheme: 'dark' }); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByLabel('Email address').fill('preview@example.test'); await page.getByLabel('Password', { exact: true }).fill('Preview-only-42!');
  const toggle = page.getByRole('button', { name: 'Switch to light mode' }); await toggle.focus(); expect(await toggle.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');
  await page.screenshot({ path: `${folder}/${mode}-theme-focused-${size.name}.png`, fullPage: true });
  await page.keyboard.press('Enter'); await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByLabel('Email address')).toHaveValue('preview@example.test'); await expect(page.getByLabel('Password', { exact: true })).toHaveValue('Preview-only-42!');
  expect(await page.evaluate(() => localStorage.getItem('meddecode-theme'))).toBe('light');
  await page.getByRole('button', { name: 'Switch to dark mode' }).click(); await page.reload(); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const second = await context.newPage(); await second.goto('/'); await page.getByRole('button', { name: 'Switch to light mode' }).click(); await expect(second.locator('html')).toHaveAttribute('data-theme', 'light'); await second.close();
  await page.goto('/');
  for (const theme of ['light', 'dark']) {
   await expect(page.locator('html')).toHaveAttribute('data-theme', theme); await page.mouse.move(0, 0);
   await page.locator('.cc-public-header').screenshot({ path: `${folder}/${mode}-landing-header-${size.name}-${theme}.png` });
   await page.screenshot({ path: `${folder}/${mode}-landing-${size.name}-${theme}.png`, fullPage: true });
   const button = page.locator('.cc-public-theme-toggle'); const r = await button.boundingBox(); expect(r!.width).toBeGreaterThanOrEqual(44); expect(r!.height).toBeGreaterThanOrEqual(44);
   expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); await button.click();
  }
 });
}

test('320px enlarged text in both themes keeps forms, binary toggle and public navigation reachable', async ({ page }) => {
 await page.setViewportSize({ width: 320, height: 568 }); await page.emulateMedia({ reducedMotion: 'reduce' });
 for (const theme of ['light', 'dark'] as const) for (const route of ['sign-in', 'sign-up', 'forgot-password', 'reset-password', '']) {
  await page.emulateMedia({ colorScheme: theme }); await page.goto('/' + route); await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  await expect(page.locator('.cc-public-theme-toggle')).toHaveCount(1); await expect(page.locator('details')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const toggle = page.locator('.cc-public-theme-toggle'); await toggle.focus(); await page.keyboard.press('Enter'); await expect(toggle).toBeFocused();
  if (route) {
   const toolbar = await page.locator('.cc-login-panel-top').boundingBox(); const form = await page.locator('.cc-login-form-wrap').boundingBox(); expect(toolbar!.y + toolbar!.height).toBeLessThanOrEqual(form!.y);
   for (const element of await page.locator('.cc-login-form-wrap input, .cc-login-form-wrap button, .cc-login-form-wrap label').all()) {
    const bounds = await element.boundingBox(); expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
   }
   if (route === 'sign-in') expect(await page.getByRole('button', { name: 'Continue with Google' }).locator('span').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
   await page.getByRole('button', { name: /^(Sign In|Create Account|Request reset link|Update password)$/ }).click(); await expect(page.locator('[aria-invalid="true"]').first()).toBeFocused();
  } else { await page.getByRole('button', { name: 'Open Explore menu' }).click(); await expect(page.getByRole('navigation', { name: 'Mobile public navigation' })).toBeVisible(); }
 }
});

for (const route of ['sign-in', 'sign-up']) test(`Google presentation ${route}: no OAuth requests, storage or lost values`, async ({ page }) => {
 const calls: string[] = []; page.on('request', request => { if (['fetch','xhr'].includes(request.resourceType())) calls.push(request.url()); });
 await page.goto('/' + route); await page.getByLabel('Email address').fill('preview@example.test'); await page.getByLabel('Password', { exact: true }).fill('Preview-only-42!');
 await expect(page.getByRole('separator')).toHaveText('or continue with email');
 await page.getByRole('button', { name: 'Continue with Google' }).click(); await expect(page.getByRole('status')).toHaveText('Google sign-in is not connected yet. Nothing was sent.');
 await expect(page.getByRole('alert')).toHaveCount(0); await expect(page.getByLabel('Password', { exact: true })).toHaveValue('Preview-only-42!');
 expect(calls).toEqual([]); expect(await page.evaluate(() => ({ local: {...localStorage}, session: {...sessionStorage}, cookie: document.cookie }))).toEqual({local:{},session:{},cookie:''});
});

test('source geometry: desktop cards, source fonts, labels, fields, buttons and normal-state spacing', async ({ page, baseURL }) => {
 const rows = []; await page.setViewportSize({width:1440,height:900}); await page.emulateMedia({reducedMotion:'reduce'});
 for (const route of ['sign-in','sign-up','forgot-password','reset-password']) {
  await page.goto('/' + route); await page.evaluate(() => document.fonts.ready); await page.mouse.move(0,0);
  const row = await page.locator('.cc-login-form-wrap').evaluate(el => {
   const box = el.getBoundingClientRect(); const input=el.querySelector('input')!; const button=el.querySelector('button[type=submit]')!;
   return {width:box.width,height:box.height,x:box.x,y:box.y,font:getComputedStyle(el).fontFamily,label:getComputedStyle(el.querySelector('label')!).fontSize,input:input.getBoundingClientRect().height,button:button.getBoundingClientRect().height,gap:getComputedStyle(el.querySelector('form')!).rowGap};
  });
  expect(row.width).toBe(route === 'sign-in' ? 464 : 480); expect(row.label).toBe('12px'); expect(row.font).toContain('MedDecode Auth Inter');
  expect(await page.evaluate(() => document.fonts.check('16px "MedDecode Auth Inter"'))).toBe(true);
  expect(row.input).toBeCloseTo(route === 'sign-up' ? 46.4 : 50.4, 1); expect(row.button).toBeCloseTo(route === 'sign-up' ? 46.4 : 50.4, 1);
  // B.4a.3 shares the source compact heading baseline; its natural card height changes.
  if (route === 'sign-in') { expect(row.height).toBeCloseTo(568.984375, 1); expect(row.y).toBeCloseTo(175.5078125, 1); }
  if (route === 'sign-up') { expect(Math.abs(row.height - 684.265625)).toBeLessThan(4); expect(row.gap).toBe('12px'); }
  const split=await page.locator('.cc-login-story').boundingBox(); expect(split!.width).toBeCloseTo(809.14,1); rows.push({route,...row});
 }
 await writeFile(`${folder}/${baseURL?.includes(':4174') ? 'preview' : 'dev'}-geometry.json`,JSON.stringify(rows,null,2));
});
