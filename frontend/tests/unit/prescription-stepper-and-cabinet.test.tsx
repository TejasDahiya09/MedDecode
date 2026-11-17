import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../../src/providers/AppProviders';
import { PrescriptionProcessingStepper } from '../../src/features/prescriptions/PrescriptionProcessingStepper';
import { SaveToCabinetModal } from '../../src/features/prescriptions/SaveToCabinetModal';
import { PrescriptionHistoryPage } from '../../src/features/prescriptions/PrescriptionHistoryPage';
import { createAuthTestClient, testSession } from './auth-test-client';
import type { ContractV1MedicineItem, ProcessingJobInfo } from '../../src/features/prescriptions/prescription-api';

const mockMatchedMedicine: ContractV1MedicineItem = {
  sequence_number: 1,
  extraction: {
    raw_text: 'Amoxicillin 500mg tid 7 days',
    medicine_name: 'Amoxicillin',
    medicine_name_normalized: 'amoxicillin',
    strength: { value: 500, unit: 'mg' },
    dosage_form: 'Capsule',
    frequency: { type: 'scheduled', times_per_day: 3, morning: 1, afternoon: 1, night: 1 },
    duration: { value: 7, unit: 'days' },
    quantity: { value: 21, unit: 'capsules' },
    timing: 'After meals',
    instructions: 'Take 1 capsule three times daily for 7 days',
  },
  medicine_match: {
    status: 'matched',
    confidence: 0.96,
    medicine_external_id: 'a0000000-0000-4000-8000-000000000001',
    brand_name: 'Amoxil 500mg',
    ingredients: [{ name: 'Amoxicillin Trihydrate', strength_value: 500, strength_unit: 'mg' }],
  },
  confidence: {
    medicine_name: 0.96,
    strength: 0.95,
    dosage_form: 0.94,
    frequency: 0.92,
    duration: 0.9,
    overall: 0.94,
  },
  derived: {
    units_per_day: 3,
    estimated_total_units: 21,
  },
};

const mockUnmatchedMedicine: ContractV1MedicineItem = {
  sequence_number: 2,
  extraction: {
    raw_text: 'UnknownDrug 25mg daily',
    medicine_name: 'UnknownDrug',
    medicine_name_normalized: 'unknowndrug',
    strength: { value: 25, unit: 'mg' },
    dosage_form: 'Tablet',
    frequency: { type: 'scheduled', times_per_day: 1, morning: 1, afternoon: 0, night: 0 },
    timing: null,
    instructions: null,
  },
  medicine_match: {
    status: 'unmatched',
    confidence: null,
    medicine_external_id: null,
    brand_name: null,
    ingredients: [],
  },
  confidence: {
    medicine_name: 0.65,
    strength: 0.7,
    dosage_form: 0.6,
    frequency: 0.8,
    duration: null,
    overall: 0.68,
  },
  derived: {
    units_per_day: null,
    estimated_total_units: null,
  },
};

