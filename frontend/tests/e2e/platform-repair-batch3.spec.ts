import { expect, test, type APIRequestContext, type Page, type Route } from '@playwright/test';

const API = 'http://127.0.0.1:3011';
const medicineOne = 'd2000000-0000-4000-8000-000000000001';
const medicineTwo = 'd2000000-0000-4000-8000-000000000002';
const incompleteMedicine = 'd2000000-0000-4000-8000-000000000004';

async function json(route: Route, status: number, body: object): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function signIn(page: Page, request: APIRequestContext, secret: string): Promise<string> {
  let token = '';
  await page.route('**/auth/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/token')) {
      const response = await request.post(`${API}/__acceptance/auth/sign-in`, { data: { account: 'alice', secret } });
      const value = await response.json() as { token: string; user: { id: string; email: string } };
      token = value.token;
      return json(route, 200, { access_token: token, token_type: 'bearer', expires_in: 3600, refresh_token: 'local-only',
        user: { id: value.user.id, email: value.user.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, identities: [] } });
    }
    if (path.endsWith('/user')) return json(route, 200, { id: '10000000-0000-4000-8000-000000000001', email: 'alice@synthetic.invalid' });
    return json(route, 404, {});
  });
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill('alice@synthetic.invalid');
  await page.getByRole('textbox', { name: 'Password' }).fill(secret);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page).not.toHaveURL(/sign-in/);
  return token;
}

