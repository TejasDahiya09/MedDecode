import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../../src/providers/AppProviders';
import { PrescriptionResultsPage } from '../../src/features/prescriptions/PrescriptionResultsPage';
import { createAuthTestClient, testSession } from './auth-test-client';
import type { ContractV1AnalysisResult } from '../../src/features/prescriptions/prescription-api';

const prescriptionId = '10000000-0000-4000-8000-000000000001';
const jobId = '20000000-0000-4000-8000-000000000002';

const mockPrescription = {
  id: prescriptionId,
  file_type: 'application/pdf',
  file_size_bytes: '51200',
  status: 'uploaded',
  prescription_date: '2026-11-12',
  created_at: '2026-11-12T10:00:00Z',
  updated_at: '2026-11-12T10:00:00Z',
  processed_at: null,
};

const sampleResult: ContractV1AnalysisResult = {
  schema_version: '1.0',
  job_id: jobId,
  prescription_id: prescriptionId,
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
        duration: { value: 7, unit: 'days' },
        quantity: { value: 21, unit: 'capsules' },
        instructions: 'Take with food',
      },
      confidence: { extraction: 0.94, medicine_name: 0.97 },
      medicine_match: {
        status: 'matched',
        confidence: 0.96,
        medicine_external_id: 'catalog-001',
        brand_name: 'Amoxil',
        dosage_form: 'capsule',
        ingredients: [{ name: 'amoxicillin', strength_value: 500, strength_unit: 'mg' }],
      },
      alternatives: [],
      derived: { units_per_day: 3, estimated_total_units: 21 },
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
        duration: { value: null, unit: null },
        quantity: { value: null, unit: null },
        instructions: null,
      },
      confidence: { extraction: 0.55 },
      medicine_match: {
        status: 'ambiguous',
        confidence: 0.5,
        medicine_external_id: null,
        brand_name: null,
        dosage_form: null,
        ingredients: [],
      },
      alternatives: [],
      derived: { units_per_day: null, estimated_total_units: null },
    },
  ],
  recommendations: [
    {
      type: 'review_note',
      title: 'Verify the second entry',
      message: 'The result includes an uncertain medicine name.',
      related_medicine_sequence_number: 2,
      confidence: 0.5,
    },
  ],
  warnings: [
    {
      code: 'LOW_OCR_CONFIDENCE',
      severity: 'medium',
      message: 'Line 2 handwriting has low recognition confidence.',
      related_medicine_sequence_number: 2,
    },
    {
      code: 'UNRESOLVED_MEDICINE_NAME',
      severity: 'high',
      message: 'Medicine name could not be definitively matched.',
      related_medicine_sequence_number: 2,
    },
  ],
  processing_metadata: {
    overall_confidence: 0.72,
    dataset_version: '2026.11',
    model_version: 'meddecode-ocr-1.0',
  },
};

beforeEach(() => {
  vi.stubEnv('VITE_API_BASE_URL', '/backend');
  vi.stubEnv('VITE_PRESCRIPTION_AUTO_SUBMIT_ENABLED', 'false');
  vi.stubEnv('VITE_PRESCRIPTION_AUTO_SUBMIT_BACKEND_ENABLED', 'false');
  vi.stubEnv('VITE_PRESCRIPTION_REVIEW_ENABLED', 'false');
  window.localStorage.removeItem('meddecode_dev_review_enabled');
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});

function renderResultsPage(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>, pathId = prescriptionId, state?: unknown) {
  vi.stubGlobal('fetch', fetchMock);
  return render(
    <MemoryRouter initialEntries={[{ pathname: `/prescriptions/${pathId}`, state }]}>
      <AppProviders authClient={createAuthTestClient()} initialAuthSession={testSession}>
        <Routes>
          <Route path="/prescriptions/:id" element={<PrescriptionResultsPage />} />
        </Routes>
      </AppProviders>
    </MemoryRouter>,
  );
}

