import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { destinations } from '../../src/app/navigation';

test('desktop exposes exactly seven routes, focus and browser history', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/home');
  const navigation = page.getByRole('navigation', { name: 'Primary navigation' });
  await expect(navigation).toBeVisible();
  await expect(navigation.locator(':scope > a:visible')).toHaveCount(7);
  await expect(page.locator('.md-sidebar')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeHidden();
  for (const destination of destinations) {
    await navigation.getByRole('link', { name: destination.label, exact: true }).filter({visible:true}).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(destination.path === '/home' ? 'Welcome, Demo User.' : destination.label);
    await expect(page).toHaveTitle(`${destination.label} | MedDecode`);
    await expect(navigation.getByRole('link', { name: destination.label, exact: true, includeHidden:true }).first()).toHaveAttribute('aria-current', 'page');
    if (destination.path !== '/home') await expect(page.getByRole('main')).toBeFocused();
  }
  await page.goBack();
  await expect(page).toHaveURL(/\/reminders$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/learn-resources$/);
  // Route focus is scheduled in requestAnimationFrame; wait before testing link focus.
  await expect(page.getByRole('main')).toBeFocused();
  const focused = navigation.getByRole('link', { name: 'Learn & Resources', exact:true }).filter({visible:true});
  await page.keyboard.press('Tab');
  await focused.focus();
  await expect(focused).toBeFocused();
  await expect(focused).toHaveCSS('outline-style', 'solid');
  await mkdir('test-results/evidence', { recursive: true });
  await page.screenshot({ path: `test-results/evidence/${baseURL?.includes(':4174') ? 'preview' : 'dev'}-shell-desktop-navigation-focus.png`, animations: 'disabled' });
});

for (const width of [390, 768]) {
  test(`drawer at ${width}px isolates background, contains focus and restores it`, async ({ page, baseURL }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1024 });
    await page.goto('/home');
    await expect(page.getByRole('navigation', { name: 'Primary navigation' })).toBeHidden();
    const trigger = page.getByRole('button', { name: 'Explore all sections' });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Explore MedDecode' });
    await expect(dialog).toBeVisible();
    await expect(page.locator('.md-shell-background')).toHaveAttribute('inert', '');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const close = dialog.getByRole('button', { name: 'Close navigation' });
    await expect(close).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('link', { name: /Learn & Resources/ })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    if (width === 390) {
      await mkdir('test-results/evidence', { recursive: true });
      await page.screenshot({ path: `test-results/evidence/${baseURL?.includes(':4174') ? 'preview' : 'dev'}-shell-mobile-more-open-390x844.png`, animations: 'disabled' });
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(page.locator('.md-shell-background')).not.toHaveAttribute('inert');
    await trigger.click();
    await dialog.getByRole('link', { name: /Compare Medicines/ }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Compare Medicines');
    await expect(page.getByRole('main')).toBeFocused();
    await expect(page.getByRole('button',{name:'Explore all sections'})).toHaveAttribute('aria-expanded','false');
  });
}

test('mobile bottom navigation and scroll clearance remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/home');
  const nav = page.getByRole('navigation', { name: 'Mobile navigation' });
  await expect(nav.getByRole('link')).toHaveText(['Home', 'Upload', 'Insights', 'Cabinet', 'Reminders', 'Learn']);
  await nav.getByRole('link', { name: 'Upload', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Upload Prescription');
  await nav.getByRole('link', { name: 'Cabinet', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('My Cabinet');
  // Force a short viewport to verify the demo footer clears fixed navigation.
  await page.setViewportSize({ width: 390, height: 420 });
  await page.locator('.md-demo-footnote').scrollIntoViewIfNeeded();
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  const note = await page.locator('.md-demo-footnote').boundingBox();
  const bar = await nav.boundingBox();
  expect(note!.y + note!.height).toBeLessThanOrEqual(bar!.y);
});

test('not-found navigation recovers without authentication', async ({ page }) => {
  await page.goto('/not-a-section');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
  await expect(page).toHaveTitle('Page not found | MedDecode');
  await page.getByRole('link', { name: 'Return to Home' }).click();
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole('main')).toBeFocused();
});

test('200-percent-equivalent reflow and narrow screens retain navigation', async ({ page }) => {
  // 720 CSS px models the available width of a 1440px window at 200% zoom.
  // This is a reflow simulation, not a native browser-zoom certification.
  for (const width of [720, 320]) {
    await page.setViewportSize({ width, height: 450 });
    await page.goto('/compare-medicines');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Explore all sections' }).click();
    await expect(page.getByRole('dialog').getByRole('link')).toHaveCount(7);
    await page.keyboard.press('Escape');
  }
});

test('Manrope loads, reduced motion disables drawer animation, and palette is scoped', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/home');
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('16px "Manrope Variable"'))).toBe(true);
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--cc-bg').trim())).toBe('#f8f9fc');
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--cc-bg').trim())).toBe('#0d1018');
  await page.getByRole('button', { name: 'Explore all sections' }).click();
  expect(await page.getByRole('dialog').evaluate((element) => getComputedStyle(element).animationName)).toBe('none');
});