test('Cabinet, Reminders, Catalogue and comparison remain persistent and owner scoped', async ({ page, request }) => {
  test.setTimeout(90_000);
  const browserErrors: string[] = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  const metadata = test.info().config.metadata as { phase1fAliceSecret: string; phase1fBobSecret: string };
  const token = await signIn(page, request, metadata.phase1fAliceSecret);
  const headers = { Authorization: `Bearer ${token}` };
  const bob = await request.post(`${API}/__acceptance/auth/sign-in`, { data: { account: 'bob', secret: metadata.phase1fBobSecret } });
  const bobToken = (await bob.json() as { token: string }).token;

  expect((await request.get(`${API}/api/v1/medicine-cabinet`)).status()).toBe(401);
  expect((await request.post(`${API}/api/v1/medicine-cabinet`, { headers, data: { medicine_id: medicineOne, quantity: '-1' } })).status()).toBe(400);
  const first = await request.post(`${API}/api/v1/medicine-cabinet`, { headers, data: {
    medicine_id: medicineOne, quantity: '10', purchase_date: '2026-11-01', expiry_date: '2027-11-01', usage_information: 'Fictional cabinet lot A' } });
  const second = await request.post(`${API}/api/v1/medicine-cabinet`, { headers, data: {
    medicine_id: medicineOne, quantity: '5', usage_information: 'Fictional cabinet lot B' } });
  expect(first.status()).toBe(201); expect(second.status()).toBe(201);
  const firstId = (await first.json() as { entry: { id: string } }).entry.id;
  const secondId = (await second.json() as { entry: { id: string } }).entry.id;
  expect(firstId).not.toBe(secondId);
  expect((await request.patch(`${API}/api/v1/medicine-cabinet/${firstId}`, { headers: { Authorization: `Bearer ${bobToken}` }, data: { quantity: '99' } })).status()).toBe(404);

  await page.goto('/my-cabinet');
  await expect(page.getByText('Fictional cabinet lot A')).toBeVisible();
  await page.getByText('Fictional cabinet lot A').locator('xpath=ancestor::article[1]').getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Quantity').fill('14');
  await page.getByLabel('Usage information').fill('Fictional cabinet lot A edited');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Fictional cabinet lot A edited')).toBeVisible();
  await page.reload(); await expect(page.getByText('Fictional cabinet lot A edited')).toBeVisible();

  const reminder = await request.post(`${API}/api/v1/reminders`, { headers, data: {
    medicine_id: firstId, medicine_name: 'Synthetic Alpha schedule', dosage: 'Fictional label only', scheduled_time: '09:00', recurrence: 'daily' } });
  expect(reminder.status()).toBe(201);
  const reminderId = (await reminder.json() as { reminder: { id: string } }).reminder.id;
  expect((await request.post(`${API}/api/v1/reminders`, { headers, data: { medicine_name: 'Bad time', scheduled_time: '27:90' } })).status()).toBe(400);
  expect((await request.get(`${API}/api/v1/reminders/${reminderId}`, { headers: { Authorization: `Bearer ${bobToken}` } })).status()).toBe(404);

  await page.goto('/reminders');
  await page.getByRole('button', { name: 'Edit reminder for Synthetic Alpha schedule' }).click();
  await page.getByLabel('Medicine Name or Schedule Label *').fill('Synthetic Alpha schedule edited');
  await page.getByLabel('Primary Scheduled Time *').fill('10:30');
  await page.getByRole('button', { name: 'Update reminder' }).click();
  await expect(page.getByText('Synthetic Alpha schedule edited').first()).toBeVisible();
  await page.getByRole('button', { name: 'Mark dose taken for Synthetic Alpha schedule edited' }).click();
  await expect(page.getByText(/Last taken/)).toBeVisible();
  await expect(page.getByText('Recent Dose Activity')).toBeVisible();
  const fixedDose = { status: 'skipped', dose_time: '2026-11-22T12:00:00.000Z' };
  expect((await request.post(`${API}/api/v1/reminders/${reminderId}/doses`, { headers, data: fixedDose })).status()).toBe(200);
  expect((await request.post(`${API}/api/v1/reminders/${reminderId}/doses`, { headers, data: fixedDose })).status()).toBe(200);
  expect((await request.post(`${API}/api/v1/reminders/${reminderId}/doses`, {
    headers: { Authorization: `Bearer ${bobToken}` }, data: fixedDose })).status()).toBe(404);
  expect((await request.post(`${API}/api/v1/reminders/00000000-0000-4000-8000-000000000099/doses`, {
    headers, data: fixedDose })).status()).toBe(404);
  const recentDoses = await request.get(`${API}/api/v1/reminders/doses/recent?limit=10`, { headers });
  expect(recentDoses.status()).toBe(200);
  expect((await recentDoses.json() as { items: unknown[] }).items).toHaveLength(2);
  await page.getByRole('button', { name: 'Pause reminder for Synthetic Alpha schedule edited' }).click();
  await expect(page.getByText('Paused').first()).toBeVisible();

  expect((await request.delete(`${API}/api/v1/medicine-cabinet/${firstId}`, { headers })).status()).toBe(204);
  const preservedReminder = await request.get(`${API}/api/v1/reminders/${reminderId}`, { headers });
  expect((await preservedReminder.json() as { reminder: { medicine_id: string | null } }).reminder.medicine_id).toBeNull();
  await page.getByRole('button', { name: 'Delete reminder for Synthetic Alpha schedule edited' }).click();
  await page.getByRole('button', { name: 'Confirm deletion' }).click();
  await expect(page.getByText('Synthetic Alpha schedule edited')).toHaveCount(0);
  expect((await request.delete(`${API}/api/v1/medicine-cabinet/${secondId}`, { headers })).status()).toBe(204);

  await page.goto('/medicine-library');
  await page.getByLabel('Search medicines').fill('Alpha 250');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Synthetic Fixture Alpha 250 mg Tablet').first()).toBeVisible();
  await page.getByLabel('Search medicines').fill('No Such Fictional Medicine');
  await page.keyboard.press('Enter');
  await expect(page.getByText(/No catalogue entries matched/i)).toBeVisible();
  expect((await request.get(`${API}/api/v1/medicines/not-a-uuid`, { headers })).status()).toBe(400);

  await page.goto(`/compare-medicines?a=${medicineOne}&b=${medicineTwo}&source=official_catalogue`);
  await expect(page.getByText('Synthetic Fixture Alpha 250 mg Tablet').first()).toBeVisible();
  await page.reload(); await expect(page).toHaveURL(new RegExp(`a=${medicineOne}.*b=${medicineTwo}`));
  await page.goBack(); await page.goForward();
  await page.goto(`/compare-medicines?a=${incompleteMedicine}&b=${medicineTwo}&source=official_catalogue`);
  await expect(page.getByText(/Not available|Unknown/i).first()).toBeVisible();

  for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await page.goto(`/compare-medicines?a=${medicineOne}&b=${medicineTwo}&source=official_catalogue`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  }
  const cleanup = await request.post(`${API}/__acceptance/cleanup`, { headers });
  expect(cleanup.status()).toBe(200);
  expect(browserErrors).toEqual([]);
});
