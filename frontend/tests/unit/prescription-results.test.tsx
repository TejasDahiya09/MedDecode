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
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});

function renderResultsPage(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>, pathId = prescriptionId) {
  vi.stubGlobal('fetch', fetchMock);
  return render(
    <MemoryRouter initialEntries={[`/prescriptions/${pathId}`]}>
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
    expect(screen.getByText('Optical Character Recognition in Progress')).toBeTruthy();
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
    expect(screen.getByRole('status', { name: 'OCR recognition alert' })).toBeTruthy();
    expect(screen.getByText(/Uncertain OCR outcomes detected/i)).toBeTruthy();

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

    // Clinical safety notice (never invent alternatives or recommendations)
    expect(screen.getByText(/MedDecode Clinical Safety Notice/i)).toBeTruthy();
    expect(screen.getByText(/does not fabricate medicine alternatives, prices/i)).toBeTruthy();
  });

  it('shows isolated unavailable state when backend results read endpoint is 404', async () => {
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
    expect(screen.getByText('Intelligence Results Read Endpoint Not Yet Available')).toBeTruthy();
    expect(screen.getByText(/MedDecode keeps this data adapter isolated/i)).toBeTruthy();
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
    expect(screen.getByText('Optical Character Recognition in Progress')).toBeTruthy();
    // Pending status must NOT display medicine results
    expect(screen.queryByText('Recognized Medicines (2)')).toBeNull();
    expect(screen.queryByText('Amoxicillin')).toBeNull();
  });
});
