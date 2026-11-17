import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { AppProviders } from '../../src/providers/AppProviders';
import { DashboardPage } from '../../src/features/dashboard/DashboardPage';
import { MedicineCabinetPage } from '../../src/features/cabinet/MedicineCabinetPage';
import { createAuthTestClient, testSession } from './auth-test-client';

const prescriptionId = '10000000-0000-4000-8000-000000000001';
const cabinetEntryId = '20000000-0000-4000-8000-000000000001';
const medicineId = '30000000-0000-4000-8000-000000000001';

const historyResponse = {
  items: [{
    id: prescriptionId,
    file_type: 'application/pdf',
    file_size_bytes: '4096',
    status: 'uploaded',
    prescription_date: null,
    created_at: '2026-11-12T10:00:00Z',
    updated_at: '2026-11-12T10:00:00Z',
    processed_at: null,
  }],
  pagination: { limit: 20, offset: 0, returned: 1, has_more: false, next_offset: null },
};

const cabinetResponse = {
  items: [{
    id: cabinetEntryId,
    medicine_id: medicineId,
    quantity: '2.5',
    purchase_date: '2026-11-01',
    expiry_date: null,
    refill_date: null,
    usage_information: null,
    created_at: '2026-11-02T10:00:00Z',
    updated_at: '2026-11-02T10:00:00Z',
  }],
  pagination: { limit: 20, offset: 0, returned: 1, has_more: false, next_offset: null },
};

beforeEach(() => {
  vi.stubEnv('VITE_API_BASE_URL', '/backend');
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});

function renderWorkspace(element: ReactNode, fetchMock: ReturnType<typeof vi.fn<typeof fetch>>) {
  vi.stubGlobal('fetch', fetchMock);
  return render(
    <MemoryRouter>
      <AppProviders authClient={createAuthTestClient()} initialAuthSession={testSession}>
        {element}
      </AppProviders>
    </MemoryRouter>,
  );
}

function authenticatedFetch() {
  return vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url.endsWith('/api/v1/auth/me')) {
      return new Response(JSON.stringify({ user: testSession.user }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.endsWith('/api/v1/prescriptions')) {
      return new Response(JSON.stringify(historyResponse), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.endsWith('/api/v1/medicine-cabinet')) {
      return new Response(JSON.stringify(cabinetResponse), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
  });
}

describe('account-backed dashboard and medicine cabinet', () => {
  it('shows only prescription and cabinet records returned by authenticated APIs', async () => {
    renderWorkspace(<DashboardPage />, authenticatedFetch());

    expect(await screen.findByRole('heading', { name: /Welcome back.*synthetic@example\.test/ })).toBeTruthy();
    expect(screen.getByText(prescriptionId)).toBeTruthy();
    expect(screen.getByText(medicineId)).toBeTruthy();
    expect(screen.queryByText(/Example document added|Reference cards prepared|Demo User/)).toBeNull();
  });

  it('loads cabinet records and presents supported actions without writing on load', async () => {
    const fetchMock = authenticatedFetch();
    renderWorkspace(<MedicineCabinetPage />, fetchMock);

    expect(await screen.findByText(`Medicine ID: ${medicineId}`)).toBeTruthy();
    expect(screen.getByText('Quantity')).toBeTruthy();
    expect(screen.getByText('2.5')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Add medicine' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: `Remove medicine record ${cabinetEntryId}` }) as HTMLButtonElement).disabled).toBe(false);
    const cabinetCalls = fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/api/v1/medicine-cabinet'));
    expect(cabinetCalls).toHaveLength(1);
    expect(cabinetCalls.every(([, init]) => init?.method === undefined)).toBe(true);
  });

  it('retains the retry path when the cabinet API fails', async () => {
    let cabinetRequests = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/me')) {
        return new Response(JSON.stringify({ user: testSession.user }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/api/v1/medicine-cabinet')) {
        cabinetRequests += 1;
        if (cabinetRequests === 1) return new Response('{}', { status: 503, headers: { 'Content-Type': 'application/json' } });
        return new Response(JSON.stringify(cabinetResponse), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
    });
    renderWorkspace(<MedicineCabinetPage />, fetchMock);

    expect(await screen.findByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(screen.getByText(`Medicine ID: ${medicineId}`)).toBeTruthy());
    expect(cabinetRequests).toBeGreaterThanOrEqual(2);
  });
});
