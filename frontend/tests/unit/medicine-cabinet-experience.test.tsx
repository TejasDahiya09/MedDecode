import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { AppProviders } from '../../src/providers/AppProviders';
import { DashboardPage } from '../../src/features/dashboard/DashboardPage';
import { MedicineCabinetPage } from '../../src/features/cabinet/MedicineCabinetPage';
import { createAuthTestClient, testSession } from './auth-test-client';

const sampleCabinetEntryId = '20000000-0000-4000-8000-000000000001';
const sampleMedicineId = '30000000-0000-4000-8000-000000000001';
const expiringEntryId = '20000000-0000-4000-8000-000000000002';
const expiredEntryId = '20000000-0000-4000-8000-000000000003';

const populatedCabinetResponse = {
  items: [
    {
      id: sampleCabinetEntryId,
      medicine_id: sampleMedicineId,
      quantity: '30',
      purchase_date: '2026-11-01',
      expiry_date: '2027-11-01',
      refill_date: '2026-12-01',
      usage_information: 'Take 1 tablet daily with breakfast',
      created_at: '2026-11-01T10:00:00Z',
      updated_at: '2026-11-01T10:00:00Z',
    },
    {
      id: expiringEntryId,
      medicine_id: '30000000-0000-4000-8000-000000000002',
      quantity: '10',
      purchase_date: '2026-10-01',
      expiry_date: '2026-11-20',
      refill_date: null,
      usage_information: 'Use as needed for fever',
      created_at: '2026-10-01T10:00:00Z',
      updated_at: '2026-10-01T10:00:00Z',
    },
    {
      id: expiredEntryId,
      medicine_id: '30000000-0000-4000-8000-000000000003',
      quantity: '5',
      purchase_date: '2025-01-01',
      expiry_date: '2025-06-01',
      refill_date: null,
      usage_information: null,
      created_at: '2025-01-01T10:00:00Z',
      updated_at: '2025-01-01T10:00:00Z',
    },
  ],
  pagination: { limit: 20, offset: 0, returned: 3, has_more: false, next_offset: null },
};

const emptyCabinetResponse = {
  items: [],
  pagination: { limit: 20, offset: 0, returned: 0, has_more: false, next_offset: null },
};

beforeEach(() => {
  vi.stubEnv('VITE_API_BASE_URL', '/backend');
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});

function renderWorkspace(element: ReactNode, fetchMock: ReturnType<typeof vi.fn<typeof fetch>>, session = testSession) {
  vi.stubGlobal('fetch', fetchMock);
  return render(
    <MemoryRouter>
      <AppProviders authClient={createAuthTestClient(session)} initialAuthSession={session}>
        {element}
      </AppProviders>
    </MemoryRouter>,
  );
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  return vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url.endsWith('/api/v1/auth/me')) {
      return new Response(JSON.stringify({ user: testSession.user }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return handler(url, init);
  });
}

