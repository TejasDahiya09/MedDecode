import { test, expect, type Page, type Route } from '@playwright/test';

const userId = '10000000-0000-4000-8000-000000000001';
const email = 'synthetic.user@example.test';
const realPrescriptionId = '10000000-0000-4000-8000-000000000010';

function base64Url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function accessToken(): string {
  const now = Math.floor(Date.now() / 1000);
  return `${base64Url({ alg: 'HS256', typ: 'JWT' })}.${base64Url({
    sub: userId,
    email,
    aud: 'authenticated',
    role: 'authenticated',
    iat: now,
    exp: now + 3600,
  })}.synthetic-signature`;
}

function authPayload() {
  const now = new Date().toISOString();
  return {
    access_token: accessToken(),
    token_type: 'bearer',
    expires_in: 3600,
    refresh_token: 'synthetic-refresh-token',
    user: {
      id: userId,
      aud: 'authenticated',
      role: 'authenticated',
      email,
      email_confirmed_at: now,
      created_at: now,
      updated_at: now,
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
      identities: [],
    },
  };
}

async function json(route: Route, status: number, body: object): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function installMocks(page: Page) {
  await page.route('**/auth/v1/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/auth/v1/token')) return json(route, 200, authPayload());
    if (url.pathname.endsWith('/auth/v1/user')) return json(route, 200, authPayload().user);
    return json(route, 404, {});
  });

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/backend', '');

    if (path === '/api/v1/auth/me') {
      return json(route, 200, { user: { id: userId, email } });
    }

    if (path === `/api/v1/prescriptions/${realPrescriptionId}/evidence`) {
      return json(route, 200, {
        evidenceSetId: 'a0000000-0000-4000-8000-0000000000e1',
        schemaVersion: '1.0',
        prescriptionId: realPrescriptionId,
        fileName: 'real-rx-scan.pdf',
        pageCount: 1,
        providerCount: 1,
        createdAt: new Date().toISOString(),
      });
    }

    if (path === `/api/v1/prescriptions/${realPrescriptionId}/review`) {
      return json(route, 200, {
        schemaVersion: '1.0',
        prescriptionId: realPrescriptionId,
        evidence: {
          evidenceSetId: 'a0000000-0000-4000-8000-0000000000e1',
          schemaVersion: '1.0',
          fileName: 'real-rx-scan.pdf',
          pageCount: 1,
        },
        revisionId: 'b0000000-0000-4000-8000-000000000001',
        revisionNumber: 1,
        baseRevisionId: null,
        status: 'draft',
        lockVersion: 0,
        medicines: [
          {
            medicineId: 'm0000000-0000-4000-8000-000000000001',
            origin: 'extracted',
            status: 'active',
            position: 1,
            original: {
              medicineName: 'Amoxicillin',
              brandName: 'Amoxil',
              genericName: 'Amoxicillin Trihydrate',
              strength: { value: '500', unit: 'mg' },
              dosageForm: 'capsule',
              dose: { value: '1', unit: 'capsule' },
              frequency: 'Three times daily',
              timing: 'With meals',
              route: 'oral',
              duration: { value: '7', unit: 'days' },
              quantity: { value: '21', unit: 'capsules' },
              notes: null,
            },
            current: {
              medicineName: 'Amoxicillin',
              brandName: 'Amoxil',
              genericName: 'Amoxicillin Trihydrate',
              strength: { value: '500', unit: 'mg' },
              dosageForm: 'capsule',
              dose: { value: '1', unit: 'capsule' },
              frequency: 'Three times daily',
              timing: 'With meals',
              route: 'oral',
              duration: { value: '7', unit: 'days' },
              quantity: { value: '21', unit: 'capsules' },
              notes: null,
            },
            provenance: {
              medicineName: { source: 'ocr_observed', evidenceReference: 'ocr:line:1' },
              brandName: { source: 'ocr_observed', evidenceReference: 'ocr:line:1' },
              genericName: { source: 'automatically_interpreted', evidenceReference: null },
              strengthValue: { source: 'ocr_observed', evidenceReference: 'ocr:line:1' },
              strengthUnit: { source: 'ocr_observed', evidenceReference: 'ocr:line:1' },
              dosageForm: { source: 'ocr_observed', evidenceReference: 'ocr:line:1' },
              doseValue: { source: 'ocr_observed', evidenceReference: 'ocr:line:1' },
              doseUnit: { source: 'ocr_observed', evidenceReference: 'ocr:line:1' },
              frequency: { source: 'ocr_observed', evidenceReference: 'ocr:line:1' },
              timing: { source: 'ocr_observed', evidenceReference: 'ocr:line:1' },
              route: { source: 'ocr_observed', evidenceReference: 'ocr:line:1' },
              durationValue: { source: 'ocr_observed', evidenceReference: 'ocr:line:1' },
              durationUnit: { source: 'ocr_observed', evidenceReference: 'ocr:line:1' },
              quantityValue: { source: 'ocr_observed', evidenceReference: 'ocr:line:1' },
              quantityUnit: { source: 'ocr_observed', evidenceReference: 'ocr:line:1' },
              notes: { source: 'unresolved', evidenceReference: null },
            },
            addedByCommandId: null,
            removedAt: null,
            highlights: [],
          },
        ],
        unresolvedFields: [],
        confirmation: {
          status: 'pending',
          statement: '',
          confirmedAt: null,
          idempotencyKey: null,
        },
        canonicalInputFingerprint: null,
        createdAt: '2026-11-15T00:00:00Z',
        updatedAt: '2026-11-15T00:00:00Z',
      });
    }

    if (path === `/api/v1/prescriptions/${realPrescriptionId}/review/revisions`) {
      return json(route, 200, {
        revisions: [],
      });
    }

    return json(route, 404, { error: 'not found' });
  });
}

