import { expect, test, type Page, type Route } from '@playwright/test';

const userId = '10000000-0000-4000-8000-000000000001';
const email = 'synthetic.user@example.test';
const password = 'Synthetic-password-123!';

const prescription1 = '10000000-0000-4000-8000-000000000010';
const prescription2 = '10000000-0000-4000-8000-000000000020';

function base64Url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function accessToken(): string {
  const now = Math.floor(Date.now() / 1000);
  return `${base64Url({ alg: 'HS256', typ: 'JWT' })}.${base64Url({ sub: userId, email, aud: 'authenticated', role: 'authenticated', iat: now, exp: now + 3600 })}.synthetic-signature`;
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

const sampleResult = {
  schema_version: '1.0',
  job_id: '30000000-0000-4000-8000-000000000001',
  prescription_id: prescription1,
  status: 'completed_with_warnings',
  prescription: {
    prescription_date: '2026-11-12',
    doctor: { name: 'Dr. Evelyn Reed', registration_number: 'MD-8831' },
    facility: { name: 'Apollo Health Center', phone: '+1-555-4321' },
  },
  patient: { name: 'Jane Doe', age: 34, gender: 'Female' },
  medicines: [
    {
      sequence_number: 1,
      extraction: {
        raw_text: 'Amoxicillin 500mg, 1 cap TID x 7d',
        medicine_name: 'Amoxicillin',
        medicine_name_normalized: 'amoxicillin',
        strength: { value: 500, unit: 'mg' },
        dosage_form: 'capsule',
        frequency: { type: 'scheduled', times_per_day: 3 },
        timing: 'after meals',
        instructions: 'Take with food',
      },
      confidence: { extraction: 0.94, medicine_name: 0.97 },
      medicine_match: {
        status: 'matched',
        confidence: 0.96,
        brand_name: 'Amoxil',
        ingredients: [{ name: 'amoxicillin', strength_value: 500, strength_unit: 'mg' }],
      },
    },
    {
      sequence_number: 2,
      extraction: {
        raw_text: 'Metf... 850 mg ? bedtime',
        medicine_name: null,
        strength: { value: 850, unit: 'mg' },
        dosage_form: 'tablet',
        frequency: { type: 'unknown' },
        timing: 'bedtime',
        instructions: null,
      },
      confidence: { extraction: 0.55 },
      medicine_match: {
        status: 'ambiguous',
        confidence: 0.5,
        brand_name: null,
        ingredients: [],
      },
    },
  ],
  warnings: [
    {
      code: 'LOW_OCR_CONFIDENCE',
      severity: 'medium',
      message: 'Line 2 handwriting has low recognition confidence.',
      related_medicine_sequence_number: 2,
    },
  ],
  processing_metadata: {
    overall_confidence: 0.72,
    dataset_version: '2026.11',
    model_version: 'meddecode-ocr-1.0',
  },
};

async function installMocks(page: Page) {
  let prescription1Status = 'completed_with_warnings';
  let prescription2Status = 'queued';

  await page.route('https://mock.supabase.test/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/auth/v1/token')) return json(route, 200, authPayload());
    return json(route, 404, {});
  });

  await page.route('http://127.0.0.1:5174/backend/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/backend', '');

    if (path === '/api/v1/auth/me') {
      return json(route, 200, { user: { id: userId, email } });
    }

    if (path === '/api/v1/prescriptions') {
      return json(route, 200, {
        items: [
          {
            id: prescription1,
            file_type: 'application/pdf',
            file_size_bytes: '51200',
            status: prescription1Status,
            prescription_date: '2026-11-12',
            created_at: '2026-11-12T10:00:00Z',
            updated_at: '2026-11-12T10:05:00Z',
            processed_at: '2026-11-12T10:05:00Z',
          },
          {
            id: prescription2,
            file_type: 'image/jpeg',
            file_size_bytes: '1048576',
            status: prescription2Status,
            prescription_date: null,
            created_at: '2026-11-12T11:00:00Z',
            updated_at: '2026-11-12T11:00:00Z',
            processed_at: null,
          },
        ],
        pagination: { limit: 20, offset: 0, returned: 2, has_more: false, next_offset: null },
      });
    }

    if (path === `/api/v1/prescriptions/${prescription1}`) {
      return json(route, 200, {
        prescription: {
          id: prescription1,
          file_type: 'application/pdf',
          file_size_bytes: '51200',
          status: prescription1Status,
          prescription_date: '2026-11-12',
          created_at: '2026-11-12T10:00:00Z',
          updated_at: '2026-11-12T10:05:00Z',
          processed_at: '2026-11-12T10:05:00Z',
        },
      });
    }

    if (path === `/api/v1/prescriptions/${prescription2}`) {
      return json(route, 200, {
        prescription: {
          id: prescription2,
          file_type: 'image/jpeg',
          file_size_bytes: '1048576',
          status: prescription2Status,
          prescription_date: null,
          created_at: '2026-11-12T11:00:00Z',
          updated_at: '2026-11-12T11:00:00Z',
          processed_at: null,
        },
      });
    }

    if (path === `/api/v1/prescriptions/${prescription1}/processing-status`) {
      return json(route, 200, {
        prescription_id: prescription1,
        processing: {
          job_id: '30000000-0000-4000-8000-000000000001',
          status: 'completed',
          created_at: '2026-11-12T10:00:00Z',
          started_at: '2026-11-12T10:01:00Z',
          completed_at: '2026-11-12T10:05:00Z',
        },
      });
    }

    if (path === `/api/v1/prescriptions/${prescription2}/processing-status`) {
      return json(route, 200, {
        prescription_id: prescription2,
        processing: {
          job_id: '30000000-0000-4000-8000-000000000002',
          status: prescription2Status,
          created_at: '2026-11-12T11:00:00Z',
          started_at: null,
          completed_at: null,
        },
      });
    }

    if (path === `/api/v1/prescriptions/${prescription1}/results`) {
      return json(route, 200, sampleResult);
    }

    if (path === `/api/v1/prescriptions/${prescription2}/results`) {
      return json(route, 409, {
        error: { code: 'PROCESSING_PENDING', message: 'Prescription processing is not complete.' },
      });
    }

    if (path === '/api/v1/prescriptions/upload' && route.request().method() === 'POST') {
      return json(route, 201, {
        prescription_id: '10000000-0000-4000-8000-000000000099',
        upload: { state: 'stored', mime_type: 'application/pdf', size_bytes: 4096 },
        processing: { requested: false, job_id: null },
      });
    }

    return json(route, 404, { error: 'not found' });
  });

  return {
    setPrescription1Status: (s: string) => { prescription1Status = s; },
    setPrescription2Status: (s: string) => { prescription2Status = s; },
  };
}

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page).toHaveURL(/\/home$/);
}

