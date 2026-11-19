import { expect, test } from '@playwright/test';

import {
  hostedTestsApproved,
  loadHostedTestConfiguration,
} from './support/hosted-test-credentials';

test.describe('approval-gated current hosted workflows', () => {
  test.skip(!hostedTestsApproved(), 'separate hosted browser authorization and runtime secrets required');

  test('owner can authenticate and reach the supported read-only workspaces', async ({ page }) => {
    const configuration = loadHostedTestConfiguration();
    expect(new URL(page.url() || configuration.origin).protocol).not.toBe('http:');

    await page.goto(new URL('/sign-in', configuration.origin).toString());
    await page.getByLabel('Email address').fill(configuration.email);
    await page.getByLabel('Password', { exact: true }).fill(configuration.password);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page).not.toHaveURL(/\/sign-in$/);

    for (const route of ['/medicine-library', '/compare-medicines', '/my-cabinet', '/reminders', '/prescriptions']) {
      await page.goto(new URL(route, configuration.origin).toString());
      await expect(page.locator('main')).toBeVisible();
      await expect(page).not.toHaveURL(/\/sign-in$/);
    }
  });
});
