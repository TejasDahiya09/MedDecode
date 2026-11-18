import { expect, test, type Page } from '@playwright/test';

const userId = '00000000-0000-4000-8000-000000000006';

async function prepareAuthenticatedWorkspace(page: Page) {
  await page.addInitScript(({ id }) => {
    window.localStorage.setItem('sb-mock-auth-token', JSON.stringify({
      access_token: 'synthetic-batch6-access-token',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: 4_102_444_800,
      refresh_token: 'synthetic-batch6-refresh-token',
      user: {
        id,
        aud: 'authenticated',
        role: 'authenticated',
        email: 'batch6@example.test',
        app_metadata: { provider: 'email', providers: ['email'] },
        user_metadata: { full_name: 'Batch Six User' },
      },
    }));
  }, { id: userId });

  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/auth/me') {
      await route.fulfill({ json: { user: { id: userId, email: 'batch6@example.test' } } });
      return;
    }
    if (path === '/api/v1/medicine-cabinet') {
      await route.fulfill({
        json: {
          items: [],
          pagination: { limit: 50, offset: 0, returned: 0, has_more: false, next_offset: null },
        },
      });
      return;
    }
    if (path === '/api/v1/reminders') {
      await route.fulfill({ json: { items: [], total: 0 } });
      return;
    }
    if (path === '/api/v1/reminders/dose-logs') {
      await route.fulfill({ json: { items: [] } });
      return;
    }
    await route.fulfill({ status: 404, json: { error: { code: 'SYNTHETIC_NOT_FOUND' } } });
  });
}

test('desktop navigation loads lazy Cabinet and Reminders routes', async ({ page }) => {
  await prepareAuthenticatedWorkspace(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/my-cabinet');
  await expect(page.getByRole('heading', { level: 1, name: 'My Cabinet' })).toBeVisible();

  await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Reminders', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Medication Reminders' })).toBeVisible();
  await expect(page.getByRole('main')).toBeFocused();
  await expect(page).toHaveTitle('Reminders | MedDecode');
});

test('mobile lazy-route navigation remains keyboard accessible and has no horizontal overflow', async ({ page }) => {
  await prepareAuthenticatedWorkspace(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/my-cabinet');
  await expect(page.getByRole('heading', { level: 1, name: 'My Cabinet' })).toBeVisible();
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);

  const explore = page.getByRole('button', { name: 'Explore all sections' });
  await explore.focus();
  await expect(explore).toBeFocused();
  await page.keyboard.press('Enter');
  const directory = page.getByRole('dialog', { name: 'Explore MedDecode' });
  await expect(directory.getByRole('button', { name: 'Close navigation' })).toBeFocused();
  await expect(directory.getByText('Organize saved medicines, quantities, refill dates and expiry details.')).toBeVisible();
  await expect(directory.getByText('Create and manage medication schedules and recorded dose events.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(directory).toBeHidden();
  await expect(explore).toBeFocused();
});