test('normal prescription UI: history, results, uncertain OCR, and upload-to-detail flow', async ({ page }) => {
  await installMocks(page);
  await signIn(page);

  // 1. Authenticated navigation to /prescriptions
  await page.goto('/prescriptions');
  await expect(page).toHaveURL(/\/prescriptions$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Prescriptions' })).toBeVisible();
  await expect(page.getByText(prescription1)).toBeVisible();
  await expect(page.getByText(prescription2)).toBeVisible();

  // 2. Click to open prescription 1 (completed with warnings)
  await page.getByText(prescription1).click();
  await expect(page).toHaveURL(new RegExp(`/prescriptions/${prescription1}$`));
  await expect(page.getByRole('heading', { level: 1, name: /Prescription Details & Results/ })).toBeVisible();

  // 3. Verify status, uncertain OCR banner, and metadata
  await expect(page.getByText('Completed with warnings')).toBeVisible();
  await expect(page.getByRole('status', { name: 'OCR recognition alert' })).toBeVisible();
  await expect(page.getByText('Dr. Evelyn Reed')).toBeVisible();
  await expect(page.getByText('Apollo Health Center')).toBeVisible();

  // 4. Verify recognized medicine cards and unverified medicine warnings
  await expect(page.getByRole('heading', { name: 'Recognized Medicines (2)' })).toBeVisible();
  await expect(page.getByText('Amoxicillin')).toBeVisible();
  await expect(page.getByText('500 mg')).toBeVisible();
  await expect(page.getByText('Unverified medicine name')).toBeVisible();
  await expect(page.getByText('Ambiguous match')).toBeVisible();
  await expect(page.getByText('LOW_OCR_CONFIDENCE')).toBeVisible();

  // 5. Navigate to prescription 2 (queued / pending processing)
  await page.goto(`/prescriptions/${prescription2}`);
  await expect(page.getByText('Queued')).toBeVisible();
  await expect(page.getByText('This prescription is in the analysis queue')).toBeVisible();
  // Ensure pending prescription does NOT display medicine cards
  await expect(page.getByText('Recognized Medicines')).toHaveCount(0);
  await expect(page.getByText('Amoxicillin')).toHaveCount(0);

  // 6. Verify upload-to-detail navigation workflow
  await page.goto('/upload-prescription');
  await page.getByLabel('Choose prescription file').setInputFiles({
    name: 'sample.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('test prescription bytes'),
  });
  await page.getByRole('button', { name: 'Upload prescription' }).click();
  await expect(page.getByText('10000000-0000-4000-8000-000000000099')).toBeVisible();
  const detailLink = page.getByRole('link', { name: /View prescription & results/i });
  await expect(detailLink).toBeVisible();
  await detailLink.click();
  await expect(page).toHaveURL(/\/prescriptions\/10000000-0000-4000-8000-000000000099$/);
});
