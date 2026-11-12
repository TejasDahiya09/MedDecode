import { expect, test } from '@playwright/test';

test.describe('medicine comparison marketplace integration', () => {
  test('starts empty and carries the exact marketplace medicine into slot A', async ({ page }) => {
    await page.goto('/compare-medicines');
    await expect(page.getByRole('heading', { name: 'Choose Medicine A' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Choose Medicine B' })).toBeVisible();
    await page.goto('/medicine-insights');
    await page.getByRole('button', { name: 'Next' }).click();
    const pine = page.getByRole('article').filter({ hasText: 'Pine' });
    await pine.getByRole('link', { name: /Compare Pine/ }).click();
    await expect(page).toHaveURL(/compare-medicines\?a=pine$/);
    await expect(page.getByRole('article', { name: /Medicine A: Pine/ })).toBeVisible();
    await expect(page.getByRole('article', { name: /Medicine B: no selection/ })).toBeVisible();
  });

  test('selects, swaps, removes and clears URL-driven medicines', async ({ page }) => {
    await page.goto('/compare-medicines?a=pine');
    await page.getByRole('button', { name: 'Choose medicine' }).click();
    const dialog = page.getByRole('dialog', { name: 'Choose Medicine B' });
    await expect(dialog.getByRole('listitem')).toHaveCount(15);
    await dialog.getByRole('searchbox').fill('  cedar  ');
    await expect(dialog.getByRole('listitem')).toHaveCount(1);
    await dialog.getByRole('listitem').click();
    await expect(page).toHaveURL(/a=pine&b=cedar/);
    await expect(page.getByRole('button', { name: 'Change Medicine B' })).toBeFocused();
    await expect(page.getByRole('heading', { name: 'Side-by-side comparison' })).toBeVisible();
    await expect(page.locator('.md-compare-row')).toHaveCount(8);
    await page.getByRole('button', { name: 'Swap medicines' }).click();
    await expect(page).toHaveURL(/a=cedar&b=pine/);
    await page.getByRole('button', { name: /Remove Pine.*Medicine B/ }).click();
    await expect(page).toHaveURL(/\?a=cedar$/);
    await expect(page.getByRole('button', { name: 'Choose medicine' })).toBeFocused();
    await page.getByRole('button', { name: 'Clear comparison' }).click();
    await expect(page).toHaveURL(/compare-medicines$/);
    await expect(page.getByRole('button', { name: 'Choose medicine' }).first()).toBeFocused();
  });

  test('sanitizes invalid and duplicate deep links without substitutions', async ({ page }) => {
    await page.goto('/compare-medicines?a=missing&b=cedar');
    await expect(page).toHaveURL(/compare-medicines\?b=cedar$/);
    await expect(page.getByRole('article', { name: /Medicine B: Cedar/ })).toBeVisible();
    await page.goto('/compare-medicines?a=pine&b=pine');
    await expect(page).toHaveURL(/\?a=pine$/);
    await expect(page.getByRole('article', { name: /Medicine B: no selection/ })).toBeVisible();
  });

  test('preserves the remaining slot and browser history across removal and navigation', async ({ page }) => {
    await page.goto('/compare-medicines?a=pine&b=cedar');
    await page.getByRole('button', { name: /Remove Pine.*Medicine A/ }).click();
    await expect(page).toHaveURL(/\?b=cedar$/);
    await expect(page.getByRole('article', { name: /Medicine A: no selection/ })).toBeVisible();
    await expect(page.getByRole('article', { name: /Medicine B: Cedar/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Choose medicine' })).toBeFocused();
    await page.goBack();
    await expect(page).toHaveURL(/a=pine&b=cedar/);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Side-by-side comparison' })).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(/\?b=cedar$/);
  });

  test('supports search clearing, Escape close and focus restoration', async ({ page }) => {
    await page.goto('/compare-medicines');
    const trigger = page.getByRole('button', { name: 'Choose medicine' }).first();
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: 'Choose Medicine A' });
    const search = dialog.getByRole('searchbox');
    await search.fill('not in catalog');
    await expect(dialog.getByText('No medicine examples found')).toBeVisible();
    await dialog.getByRole('button', { name: 'Clear search' }).click();
    await expect(search).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('keeps mobile comparison aligned and clear of bottom navigation', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto('/compare-medicines?a=pine&b=cedar');
    await expect(page.locator('.md-compare-row').first().locator('dd')).toHaveCount(2);
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 320);
    const footer = page.locator('.md-demo-footnote');
    await footer.scrollIntoViewIfNeeded();
    const footerBox = await footer.boundingBox();
    const navBox = await page.locator('.cc-mobile-nav').boundingBox();
    expect(footerBox && navBox && footerBox.y + footerBox.height <= navBox.y).toBeTruthy();
  });
});
