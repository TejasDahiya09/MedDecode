import { expect, test, type Route } from '@playwright/test';
import { existsSync } from 'node:fs';

const prescriptionId = 'f1000000-0000-4000-8000-000000000001';
const ownerId = '10000000-0000-4000-8000-000000000001';
const fixture = 'C:\\Users\\dahiy\\MedDecode\\tmp\\phase1d4-scanned.pdf';
const storageRoot = 'C:\\Users\\dahiy\\MedDecode\\tmp\\rc1b-documents';
let ownerToken = '';

async function json(route: Route, status: number, body: object): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

test('browser upload reaches genuine supervised OCR, review, confirmation and history', async ({ page, request }) => {
  test.setTimeout(180_000);
  const metadata = test.info().config.metadata as { phase1fAliceSecret: string; phase1fBobSecret: string };
  await page.route('**/auth/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/token')) {
      const signedIn = await request.post('http://127.0.0.1:3011/__acceptance/auth/sign-in', { data: { account: 'alice', secret: metadata.phase1fAliceSecret } });
      expect(signedIn.status()).toBe(200);
      const local = await signedIn.json() as { token: string; user: { id: string; email: string } };
      ownerToken = local.token;
      return json(route, 200, { access_token: local.token, token_type: 'bearer', expires_in: 3600, refresh_token: 'rc1b-local-refresh',
        user: { id: local.user.id, email: local.user.email, aud: 'authenticated', role: 'authenticated', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), app_metadata: {}, user_metadata: {}, identities: [] } });
    }
    if (path.endsWith('/user')) return json(route, 200, { id: ownerId, email: 'alice@synthetic.invalid' });
    return json(route, 404, {});
  });

  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill('alice@synthetic.invalid');
  await page.getByRole('textbox', { name: 'Password' }).fill(metadata.phase1fAliceSecret);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
  await page.goto('/upload-prescription');
  await page.getByLabel('Choose prescription file').setInputFiles(fixture);
  await page.getByRole('button', { name: 'Upload prescription' }).click();
  await expect(page).toHaveURL(new RegExp(`/prescriptions/${prescriptionId}`));

  await expect.poll(async () => (await request.get(`http://127.0.0.1:3011/api/v1/prescriptions/${prescriptionId}/review`, { headers: { Authorization: `Bearer ${ownerToken}` } })).status(), { timeout: 120_000 }).toBe(200);
  const before = await request.get(`http://127.0.0.1:3011/api/v1/prescriptions/${prescriptionId}/results`, { headers: { Authorization: `Bearer ${ownerToken}` } });
  expect(before.status()).toBe(404);
  const initialEvidence = await request.get(`http://127.0.0.1:3011/__acceptance/prescriptions/${prescriptionId}/runtime-evidence`, { headers: { Authorization: `Bearer ${ownerToken}` } });
  expect(initialEvidence.status()).toBe(200);
  expect(await initialEvidence.json()).toEqual({ job_status: 'completed', attempt_count: 1, claim_generation: '1', heartbeat_recorded: true,
    evidence_count: 1, review_count: 1, result_count: 0 });

  await page.goto(`/prescriptions/${prescriptionId}/review`);
  await expect(page.getByRole('heading', { level: 1, name: 'Review & Edit Prescription' })).toBeVisible();
  const medicineNames = page.getByRole('textbox', { name: /Medicine Name/ });
  await expect.poll(() => medicineNames.count()).toBeGreaterThan(0);
  await expect(medicineNames.first()).not.toHaveValue('');
  await page.getByRole('button', { name: 'Confirm prescription review' }).first().click();
  await page.getByLabel('Confirmation statement checkbox').check();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm Review' }).click();
  await expect(page).toHaveURL(new RegExp(`/prescriptions/${prescriptionId}$`));
  const finalize = await page.evaluate(async ({ id, token }) => {
    const response = await fetch(`/__acceptance/prescriptions/${id}/finalize`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    return { status: response.status, body: await response.json() };
  }, { id: prescriptionId, token: ownerToken });
  expect(finalize.status).toBe(200);
  expect(finalize.body.result.status).toMatch(/^completed/);

  await page.reload();
  await expect(page.getByText(/Examplemed/i).first()).toBeVisible();
  const history = await request.get(`http://127.0.0.1:3011/__acceptance/prescriptions/${prescriptionId}/result-history`, { headers: { Authorization: `Bearer ${ownerToken}` } });
  expect(history.status()).toBe(200);
  expect((await history.json()).results).toHaveLength(1);
  const finalEvidence = await request.get(`http://127.0.0.1:3011/__acceptance/prescriptions/${prescriptionId}/runtime-evidence`, { headers: { Authorization: `Bearer ${ownerToken}` } });
  expect((await finalEvidence.json()).result_count).toBe(1);
  const preview = await request.get(`http://127.0.0.1:3011/api/v1/prescriptions/${prescriptionId}/document/preview`, { headers: { Authorization: `Bearer ${ownerToken}` } });
  expect(preview.status()).toBe(200); expect(preview.headers()['content-type']).toContain('application/pdf');
  expect((await preview.body()).byteLength).toBeGreaterThan(0);
  expect((await request.get(`http://127.0.0.1:3011/api/v1/prescriptions/${prescriptionId}/document/preview`)).status()).toBe(401);
  const bob = await request.post('http://127.0.0.1:3011/__acceptance/auth/sign-in', { data: { account: 'bob', secret: metadata.phase1fBobSecret } });
  const bobToken = (await bob.json() as { token: string }).token;
  expect((await request.get(`http://127.0.0.1:3011/api/v1/prescriptions/${prescriptionId}/review`, { headers: { Authorization: `Bearer ${bobToken}` } })).status()).toBe(404);
  await page.goto('/prescriptions'); await page.getByRole('link', { name: /PDF Prescription.*View analysis/ }).click();
  await page.goBack(); await expect(page).toHaveURL(/\/prescriptions$/); await page.goForward();
  await expect(page.getByText(/Examplemed/i).first()).toBeVisible();

  const ownerHeaders = { Authorization: `Bearer ${ownerToken}` };
  const catalogue = await request.get('http://127.0.0.1:3011/api/v1/medicines/browse?limit=24&offset=0', { headers: ownerHeaders });
  expect(catalogue.status()).toBe(200);
  const catalogueBody = await catalogue.json() as { items: Array<{ id: string; canonical_name: string }>; pagination: { total: number } };
  expect(catalogueBody.pagination.total).toBe(4);
  expect(catalogueBody.items[0]?.canonical_name).toContain('Synthetic Fixture');
  const medicineId = catalogueBody.items[0]!.id;
  const cabinetCreate = await request.post('http://127.0.0.1:3011/api/v1/medicine-cabinet', {
    headers: ownerHeaders,
    data: { medicine_id: medicineId, quantity: '12', usage_information: 'Synthetic demonstration inventory only' },
  });
  expect(cabinetCreate.status()).toBe(201);
  const cabinetId = (await cabinetCreate.json() as { entry: { id: string } }).entry.id;
  const cabinetList = await request.get('http://127.0.0.1:3011/api/v1/medicine-cabinet', { headers: ownerHeaders });
  expect((await cabinetList.json() as { items: unknown[] }).items).toHaveLength(1);
  const bobCabinet = await request.get('http://127.0.0.1:3011/api/v1/medicine-cabinet', { headers: { Authorization: `Bearer ${bobToken}` } });
  expect((await bobCabinet.json() as { items: unknown[] }).items).toHaveLength(0);

  const reminderCreate = await request.post('http://127.0.0.1:3011/api/v1/reminders', {
    headers: ownerHeaders,
    data: { medicine_id: cabinetId, medicine_name: 'Synthetic Fixture Alpha', dosage: 'Demonstration label only', scheduled_time: '09:00', recurrence: 'daily' },
  });
  expect(reminderCreate.status()).toBe(201);
  const reminderId = (await reminderCreate.json() as { reminder: { id: string } }).reminder.id;
  const crossOwnerReminder = await request.post('http://127.0.0.1:3011/api/v1/reminders', {
    headers: { Authorization: `Bearer ${bobToken}` },
    data: { medicine_id: cabinetId, medicine_name: 'Forbidden cross owner', scheduled_time: '10:00', recurrence: 'daily' },
  });
  expect(crossOwnerReminder.status()).toBeGreaterThanOrEqual(400);
  const dose = await request.post(`http://127.0.0.1:3011/api/v1/reminders/${reminderId}/doses`, {
    headers: ownerHeaders, data: { status: 'taken', dose_time: '2026-11-22T09:00:00.000Z' },
  });
  expect(dose.status()).toBe(200);
  const duplicateDose = await request.post(`http://127.0.0.1:3011/api/v1/reminders/${reminderId}/doses`, {
    headers: ownerHeaders, data: { status: 'taken', dose_time: '2026-11-22T09:00:00.000Z' },
  });
  expect(duplicateDose.status()).toBe(200);
  const recent = await request.get('http://127.0.0.1:3011/api/v1/reminders/doses/recent', { headers: ownerHeaders });
  expect((await recent.json() as { items: unknown[] }).items).toHaveLength(1);

  await page.goto('/my-cabinet');
  await expect(page.getByText('Synthetic demonstration inventory only')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Synthetic demonstration inventory only')).toBeVisible();
  await page.goto('/reminders');
  await expect(page.getByText('Synthetic Fixture Alpha').first()).toBeVisible();
  await page.goto('/medicine-library');
  await expect(page.getByText('Synthetic Fixture Alpha 250 mg Tablet').first()).toBeVisible();
  await page.goto(`/compare-medicines?a=${catalogueBody.items[0]!.id}&b=${catalogueBody.items[1]!.id}&source=official_catalogue`);
  await expect(page.getByRole('heading', { name: 'Compare Medicines' })).toBeVisible();
  await expect(page.getByText('Synthetic Fixture Alpha 250 mg Tablet').first()).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/my-cabinet');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await expect(page.getByRole('button', { name: /Add medicine/i }).first()).toBeVisible();

  const cleanup = await request.post('http://127.0.0.1:3011/__acceptance/cleanup', { headers: { Authorization: `Bearer ${ownerToken}` } });
  expect(cleanup.status()).toBe(200);
  expect(existsSync(storageRoot)).toBe(false);
});