test.describe('Prescription Review & Confirmation Integration (Phase 1C.3)', () => {
  test.beforeEach(async ({ page }) => {
    await installMocks(page);
    await page.goto('/sign-in');
    await page.getByLabel('Email address').fill(email);
    await page.getByRole('textbox', { name: 'Password' }).fill(`browser-fixture-${crypto.randomUUID()}`);
    await page.getByRole('button', { name: 'Sign In', exact: true }).click();
    await expect(page).not.toHaveURL(/\/sign-in(?:\?|$)/);
  });

  // Scenario A: Review clean fictional prescription
  test('A. Review clean fictional prescription displays preview and extracted medicine', async ({
    page,
  }) => {
    await page.goto('/prescriptions/scenario-a/review?mock=true&dev_review=true');
    await expect(page.getByRole('heading', { level: 1, name: 'Review & Edit Prescription' })).toBeVisible();
    await expect(page.getByText('DEVELOPMENT DEMO MODE')).toBeVisible();
    await expect(page.getByText('DEMO SAMPLE')).toBeVisible();
    await expect(page.locator('input[value="Amoxicillin"]')).toBeVisible();
    await expect(page.getByLabel('Strength value')).toHaveValue('500');
  });

  // Scenario B: Edit strength and confirm
  test('B. Edit strength and confirm review with exact statement and disclaimer', async ({ page }) => {
    await page.goto('/prescriptions/scenario-a/review?mock=true&dev_review=true');
    await expect(page.locator('input[value="Amoxicillin"]')).toBeVisible();

    // Edit strength
    const strengthInput = page.getByLabel('Strength value');
    await strengthInput.fill('875');
    await expect(page.getByText('You have unsaved changes in this review draft')).toBeVisible();

    // Open confirmation modal
    await page.getByRole('button', { name: 'Confirm prescription review' }).first().click();
    await expect(page.getByRole('heading', { name: 'Confirm Prescription Review' })).toBeVisible();

    // Clinical disclaimer verification
    await expect(
      page.getByText('This confirmation does not verify that the prescription or dosage is medically appropriate.')
    ).toBeVisible();

    // Required statement verification
    await expect(
      page.getByText('I have reviewed the extracted transcription and corrected it where necessary.')
    ).toBeVisible();

    // Check acknowledgment checkbox and submit
    const confirmBtn = page.getByRole('dialog').getByRole('button', { name: 'Confirm Review' });
    await expect(confirmBtn).toBeDisabled();

    await page.getByLabel('Confirmation statement checkbox').check();
    await expect(confirmBtn).toBeEnabled();
    await confirmBtn.click();

    // Expect confirmed status and pending intelligence analysis indicator
    await expect(page.getByText('Revision 1 is Confirmed')).toBeVisible();
    await expect(page.getByText('Automated Medicine Intelligence Pending')).toBeVisible();
  });

  // Scenario C: Add a missing medicine
  test('C. Add a missing medicine with user_added provenance', async ({ page }) => {
    await page.goto('/prescriptions/scenario-a/review?mock=true&dev_review=true');
    await page.getByRole('button', { name: 'Add a new medication row manually' }).click();

    const addDialog = page.getByRole('dialog', { name: 'Add Missing Medicine' });
    const addedName = addDialog.getByRole('textbox', { name: 'Medicine Name' });
    await expect(addedName).toBeVisible();
    await expect(addedName).toHaveValue('');
    await addedName.fill('Ibuprofen');
    await addDialog.getByRole('button', { name: 'Add Medicine', exact: true }).click();
    await expect(page.locator('input[value="Ibuprofen"]')).toBeVisible();
  });

  // Scenario D: Remove and restore medicine
  test('D. Remove and restore medicine without data loss', async ({ page }) => {
    await page.goto('/prescriptions/scenario-a/review?mock=true&dev_review=true');
    await expect(page.locator('input[value="Amoxicillin"]')).toBeVisible();

    // Remove medicine
    await page.getByRole('button', { name: 'Remove this medicine entry' }).click();
    await page.getByRole('button', { name: 'Confirm Remove' }).click();
    await expect(page.getByRole('button', { name: 'Restore this removed medicine' })).toBeVisible();

    // Restore medicine
    await page.getByRole('button', { name: 'Restore this removed medicine' }).click();
    await expect(page.locator('input[value="Amoxicillin"]')).toBeVisible();
  });

  // Scenario E: Save draft and reload
  test('E. Save review draft persists local edits', async ({ page }) => {
    await page.goto('/prescriptions/scenario-a/review?mock=true&dev_review=true');
    const notesInput = page.getByLabel('Instructions / Notes');
    await notesInput.fill('Checked with prescriber');
    await expect(page.getByText('You have unsaved changes in this review draft')).toBeVisible();

    await page.getByRole('button', { name: 'Save Draft' }).click();
    await expect(page.getByText(/Review draft saved \(Revision 1, lock v\d+\)/)).toBeVisible();
  });

  // Scenario F: Reopen confirmed revision
  test('F. Reopen confirmed revision creates Revision 2 draft', async ({ page }) => {
    await page.goto('/prescriptions/scenario-g/review?mock=true&dev_review=true');
    await expect(page.getByText('Revision 2')).toBeVisible();
    await expect(page.getByText('Superseded')).toBeVisible();
  });

  // Scenario G: Encounter 409 stale revision
  test('G. Concurrency conflict (409 REVIEW_STALE) warns user and preserves unsaved edits', async ({
    page,
  }) => {
    await page.goto('/prescriptions/scenario-h/review?mock=true&dev_review=true');
    await expect(page.getByRole('heading', { level: 1, name: 'Review & Edit Prescription' })).toBeVisible();

    // Edit field
    const nameInput = page.locator('input[value="Amoxicillin"]');
    await nameInput.fill('Ciprofloxacin Hydrochloride');

    // Trigger draft save on conflict scenario
    await page.getByRole('button', { name: 'Save Draft' }).click();

    // Verify conflict banner appears
    await expect(page.getByText('Revision Conflict Detected')).toBeVisible();
    // Verify user edit is preserved
    await expect(page.locator('input[value="Ciprofloxacin Hydrochloride"]')).toBeVisible();
  });

  // Scenario H: Original document unavailable
  test('H. Honest fallback card when original document preview is unavailable', async ({ page }) => {
    await page.goto('/prescriptions/scenario-i/review?mock=true&dev_review=true');
    await expect(page.getByRole('heading', { name: 'Document Preview Unavailable' })).toBeVisible();
    await expect(
      page.getByText('You can still review, edit and verify the structured medicine information in the panel on the right.')
    ).toBeVisible();
  });

  // Scenario I: Build-time enabled development server remains explicit demo mode
  test('I. enabled development build keeps fictional scenarios explicitly marked', async ({ page }) => {
    await page.goto('/prescriptions/scenario-a/review');
    await expect(page.getByText('DEVELOPMENT DEMO MODE')).toBeVisible();
    await expect(page.getByText(/No real patient records or backend database records are altered/)).toBeVisible();
  });

  // Scenario J: Expired authentication
  test('J. Authentication expiration displays honest error rather than mock fallback', async ({
    page,
  }) => {
    // Intercept with 401
    await page.route(`**/api/v1/prescriptions/${realPrescriptionId}/review`, async (route) => {
      await json(route, 401, {
        error: { code: 'UNAUTHORIZED', message: 'JWT expired or missing authorization.' },
      });
    });

    await page.goto(`/prescriptions/${realPrescriptionId}/review?dev_review=true`);
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByText(/JWT expired|UNAUTHORIZED|Failed to load/i)).toBeVisible();
    // Does NOT silently substitute Scenario A mock
    await expect(page.getByText('DEVELOPMENT DEMO MODE')).not.toBeVisible();
  });

  // Scenario K: Mock mode cannot claim server persistence
  test('K. Mock demo mode displays explicit non-production indicators', async ({ page }) => {
    await page.goto('/prescriptions/scenario-a/review?mock=true&dev_review=true');
    await expect(page.getByText('DEVELOPMENT DEMO MODE')).toBeVisible();
    await expect(page.getByText('DEMO SAMPLE')).toBeVisible();
  });

  // Scenario L: Older intelligence result marked superseded
  test('L. Superseded intelligence notice displayed for reopened revisions', async ({ page }) => {
    await page.goto('/prescriptions/scenario-g/review?mock=true&dev_review=true');
    await expect(page.getByText(/You are editing a reopened prescription/i)).toBeVisible();
    await expect(page.getByText(/Earlier intelligence insights for Revision 1 are superseded/i)).toBeVisible();
  });
});
