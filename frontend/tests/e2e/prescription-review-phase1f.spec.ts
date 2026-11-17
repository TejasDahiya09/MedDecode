import { expect, test, type Route } from '@playwright/test';

const prescriptionId = 'f1000000-0000-4000-8000-000000000001';
const ownerId = '10000000-0000-4000-8000-000000000001';
let ownerToken = '';

async function json(route: Route, status: number, body: object): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

test('genuine browser -> Express -> PostgreSQL two-revision workflow', async ({ page, request }) => {
  const metadata = test.info().config.metadata as { phase1fAliceSecret: string; phase1fBobSecret: string };
  await page.route('**/auth/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/token')) {
      const signedIn = await request.post('http://127.0.0.1:3011/__acceptance/auth/sign-in', {
        data: { account: 'alice', secret: metadata.phase1fAliceSecret },
      });
      expect(signedIn.status()).toBe(200);
      const local = await signedIn.json() as { token: string; user: { id: string; email: string } };
      ownerToken = local.token;
      return json(route, 200, {
        access_token: local.token, token_type: 'bearer', expires_in: 3600, refresh_token: 'phase1f-local-refresh',
        user: { id: local.user.id, email: local.user.email, aud: 'authenticated', role: 'authenticated',
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(), app_metadata: {}, user_metadata: {}, identities: [] },
      });
    }
    if (path.endsWith('/user')) return json(route, 200, { id: ownerId, email: 'alice@synthetic.invalid' });
    return json(route, 404, {});
  });

  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill('alice@synthetic.invalid');
  await page.getByRole('textbox', { name: 'Password' }).fill(metadata.phase1fAliceSecret);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);

  await page.goto(`/prescriptions/${prescriptionId}/review`);
  await expect(page.getByRole('heading', { level: 1, name: 'Review & Edit Prescription' })).toBeVisible();
  await expect(page.locator('object[type="application/pdf"], iframe, embed').first()).toBeVisible();
  const name = page.getByRole('textbox', { name: /Medicine Name/ });
  await name.fill('Examplemed Revision One');
  await page.getByRole('button', { name: 'Save Draft' }).click();
  await expect(page.getByText(/Review draft saved \(Revision 1, lock v\d+\)/)).toBeVisible();
  await page.reload();
  await expect(page.getByRole('textbox', { name: /Medicine Name/ })).toHaveValue('Examplemed Revision One');

  await page.getByRole('button', { name: 'Confirm prescription review' }).first().click();
  await page.getByLabel('Confirmation statement checkbox').check();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm Review' }).click();
  await expect(page.getByText('Revision 1 is Confirmed')).toBeVisible();
  const finalize1 = await page.evaluate(async ({ id, token }) => {
    const response = await fetch(`/__acceptance/prescriptions/${id}/finalize`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    return { status: response.status, body: await response.json() };
  }, { id: prescriptionId, token: ownerToken });
  expect(finalize1.status).toBe(200);
  expect(finalize1.body.result.status).toMatch(/^completed/);

  await page.getByRole('button', { name: /Reopen/i }).click();
  await expect(page.getByText(/Revision 2/).first()).toBeVisible();
  await page.getByRole('textbox', { name: /Medicine Name/ }).fill('Examplemed Revision Two');
  await page.getByLabel('Strength value').fill('20');
  await page.getByRole('button', { name: 'Save Draft' }).click();
  await page.getByRole('button', { name: 'Confirm prescription review' }).first().click();
  await page.getByLabel('Confirmation statement checkbox').check();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm Review' }).click();
  await expect(page.getByText('Revision 2 is Confirmed')).toBeVisible();
  const finalize2 = await page.evaluate(async ({ id, token }) => {
    const response = await fetch(`/__acceptance/prescriptions/${id}/finalize`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    return { status: response.status, body: await response.json() };
  }, { id: prescriptionId, token: ownerToken });
  expect(finalize2.status).toBe(200);

  const persisted = await page.evaluate(async ({ id, token }) => {
    const current = await fetch(`/api/v1/prescriptions/${id}/results`, { headers: { Authorization: `Bearer ${token}` } });
    const history = await fetch(`/__acceptance/prescriptions/${id}/result-history`, { headers: { Authorization: `Bearer ${token}` } });
    return { currentStatus: current.status, current: await current.json(), historyStatus: history.status, history: await history.json() };
  }, { id: prescriptionId, token: ownerToken });
  expect(persisted.currentStatus).toBe(200);
  expect(persisted.current.medicines[0].extraction.medicine_name).toContain('Examplemed Revision Two');
  expect(persisted.historyStatus).toBe(200);
  expect(persisted.history.results).toHaveLength(2);
  expect(persisted.history.results.filter((item: { is_current: boolean }) => item.is_current)).toHaveLength(1);
  expect(persisted.history.results[0].is_current).toBe(false);
  expect(persisted.history.results[1].is_current).toBe(true);

  await page.getByRole('button', { name: 'View prescription revision history' }).click();
  await expect(page.getByRole('dialog')).toContainText('Revision 1');
  await expect(page.getByRole('dialog')).toContainText('Revision 2');

  const bob = await request.post('http://127.0.0.1:3011/__acceptance/auth/sign-in', { data: { account: 'bob', secret: metadata.phase1fBobSecret } });
  const bobToken = (await bob.json() as { token: string }).token;
  const crossOwner = await request.get(`http://127.0.0.1:3011/api/v1/prescriptions/${prescriptionId}/review`, { headers: { Authorization: `Bearer ${bobToken}` } });
  expect(crossOwner.status()).toBe(404);
  const cleanup = await request.post('http://127.0.0.1:3011/__acceptance/cleanup', { headers: { Authorization: `Bearer ${ownerToken}` } });
  expect(cleanup.status()).toBe(200);
  expect(await cleanup.json()).toEqual({ marker: 'PHASE1F_FIXTURE_CLEANUP_OK' });
  const removed = await request.get(`http://127.0.0.1:3011/api/v1/prescriptions/${prescriptionId}/review`, { headers: { Authorization: `Bearer ${ownerToken}` } });
  expect(removed.status()).toBe(404);
});
