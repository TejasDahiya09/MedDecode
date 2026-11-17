import { expect, test } from '@playwright/test';
import { createClient, type Session } from '@supabase/supabase-js';
import * as path from 'node:path';

const PRESCRIPTION_ID = '9cde1d1a-e036-4c07-9f5f-cc8ec06930af';
const JOB_ID = '32e120ce-38bc-431b-b11f-0953c5b1b7e3';
const USER_EMAIL = 'dahiyatejas35@gmail.com';
const SUPABASE_URL = 'https://wyripeqruhvbksjfsvlr.supabase.co';
const SUPABASE_SECRET_KEY_ENV = 'SUPABASE_ADMIN_SECRET_KEY';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_isNV67UzKLq29lVTM7ayGA_3uzzOwcH';

const ARTIFACT_DIR = 'C:/Users/dahiy/.gemini/antigravity/brain/912def45-2b35-4b8c-8680-2ae31290b42e';

test.describe('MEDDECODE — GENUINE HOSTED PRESCRIPTION VERIFICATION (UNMOCKED)', () => {
  let session: Session | null = null;

  test.beforeAll(async () => {
    const supabaseSecretKey = process.env[SUPABASE_SECRET_KEY_ENV];
    if (!supabaseSecretKey) {
      test.skip(true, `Set ${SUPABASE_SECRET_KEY_ENV} to run this hosted verification.`);
      return;
    }

    // Generate genuine session for dahiyatejas35@gmail.com directly from hosted Supabase
    const admin = createClient(SUPABASE_URL, supabaseSecretKey);
    const linkRes = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: USER_EMAIL,
    });
    if (!linkRes.data?.properties?.hashed_token) {
      throw new Error(`Failed to generate magic link: ${JSON.stringify(linkRes.error)}`);
    }

    const pubClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
    const otpRes = await pubClient.auth.verifyOtp({
      token_hash: linkRes.data.properties.hashed_token,
      type: 'email',
    });

    if (!otpRes.data?.session) {
      throw new Error(`Failed to verify OTP: ${JSON.stringify(otpRes.error)}`);
    }
    session = otpRes.data.session;
  });

  test('Genuine hosted processing result loads correctly without mock responses', async ({ page }) => {
    if (!session) {
      throw new Error('Hosted verification session was not initialized.');
    }
    // Track all HTTP requests and responses to prove no mocking was used and verify payloads
    const capturedRequests: { method: string; url: string; postData?: string }[] = [];
    const capturedResponses: { url: string; status: number; body?: string }[] = [];

    page.on('request', (req) => {
      capturedRequests.push({
        method: req.method(),
        url: req.url(),
        postData: req.postData() ?? undefined,
      });
    });

    page.on('response', async (res) => {
      if (res.url().includes('/api/v1/')) {
        let body: string;
        try {
          body = await res.text();
        } catch {
          body = '<unreadable>';
        }
        capturedResponses.push({
          url: res.url(),
          status: res.status(),
          body,
        });
      }
    });

    // Seed the browser localStorage with the genuine authenticated Supabase session
    await page.addInitScript(({ sessionData }) => {
      window.localStorage.setItem('sb-wyripeqruhvbksjfsvlr-auth-token', JSON.stringify(sessionData));
    }, { sessionData: session });

    // 1. Navigate to the prescription details page
    await page.goto(`/prescriptions/${PRESCRIPTION_ID}`);

    // Wait for the results to load
    await expect(page.getByText('Prescription Details & Results')).toBeVisible({ timeout: 15000 });

    // 2. Verify completed_with_warnings status
    const statusBadges = page.getByText('Completed with warnings');
    await expect(statusBadges.first()).toBeVisible();

    // Verify stepper shows Completed
    await expect(page.getByRole('region', { name: 'Prescription Analysis Progress' })).toBeVisible();
    await expect(page.getByText('Results Ready')).toBeVisible();
    await expect(page.getByText('Ready with warnings')).toBeVisible();

    // Verify warning banner is displayed
    await expect(page.getByText('Completed with warnings: Uncertain OCR outcomes detected')).toBeVisible();

    // 3. Verify extracted medicine details match persisted result
    // Medicine name: Examplemed
    await expect(page.getByRole('heading', { name: 'Examplemed' })).toBeVisible();

    // Strength: 10 mg
    await expect(page.getByText('10 mg', { exact: true })).toBeVisible();

    // Dosage form: tablet
    await expect(page.getByText('tablet', { exact: true })).toBeVisible();

    // Scheduled instruction: Take one tablet once daily
    await expect(page.getByText('Take one tablet once daily')).toBeVisible();

    // Frequency: 1 time daily
    await expect(page.getByText('1 time daily')).toBeVisible();

    // 4. Verify warnings appear correctly (2 warnings)
    await expect(page.getByText('Warnings & Discrepancies (2)')).toBeVisible();
    await expect(page.getByText('LOCAL_PDF_OFFICIAL_CATALOGUE')).toBeVisible();
    await expect(page.getByText('Local PDF OCR was matched against imported official catalogue evidence; price and product-package associations are unavailable.')).toBeVisible();
    await expect(page.getByText('RECOMMENDATION_WARNING')).toBeVisible();
    await expect(page.getByText('No alternatives were ranked because medicine identity is not confirmed.')).toBeVisible();

    // Verify Job ID
    await expect(page.getByText(JOB_ID)).toBeVisible();

    // Take screenshot of Results page
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'genuine-prescription-results-live.png'),
      fullPage: true,
    });

    // 5. Verify Refresh preserves the result without duplicate job submission
    const refreshButton = page.getByRole('button', { name: 'Refresh' });
    await refreshButton.click();

    // Wait for refresh to complete (button re-enabled)
    await expect(refreshButton).toBeEnabled();

    // Result is still displayed
    await expect(page.getByRole('heading', { name: 'Examplemed' })).toBeVisible();
    await expect(page.getByText('Warnings & Discrepancies (2)')).toBeVisible();

    // 6. Verify No duplicate processing job was created (no POST to /process)
    const processRequests = capturedRequests.filter((r) =>
      r.method === 'POST' && r.url.includes('/process')
    );
    expect(processRequests.length).toBe(0);

    // 7. Verify My Prescriptions shows the correct status
    await page.goto('/prescriptions');
    await expect(page.getByRole('heading', { name: 'Prescriptions', level: 1 })).toBeVisible();

    // Find the record for this prescription
    const prescriptionRecord = page.getByRole('link', { name: new RegExp(PRESCRIPTION_ID) });
    await expect(prescriptionRecord).toBeVisible();
    await expect(prescriptionRecord.getByText('Completed with warnings')).toBeVisible();

    // Verify filter 'Completed' retains the record
    await page.getByRole('button', { name: /^Completed/ }).click();
    await expect(prescriptionRecord).toBeVisible();

    // Take screenshot of History page
    await page.screenshot({
      path: path.join(ARTIFACT_DIR, 'genuine-prescription-history-live.png'),
      fullPage: true,
    });

    // Confirm that the requests made to backend endpoints returned real data
    const resultsApiRes = capturedResponses.find((r) => r.url.includes(`/api/v1/prescriptions/${PRESCRIPTION_ID}/results`));
    expect(resultsApiRes).toBeDefined();
    expect(resultsApiRes?.status).toBe(200);
    const parsedResults = JSON.parse(resultsApiRes!.body!);
    expect(parsedResults.status).toBe('completed_with_warnings');
    expect(parsedResults.job_id).toBe(JOB_ID);
    expect(parsedResults.medicines[0].extraction.medicine_name).toBe('Examplemed');
    expect(parsedResults.warnings.length).toBe(2);
  });
});