describe('Medicine Cabinet Experience', () => {
  it('submits an edit and removes only after confirmation', async () => {
    const fetchMock = mockFetch((url, init) => {
      if (url.endsWith(`/api/v1/medicine-cabinet/${sampleCabinetEntryId}`) && init?.method === 'PATCH') {
        return new Response(JSON.stringify({ entry: { ...populatedCabinetResponse.items[0], quantity: '4.5' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith(`/api/v1/medicine-cabinet/${sampleCabinetEntryId}`) && init?.method === 'DELETE') return new Response(null, { status: 204 });
      if (url.endsWith('/api/v1/medicine-cabinet')) return new Response(JSON.stringify(populatedCabinetResponse), { status: 200, headers: { 'Content-Type': 'application/json' } });
      return new Response('{}', { status: 404 });
    });
    renderWorkspace(<MedicineCabinetPage />, fetchMock);
    const edit = await screen.findAllByRole('button', { name: 'Edit' });
    fireEvent.click(edit[0]!);
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '4.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith(sampleCabinetEntryId) && init?.method === 'PATCH')).toBe(true));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const remove = screen.getByRole('button', { name: `Remove medicine record ${sampleCabinetEntryId}` });
    fireEvent.click(remove);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
    fireEvent.click(remove);
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true));
    confirm.mockRestore();
  });
  it('renders rich populated cabinet records with dosage schedule, dates and expiry badges', async () => {
    const fetchMock = mockFetch((url) => {
      if (url.includes('/api/v1/medicine-cabinet')) {
        return new Response(JSON.stringify(populatedCabinetResponse), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
    });

    renderWorkspace(<MedicineCabinetPage />, fetchMock);

    expect(await screen.findByRole('heading', { level: 1, name: 'My Cabinet' })).toBeTruthy();
    expect(screen.getByText('Your medicine cabinet')).toBeTruthy();
    expect(screen.getByText(/Take 1 tablet daily with breakfast/)).toBeTruthy();
    expect(screen.getByText('30')).toBeTruthy();
    expect(screen.getAllByText('Expired')).toHaveLength(2);
    expect(screen.getByText(`Medicine ID: ${sampleMedicineId}`)).toBeTruthy();
    expect(screen.getByText(`Record ID: ${sampleCabinetEntryId}`)).toBeTruthy();
    const addBtn = screen.getByRole('button', { name: 'Add medicine' }) as HTMLButtonElement;
    expect(addBtn.disabled).toBe(false);
    addBtn.focus();
    fireEvent.click(addBtn);
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close modal' }));
    expect(document.activeElement).toBe(addBtn);
    const removeBtn = screen.getByRole('button', { name: `Remove medicine record ${sampleCabinetEntryId}` }) as HTMLButtonElement;
    expect(removeBtn.disabled).toBe(false);
  });

  it('renders a friendly empty state when no medicines exist with action links', async () => {
    const fetchMock = mockFetch((url) => {
      if (url.includes('/api/v1/medicine-cabinet')) {
        return new Response(JSON.stringify(emptyCabinetResponse), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
    });

    renderWorkspace(<MedicineCabinetPage />, fetchMock);

    expect(await screen.findByText('No cabinet records')).toBeTruthy();
    expect(screen.getByText(/You have no saved medicine records/)).toBeTruthy();
    const uploadLinks = screen.getAllByRole('link', { name: /Upload Prescription/ });
    expect(uploadLinks.length).toBeGreaterThanOrEqual(1);
    expect(uploadLinks[0]?.getAttribute('href')).toBe('/upload-prescription');
    expect(screen.getByRole('link', { name: /Explore Medicine Library/ }).getAttribute('href')).toBe('/medicine-library');
  });

  it('renders error state with status-specific message and working Try Again retry', async () => {
    let callCount = 0;
    const fetchMock = mockFetch((url) => {
      if (url.includes('/api/v1/medicine-cabinet')) {
        callCount += 1;
        if (callCount === 1) {
          return new Response('{}', { status: 503, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify(populatedCabinetResponse), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
    });

    renderWorkspace(<MedicineCabinetPage />, fetchMock);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/temporarily unavailable \(HTTP 503\)/)).toBeTruthy();

    const tryAgainButton = screen.getByRole('button', { name: 'Try Again' });
    fireEvent.click(tryAgainButton);

    await waitFor(() => expect(screen.getByText(/Take 1 tablet daily with breakfast/)).toBeTruthy());
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  it('renders unauthenticated state when no session is present', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('{}', { status: 401 }));
    renderWorkspace(<MedicineCabinetPage />, fetchMock, null as unknown as typeof testSession);

    expect(await screen.findByRole('heading', { name: 'Authentication required' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Sign In/ }).getAttribute('href')).toBe('/sign-in');
  });

  it('dashboard cabinet summary displays records and inline retry on failure', async () => {
    let dashboardCabinetCalls = 0;
    const fetchMock = mockFetch((url) => {
      if (url.includes('/api/v1/prescriptions')) {
        return new Response(JSON.stringify({ items: [], pagination: { limit: 20, offset: 0, returned: 0, has_more: false, next_offset: null } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/api/v1/medicine-cabinet')) {
        dashboardCabinetCalls += 1;
        if (dashboardCabinetCalls === 1) {
          return new Response('{}', { status: 500, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify(populatedCabinetResponse), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
    });

    renderWorkspace(<DashboardPage />, fetchMock);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/internal error \(HTTP 500\)/)).toBeTruthy();

    const inlineRetryButton = screen.getByRole('button', { name: 'Retry' });
    fireEvent.click(inlineRetryButton);

    await waitFor(() => expect(screen.getByText('Take 1 tablet daily with breakfast')).toBeTruthy());
    expect(dashboardCabinetCalls).toBeGreaterThanOrEqual(2);
  });
});