beforeEach(() => {
  vi.stubEnv('VITE_API_BASE_URL', '/backend');
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

describe('PrescriptionProcessingStepper', () => {
  it('renders all 4 stages without fabricated progress percentages', () => {
    render(<PrescriptionProcessingStepper status="uploaded" processing={null} />);

    expect(screen.getByText('Document Uploaded')).toBeTruthy();
    expect(screen.getByText('Analysis Queue')).toBeTruthy();
    expect(screen.getByText('OCR & Intelligence')).toBeTruthy();
    expect(screen.getByText('Results pending')).toBeTruthy();

    // Verify no fake percentage like "45%" or "72%" is rendered
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it('displays active queue state and active job ID when queued', () => {
    const jobInfo: ProcessingJobInfo = {
      job_id: 'job-9876543210-active',
      status: 'queued',
      created_at: '2026-11-13T10:00:00Z',
      started_at: null,
      completed_at: null,
    };
    render(<PrescriptionProcessingStepper status="queued" processing={jobInfo} />);

    expect(screen.getByText(/Active job: job-9876/i)).toBeTruthy();
  });

  it('displays processing active state when OCR is running', () => {
    render(<PrescriptionProcessingStepper status="processing" processing={null} />);

    expect(screen.getByText('Reading text & medicines…')).toBeTruthy();
  });

  it('displays completed state with success indicator when complete', () => {
    render(<PrescriptionProcessingStepper status="completed" processing={null} resultAvailable />);

    expect(screen.getByText('Medicines recognized')).toBeTruthy();
    expect(screen.getByText('Full analysis ready')).toBeTruthy();
  });

  it('displays warning indicator on results step when completed with warnings', () => {
    render(<PrescriptionProcessingStepper status="completed_with_warnings" processing={null} resultAvailable />);

    expect(screen.getByText('Ready with warnings')).toBeTruthy();
  });

  it('displays failed state when processing fails', () => {
    render(<PrescriptionProcessingStepper status="failed" processing={null} />);

    expect(screen.getByText('Processing failed')).toBeTruthy();
    expect(screen.getByText('Analysis failed')).toBeTruthy();
  });
});

describe('SaveToCabinetModal', () => {
  it('allows saving medicine to cabinet when catalogue UUID is verified', async () => {
    const onClose = vi.fn();
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.includes('/api/v1/medicine-cabinet')) {
        const body = JSON.parse(String(init?.body));
        expect(body.medicine_id).toBe('a0000000-0000-4000-8000-000000000001');
        expect(body.quantity).toBe('21');
        return new Response(
          JSON.stringify({
            entry: {
              id: 'c0000000-0000-4000-8000-000000000001',
              medicine_id: body.medicine_id,
              quantity: body.quantity,
              purchase_date: body.purchase_date ?? null,
              expiry_date: body.expiry_date ?? null,
              refill_date: null,
              usage_information: body.usage_information ?? null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter>
        <AppProviders authClient={createAuthTestClient()} initialAuthSession={testSession}>
          <SaveToCabinetModal
            medicine={mockMatchedMedicine}
            prescriptionId="10000000-0000-4000-8000-000000000099"
            onClose={onClose}
          />
        </AppProviders>
      </MemoryRouter>,
    );

    expect(screen.getByText('Save to Medicine Cabinet')).toBeTruthy();
    expect(screen.getByText('Amoxicillin')).toBeTruthy();
    expect(screen.getByText('Verified Catalogue Item')).toBeTruthy();

    const saveButton = screen.getByRole('button', { name: 'Save to Cabinet' });
    fireEvent.click(saveButton);

    expect(await screen.findByText('Saved to Medicine Cabinet')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View in My Cabinet' })).toBeTruthy();
  });

  it('shows honest guidance and links to Medicine Library when catalogue UUID is absent', () => {
    const onClose = vi.fn();

    render(
      <MemoryRouter>
        <AppProviders authClient={createAuthTestClient()} initialAuthSession={testSession}>
          <SaveToCabinetModal
            medicine={mockUnmatchedMedicine}
            prescriptionId="10000000-0000-4000-8000-000000000099"
            onClose={onClose}
          />
        </AppProviders>
      </MemoryRouter>,
    );

    expect(screen.getByText('Catalogue Association Required')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Search in Medicine Library' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Add manually in Cabinet' })).toBeTruthy();
    // Must NOT show direct Save button when catalogue UUID is absent
    expect(screen.queryByRole('button', { name: 'Save to Cabinet' })).toBeNull();
  });
});

describe('PrescriptionHistoryPage Filtering and Search', () => {
  const docId1 = '10000000-0000-4000-8000-000000000001';
  const docId2 = '10000000-0000-4000-8000-000000000002';
  const docId3 = '10000000-0000-4000-8000-000000000003';

  const historyData = {
    items: [
      {
        id: docId1,
        file_type: 'application/pdf',
        file_size_bytes: '102400',
        status: 'completed',
        prescription_date: '2026-11-01',
        created_at: '2026-11-01T10:00:00Z',
        updated_at: '2026-11-01T10:05:00Z',
        processed_at: '2026-11-01T10:05:00Z',
      },
      {
        id: docId2,
        file_type: 'image/jpeg',
        file_size_bytes: '204800',
        status: 'processing',
        prescription_date: null,
        created_at: '2026-11-02T11:00:00Z',
        updated_at: '2026-11-02T11:00:00Z',
        processed_at: null,
      },
      {
        id: docId3,
        file_type: 'image/png',
        file_size_bytes: '307200',
        status: 'uploaded',
        prescription_date: null,
        created_at: '2026-11-03T12:00:00Z',
        updated_at: '2026-11-03T12:00:00Z',
        processed_at: null,
      },
    ],
    pagination: {
      limit: 20,
      offset: 0,
      returned: 3,
      has_more: false,
      next_offset: null,
    },
  };

  it('filters history by status filter chips and search text', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/me')) {
        return new Response(JSON.stringify({ user: testSession.user }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(historyData), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/prescriptions']}>
        <AppProviders authClient={createAuthTestClient()} initialAuthSession={testSession}>
          <PrescriptionHistoryPage />
        </AppProviders>
      </MemoryRouter>,
    );

    expect(await screen.findByText(docId1)).toBeTruthy();
    expect(screen.getByText(docId2)).toBeTruthy();
    expect(screen.getByText(docId3)).toBeTruthy();

    // Click "Processing" filter chip
    const processingChip = screen.getByRole('button', { name: /^Processing/ });
    fireEvent.click(processingChip);

    expect(screen.getByText(docId2)).toBeTruthy();
    expect(screen.queryByText(docId1)).toBeNull();
    expect(screen.queryByText(docId3)).toBeNull();

    // Reset back to All
    const allChip = screen.getByRole('button', { name: /^All/ });
    fireEvent.click(allChip);
    expect(screen.getByText(docId1)).toBeTruthy();

    // Search by ID
    const searchInput = screen.getByLabelText('Filter prescriptions');
    fireEvent.change(searchInput, { target: { value: docId3 } });
    expect(screen.getByText(docId3)).toBeTruthy();
    expect(screen.queryByText(docId1)).toBeNull();

    // Search for non-existent text
    fireEvent.change(searchInput, { target: { value: 'nonexistent-uuid' } });
    expect(screen.getByText('No matching prescriptions found')).toBeTruthy();

    // Clear filters button resets
    const clearButton = screen.getByRole('button', { name: 'Clear Filters' });
    fireEvent.click(clearButton);
    expect(screen.getByText(docId1)).toBeTruthy();
  });
});
