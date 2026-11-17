import { expect, test } from '@playwright/test';

const prescriptionId = '10000000-0000-4000-8000-000000000001';
const jobId = '20000000-0000-4000-8000-000000000002';
const userId = '00000000-0000-4000-8000-000000000001';
const longMedicineName = 'FictionalMedicineNameThatWrapsAtMobileWidthsWithoutSpaces';

test('completed results remain readable without horizontal overflow on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.addInitScript(({ userId }) => {
    window.localStorage.setItem('sb-mock-auth-token', JSON.stringify({
      access_token: 'synthetic-access-token',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: 4_102_444_800,
      refresh_token: 'synthetic-refresh-token',
      user: {
        id: userId,
        aud: 'authenticated',
        role: 'authenticated',
        email: 'synthetic@example.test',
        app_metadata: { provider: 'email', providers: ['email'] },
        user_metadata: {},
      },
    }));
  }, { userId });

  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/auth/me') {
      await route.fulfill({ json: { user: { id: userId, email: 'synthetic@example.test' } } });
      return;
    }
    if (path === `/api/v1/prescriptions/${prescriptionId}/results`) {
      await route.fulfill({
        json: {
          schema_version: '1.0',
          job_id: jobId,
          prescription_id: prescriptionId,
          status: 'completed',
          prescription: {
            prescription_date: null,
            doctor: { name: null, registration_number: null },
            facility: { name: null, address: null, phone: null },
          },
          patient: { name: null, age: null, gender: null },
          medicines: [{
            sequence_number: 1,
            extraction: {
              raw_text: `${longMedicineName} 0.5 mg`,
              medicine_name: longMedicineName,
              medicine_name_normalized: longMedicineName.toLowerCase(),
              strength: { value: 0.5, unit: 'mg' },
              dosage_form: 'tablet',
              frequency: { type: 'scheduled', times_per_day: 1 },
              timing: null,
              duration: { value: 5, unit: 'days' },
              quantity: { value: 5, unit: 'tablets' },
              instructions: null,
            },
            confidence: { extraction: 0.91, medicine_name: 0.9 },
            medicine_match: {
              status: 'matched',
              confidence: 0.9,
              medicine_external_id: 'synthetic-catalog-entry',
              brand_name: longMedicineName,
              dosage_form: 'tablet',
              ingredients: [],
            },
            derived: { units_per_day: 1, estimated_total_units: 5 },
            alternatives: [],
          }],
          recommendations: [],
          warnings: [],
          processing_metadata: { overall_confidence: 0.9 },
        },
      });
      return;
    }
    if (path === `/api/v1/prescriptions/${prescriptionId}/processing-status`) {
      await route.fulfill({
        json: {
          prescription_id: prescriptionId,
          processing: {
            job_id: jobId,
            status: 'completed',
            created_at: '2026-11-12T10:00:00Z',
            started_at: '2026-11-12T10:01:00Z',
            completed_at: '2026-11-12T10:02:00Z',
          },
        },
      });
      return;
    }
    if (path === `/api/v1/prescriptions/${prescriptionId}`) {
      await route.fulfill({
        json: {
          prescription: {
            id: prescriptionId,
            file_type: 'application/pdf',
            file_size_bytes: '51200',
            status: 'completed',
            prescription_date: null,
            created_at: '2026-11-12T10:00:00Z',
            updated_at: '2026-11-12T10:02:00Z',
            processed_at: '2026-11-12T10:02:00Z',
          },
        },
      });
      return;
    }
    await route.fulfill({ status: 404, json: { error: { code: 'NOT_FOUND', message: 'Not found.' } } });
  });

  await page.goto(`/prescriptions/${prescriptionId}`);
  await expect(page.getByRole('heading', { name: longMedicineName })).toBeVisible();
  await expect(page.getByText('0.5 mg', { exact: true })).toBeVisible();

  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
});
