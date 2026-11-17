import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../../src/providers/AppProviders';
import { PrescriptionResultsPage } from '../../src/features/prescriptions/PrescriptionResultsPage';
import { createAuthTestClient, testSession } from './auth-test-client';
import type {
  ContractV1AnalysisResult,
  PrescriptionHistoryItem,
} from '../../src/features/prescriptions/prescription-api';

const prescriptionId = '44444444-4444-4444-8444-444444444444';
const jobId = '55555555-5555-4555-8555-555555555555';

const mockQueuedPrescription: PrescriptionHistoryItem = {
  id: prescriptionId,
  file_type: 'application/pdf',
  file_size_bytes: '51200',
  status: 'queued',
  prescription_date: '2026-11-13',
  created_at: '2026-11-13T10:00:00Z',
  updated_at: '2026-11-13T10:00:00Z',
  processed_at: null,
};

const mockCompletedPrescription: PrescriptionHistoryItem = {
  ...mockQueuedPrescription,
  status: 'completed',
  processed_at: '2026-11-13T10:01:00Z',
};

const mockAnalysisResult: ContractV1AnalysisResult = {
  schema_version: '1.0',
  job_id: jobId,
  prescription_id: prescriptionId,
  status: 'completed',
  prescription: { prescription_date: '2026-11-13' },
  patient: { name: null, age: null, gender: null },
  medicines: [
    {
      sequence_number: 1,
      extraction: {
        raw_text: 'Paracetamol 500mg',
        medicine_name: 'Paracetamol',
        dosage_form: 'tablet',
        frequency: { type: 'scheduled', times_per_day: 2 },
        duration: { value: null, unit: null },
        quantity: { value: null, unit: null },
      },
      confidence: {},
      medicine_match: {
        status: 'matched',
        confidence: 0.95,
        medicine_external_id: 'catalog-500',
        brand_name: 'Paracetamol',
        dosage_form: 'tablet',
        ingredients: [],
      },
      alternatives: [],
      derived: { units_per_day: 2, estimated_total_units: null },
    },
  ],
  recommendations: [],
  warnings: [],
  processing_metadata: { overall_confidence: 0.95 },
};

describe('PrescriptionResultsPage polling and lifecycle', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv('VITE_API_BASE_URL', '/backend');
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });

  it('does not repeatedly submit after an automatic processing request fails', async () => {
    let submissions = 0;
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/me')) return new Response(JSON.stringify({ user: testSession.user }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (url.endsWith('/processing-status')) return new Response(JSON.stringify({ prescription_id: prescriptionId, processing: null }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (url.endsWith('/process') && init?.method === 'POST') { submissions++; return new Response('{}', { status: 503, headers: { 'Content-Type': 'application/json' } }); }
      if (url.endsWith(`/api/v1/prescriptions/${prescriptionId}`)) return new Response(JSON.stringify({ prescription: { ...mockQueuedPrescription, status: 'uploaded' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
    }));
    render(<MemoryRouter initialEntries={[`/prescriptions/${prescriptionId}?process=true`]}>
      <AppProviders authClient={createAuthTestClient()} initialAuthSession={testSession}>
        <Routes><Route path="/prescriptions/:id" element={<PrescriptionResultsPage pollIntervalMs={50} />} /></Routes>
      </AppProviders>
    </MemoryRouter>);
    await screen.findByText(/processing is unavailable in this deployment/i);
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(submissions).toBe(1);
  });

  it('polls status and automatically displays results once job completes', async () => {
    let callCount = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/me')) {
        return new Response(JSON.stringify({ user: testSession.user }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith(`/api/v1/prescriptions/${prescriptionId}`)) {
        callCount++;
        // First call returns queued, second call returns completed
        const item = callCount > 1 ? mockCompletedPrescription : mockQueuedPrescription;
        return new Response(JSON.stringify({ prescription: item }), {
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
              status: callCount > 1 ? 'completed' : 'processing',
              created_at: '2026-11-13T10:00:00Z',
              started_at: '2026-11-13T10:00:05Z',
              completed_at: callCount > 1 ? '2026-11-13T10:01:00Z' : null,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.endsWith('/results')) {
        return new Response(JSON.stringify(mockAnalysisResult), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });

    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={[`/prescriptions/${prescriptionId}`]}>
        <AppProviders authClient={createAuthTestClient()} initialAuthSession={testSession}>
          <Routes>
            <Route path="/prescriptions/:id" element={<PrescriptionResultsPage pollIntervalMs={50} />} />
          </Routes>
        </AppProviders>
      </MemoryRouter>,
    );

    // Initial render shows Queued
    expect(await screen.findByText('Queued')).toBeTruthy();

    // After polling triggers (interval is 2500ms, wait for it)
    await waitFor(
      () => {
        expect(screen.getByText('Completed')).toBeTruthy();
      },
      { timeout: 4000 },
    );

    // Verified results appear
    expect(await screen.findByText(/Paracetamol 500mg/)).toBeTruthy();
  });
});