describe('prescription results interface states and rendering', () => {
  it('renders uploaded status and allows submitting processing', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/me')) {
        return new Response(JSON.stringify({ user: testSession.user }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/processing-status')) {
        return new Response(JSON.stringify({ prescription_id: prescriptionId, processing: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/process')) {
        return new Response(
          JSON.stringify({
            prescription_id: prescriptionId,
            job: { id: jobId, status: 'queued', created_at: '2026-11-12T10:01:00Z' },
            submission: { created: true },
          }),
          { status: 202, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ prescription: mockPrescription }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    renderResultsPage(fetchMock);

    expect(await screen.findByText('Prescription Details & Results')).toBeTruthy();
    expect(screen.getAllByText('Uploaded').length).toBeGreaterThan(0);
    expect(screen.getByText(/processing have not been run/i)).toBeTruthy();

    const startButton = screen.getByRole('button', { name: /Start OCR & Analysis/i });
    expect(startButton).toBeTruthy();
    fireEvent.click(startButton);

    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([callUrl]) => String(callUrl).endsWith('/process'))).toBe(true);
    });
  });

  it('does not resubmit a confirmed automatic upload and reads its authorized status', async () => {
    vi.stubEnv('VITE_PRESCRIPTION_AUTO_SUBMIT_ENABLED', 'true');
    vi.stubEnv('VITE_PRESCRIPTION_AUTO_SUBMIT_BACKEND_ENABLED', 'true');
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/me')) {
        return new Response(JSON.stringify({ user: testSession.user }), { headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/processing-status')) {
        return new Response(JSON.stringify({
          prescription_id: prescriptionId,
          processing: { job_id: jobId, status: 'queued', created_at: '2026-11-14T00:00:00Z', started_at: null, completed_at: null },
        }), { headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ prescription: { ...mockPrescription, status: 'queued' } }), {
        headers: { 'Content-Type': 'application/json' },
      });
    });

    renderResultsPage(fetchMock, prescriptionId, {
      uploadProcessing: { requested: true, job_id: jobId },
    });

    expect(await screen.findByText('Queued')).toBeTruthy();
    expect(await screen.findByText(new RegExp(`Automatic processing submission was confirmed for job ${jobId}`))).toBeTruthy();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/process'))).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/api/v1/prescriptions/upload'))).toBe(false);
  });

  it('reconciles an unconfirmed upload through status and the idempotent same-prescription endpoint', async () => {
    vi.stubEnv('VITE_PRESCRIPTION_AUTO_SUBMIT_ENABLED', 'true');
    vi.stubEnv('VITE_PRESCRIPTION_AUTO_SUBMIT_BACKEND_ENABLED', 'true');
    let statusCalls = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/me')) {
        return new Response(JSON.stringify({ user: testSession.user }), { headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/processing-status')) {
        statusCalls++;
        return new Response(JSON.stringify({ prescription_id: prescriptionId, processing: null }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/process')) {
        return new Response(JSON.stringify({
          prescription_id: prescriptionId,
          job: { id: jobId, status: 'queued', created_at: '2026-11-14T00:00:00Z' },
          submission: { created: false },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ prescription: mockPrescription }), {
        headers: { 'Content-Type': 'application/json' },
      });
    });

    renderResultsPage(fetchMock, prescriptionId, {
      uploadProcessing: { requested: null, job_id: null, submission: 'unconfirmed' },
    });

    expect(await screen.findByText('Queued')).toBeTruthy();
    expect(await screen.findByText(new RegExp(`An existing job \\(${jobId}\\) was confirmed`))).toBeTruthy();
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/process'))).toHaveLength(1));
    expect(statusCalls).toBe(1);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/api/v1/prescriptions/upload'))).toBe(false);
  });

  it('renders queued status correctly', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/me')) {
        return new Response(JSON.stringify({ user: testSession.user }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/processing-status')) {
        return new Response(
          JSON.stringify({
            prescription_id: prescriptionId,
            processing: {
              job_id: jobId,
              status: 'queued',
              created_at: '2026-11-12T10:01:00Z',
              started_at: null,
              completed_at: null,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          prescription: { ...mockPrescription, status: 'queued' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    renderResultsPage(fetchMock);

    expect(await screen.findByText('Queued')).toBeTruthy();
    expect(screen.getByText(/This prescription is in the analysis queue/i)).toBeTruthy();
  });

  it('renders processing in-progress status correctly', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/me')) {
        return new Response(JSON.stringify({ user: testSession.user }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/processing-status')) {
        return new Response(
          JSON.stringify({
            prescription_id: prescriptionId,
            processing: {
              job_id: jobId,
              status: 'processing',
              created_at: '2026-11-12T10:01:00Z',
              started_at: '2026-11-12T10:02:00Z',
              completed_at: null,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          prescription: { ...mockPrescription, status: 'processing' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    renderResultsPage(fetchMock);

    expect(await screen.findByText('Processing')).toBeTruthy();
    expect(screen.getByText('Analysis in progress')).toBeTruthy();
  });

  it('renders failed status with retry action', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/me')) {
        return new Response(JSON.stringify({ user: testSession.user }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/processing-status')) {
        return new Response(
          JSON.stringify({
            prescription_id: prescriptionId,
            processing: {
              job_id: jobId,
              status: 'failed',
              created_at: '2026-11-12T10:01:00Z',
              started_at: '2026-11-12T10:02:00Z',
              completed_at: '2026-11-12T10:03:00Z',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          prescription: { ...mockPrescription, status: 'failed' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    renderResultsPage(fetchMock);

    expect(await screen.findByText('Failed')).toBeTruthy();
    expect(screen.getByText(/Prescription analysis processing failed/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Retry Analysis/i })).toBeTruthy();
  });

  it('renders full analysis results with recognized medicines, strengths, and warnings', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/me')) {
        return new Response(JSON.stringify({ user: testSession.user }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/results')) {
        return new Response(JSON.stringify(sampleResult), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/processing-status')) {
        return new Response(
          JSON.stringify({
            prescription_id: prescriptionId,
            processing: {
              job_id: jobId,
              status: 'completed',
              created_at: '2026-11-12T10:01:00Z',
              started_at: '2026-11-12T10:02:00Z',
              completed_at: '2026-11-12T10:03:00Z',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          prescription: {
            ...mockPrescription,
            status: 'completed_with_warnings',
            processed_at: '2026-11-12T10:03:00Z',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    renderResultsPage(fetchMock);

    // Header and Status
    expect(await screen.findByText('Completed with warnings')).toBeTruthy();

    // Uncertain OCR Notice
    expect(screen.getByRole('status', { name: 'Analysis warnings' })).toBeTruthy();
    expect(screen.getByText('Analysis completed with warnings')).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Review & Edit/i })).toBeNull();

    // Doctor and Facility metadata
    expect(screen.getByText('Dr. Evelyn Reed')).toBeTruthy();
    expect(screen.getByText('Apollo Health Center')).toBeTruthy();
    expect(screen.getByText(/Jane Doe · Age 34/i)).toBeTruthy();

    // Recognized Medicines count and items
    expect(screen.getByText('Recognized Medicines (2)')).toBeTruthy();
    expect(screen.getByText('Amoxicillin')).toBeTruthy();
    expect(screen.getByText('500 mg')).toBeTruthy();
    expect(screen.getByText('capsule')).toBeTruthy();
    expect(screen.getByText('3 times daily')).toBeTruthy();
    expect(screen.getByText('Take with food')).toBeTruthy();
    expect(screen.getByText('“Amoxicillin 500mg, 1 cap TID x 7d”')).toBeTruthy();

    // Low confidence / uncertain medicine entry
    expect(screen.getByText('Entry #2')).toBeTruthy();
    expect(screen.getByText('850 mg')).toBeTruthy();
    expect(screen.getByText('Unverified medicine name')).toBeTruthy();
    expect(screen.getByText(/Unverified medicine: name could not be resolved/i)).toBeTruthy();
    expect(screen.getByText('Ambiguous match')).toBeTruthy();

    // Warnings list
    expect(screen.getByText(/Warnings & Discrepancies \(2\)/i)).toBeTruthy();
    expect(screen.getByText('LOW_OCR_CONFIDENCE')).toBeTruthy();
    expect(screen.getByText('UNRESOLVED_MEDICINE_NAME')).toBeTruthy();
    expect(screen.getByText('Verify the second entry')).toBeTruthy();

    // Clinical safety notice (never invent alternatives or recommendations)
    expect(screen.getByText(/MedDecode Clinical Safety Notice/i)).toBeTruthy();
    expect(screen.getByText(/does not fabricate medicine alternatives, prices/i)).toBeTruthy();
  });

  it('shows a missing-result state when no stored result is returned', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/me')) {
        return new Response(JSON.stringify({ user: testSession.user }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/results')) {
        return new Response(JSON.stringify({ error: 'Not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({
          prescription: { ...mockPrescription, status: 'completed' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    renderResultsPage(fetchMock);

    expect((await screen.findAllByText('Completed')).length).toBeGreaterThan(0);
    expect(screen.getByText('Analysis result not available')).toBeTruthy();
    expect(screen.getByText(/No completed analysis result is available/i)).toBeTruthy();
    expect(screen.queryByText('Adapter isolated')).toBeNull();
    expect(screen.queryByText('Intelligence Results Read Endpoint Not Yet Available')).toBeNull();
  });

  it('renders a completed result without warnings and does not invent optional medicine details', async () => {
    const resultWithoutWarnings: ContractV1AnalysisResult = {
      ...sampleResult,
      status: 'completed',
      medicines: [{
        ...sampleResult.medicines[1]!,
        extraction: {
          raw_text: 'Unclear name 850 mg',
          strength: undefined,
          frequency: { type: 'unknown' },
          duration: { value: null, unit: null },
          quantity: { value: null, unit: null },
          timing: null,
        },
      }],
      recommendations: [],
      warnings: [],
    };
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/me')) {
        return new Response(JSON.stringify({ user: testSession.user }), { headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/results')) {
        return new Response(JSON.stringify(resultWithoutWarnings), { headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/processing-status')) {
        return new Response(JSON.stringify({ prescription_id: prescriptionId, processing: null }), { headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ prescription: { ...mockPrescription, status: 'completed' } }), {
        headers: { 'Content-Type': 'application/json' },
      });
    });

    renderResultsPage(fetchMock);

    expect(await screen.findByText('Recognized Medicines (1)')).toBeTruthy();
    expect(screen.getAllByText('Not provided').length).toBeGreaterThan(1);
    expect(screen.queryByText('Standard schedule')).toBeNull();
    expect(screen.queryByText('Scheduled')).toBeNull();
    expect(screen.queryByText(/Warnings & Discrepancies/)).toBeNull();
    expect(screen.queryByText('Amoxicillin')).toBeNull();
  });

  it('shows an authenticated state when the results endpoint rejects the session', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/me')) {
        return new Response(JSON.stringify({ user: testSession.user }), { headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/results')) {
        return new Response('{}', { status: 401, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/processing-status')) {
        return new Response(JSON.stringify({ prescription_id: prescriptionId, processing: null }), { headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ prescription: { ...mockPrescription, status: 'completed' } }), {
        headers: { 'Content-Type': 'application/json' },
      });
    });

    renderResultsPage(fetchMock);

    expect(await screen.findByRole('heading', { name: 'Authentication Required' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sign In' })).toBeTruthy();
    expect(screen.queryByText('Amoxicillin')).toBeNull();
  });

  it('offers retry for a results service failure and displays the actual response after retry', async () => {
    let resultCalls = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/me')) {
        return new Response(JSON.stringify({ user: testSession.user }), { headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/results')) {
        resultCalls += 1;
        return resultCalls === 1
          ? new Response('{}', { status: 503, headers: { 'Content-Type': 'application/json' } })
          : new Response(JSON.stringify(sampleResult), { headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/processing-status')) {
        return new Response(JSON.stringify({ prescription_id: prescriptionId, processing: null }), { headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ prescription: { ...mockPrescription, status: 'completed_with_warnings' } }), {
        headers: { 'Content-Type': 'application/json' },
      });
    });

    renderResultsPage(fetchMock);

    expect(await screen.findByRole('heading', { name: 'Unable to load analysis results' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry results' }));

    expect(await screen.findByRole('heading', { name: 'Amoxicillin' })).toBeTruthy();
    expect(resultCalls).toBe(2);
  });

  it('wraps long medicine names instead of overflowing the medicine card', async () => {
    const longName = 'FictionalMedicineNameThatIsIntentionallyLongToCheckResponsiveWrappingWithoutSpaces';
    const longNameResult = {
      ...sampleResult,
      status: 'completed' as const,
      warnings: [],
      recommendations: [],
      medicines: [{
        ...sampleResult.medicines[0]!,
        extraction: {
          ...sampleResult.medicines[0]!.extraction,
          medicine_name: longName,
          medicine_name_normalized: longName.toLowerCase(),
        },
      }],
    };
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/me')) {
        return new Response(JSON.stringify({ user: testSession.user }), { headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/results')) {
        return new Response(JSON.stringify(longNameResult), { headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/processing-status')) {
        return new Response(JSON.stringify({ prescription_id: prescriptionId, processing: null }), { headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ prescription: { ...mockPrescription, status: 'completed' } }), {
        headers: { 'Content-Type': 'application/json' },
      });
    });

    renderResultsPage(fetchMock);

    const medicineHeading = await screen.findByRole('heading', { name: longName });
    expect(medicineHeading.className).toContain('[overflow-wrap:anywhere]');
  });

  it('shows clear empty/not-found state for 404 prescription ID', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/me')) {
        return new Response(JSON.stringify({ user: testSession.user }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: 'Prescription not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    renderResultsPage(fetchMock, 'non-existent-id');

    expect(await screen.findByText('Prescription Not Found')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View All Prescriptions' })).toBeTruthy();
  });

  it('never renders medicine results for pending or failed status even if result data is present', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/me')) {
        return new Response(JSON.stringify({ user: testSession.user }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({
          prescription: { ...mockPrescription, status: 'processing' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    vi.stubGlobal('fetch', fetchMock);
    render(
      <MemoryRouter initialEntries={[`/prescriptions/${prescriptionId}`]}>
        <AppProviders authClient={createAuthTestClient()} initialAuthSession={testSession}>
          <Routes>
            <Route
              path="/prescriptions/:id"
              element={<PrescriptionResultsPage initialResult={sampleResult} />}
            />
          </Routes>
        </AppProviders>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Processing')).toBeTruthy();
    expect(screen.getByText('Analysis in progress')).toBeTruthy();
    // Pending status must NOT display medicine results
    expect(screen.queryByText('Recognized Medicines (2)')).toBeNull();
    expect(screen.queryByText('Amoxicillin')).toBeNull();
  });

  it('allows starting analysis for genuine image files and explains hosted worker status', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/me')) {
        return new Response(JSON.stringify({ user: testSession.user }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({
          prescription: { ...mockPrescription, file_type: 'image/jpeg', status: 'uploaded' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    renderResultsPage(fetchMock);

    expect(await screen.findByRole('button', { name: /Start OCR & Analysis/i })).toBeTruthy();
    expect(screen.getByText(/Genuine PDF, JPEG, and PNG documents are supported/i)).toBeTruthy();
    expect(screen.getByText(/Hosted processing worker remains disabled/i)).toBeTruthy();
  });

  it('renders cancelled status truthfully with safety safeguards against live API conflicts', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/me')) {
        return new Response(JSON.stringify({ user: testSession.user }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/processing-status')) {
        return new Response(
          JSON.stringify({
            prescription_id: prescriptionId,
            processing: {
              job_id: jobId,
              status: 'cancelled',
              created_at: '2026-11-12T10:01:00Z',
              started_at: null,
              completed_at: '2026-11-12T10:02:00Z',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          prescription: { ...mockPrescription, status: 'cancelled' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    renderResultsPage(fetchMock);

    expect(await screen.findByText('Cancelled')).toBeTruthy();
    expect(screen.getByText(/Prescription analysis was cancelled/i)).toBeTruthy();
    const restartBtn = screen.getByRole('button', { name: /Restart Analysis/i });
    expect(restartBtn).toBeTruthy();

    // Clicking restart analysis must safeguard against sending invalid POST /process requests
    fireEvent.click(restartBtn);
    expect(await screen.findByText(/Cancelled prescriptions cannot be re-processed/i)).toBeTruthy();
    const processCalls = fetchMock.mock.calls.filter(([req]) => String(req).endsWith('/process'));
    expect(processCalls).toHaveLength(0);
  });
});
