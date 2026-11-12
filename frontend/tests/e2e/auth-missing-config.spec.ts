import { expect, test } from '@playwright/test';

test('missing public auth configuration shows a safe error and no workspace bypass', async ({ page }) => {
  await page.goto('/home');
  await expect(page.getByRole('heading', { name: 'Session verification unavailable' })).toBeVisible();
  await expect(page.getByText('Authentication could not be initialized. Check this deployment configuration.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Welcome, Demo User.' })).toHaveCount(0);
});
