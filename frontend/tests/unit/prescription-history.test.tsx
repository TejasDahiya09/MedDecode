import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../../src/providers/AppProviders';
import { PrescriptionHistoryPage } from '../../src/features/prescriptions/PrescriptionHistoryPage';
import { createAuthTestClient, testSession } from './auth-test-client';

const id1 = '10000000-0000-4000-8000-000000000001';
const id2 = '10000000-0000-4000-8000-000000000002';

const mockHistoryResponse = {
  items: [
    {
      id: id1,
      file_type: 'application/pdf',
      file_size_bytes: '524288',
      status: 'completed',
      prescription_date: '2026-11-10',
      created_at: '2026-11-10T08:30:00Z',
      updated_at: '2026-11-10T08:35:00Z',
      processed_at: '2026-11-10T08:35:00Z',
    },
    {
      id: id2,
      file_type: 'image/jpeg',
      file_size_bytes: '1048576',
      status: 'queued',
      prescription_date: null,
      created_at: '2026-11-12T09:00:00Z',
      updated_at: '2026-11-12T09:00:00Z',
      processed_at: null,
    },
  ],
  pagination: {
    limit: 20,
    offset: 0,
    returned: 2,
    has_more: false,
    next_offset: null,
  },
};

beforeEach(() => {
  vi.stubEnv('VITE_API_BASE_URL', '/backend');
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});

function renderHistoryPage(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>) {
  vi.stubGlobal('fetch', fetchMock);
  return render(
    <MemoryRouter initialEntries={['/prescriptions']}>
      <AppProviders authClient={createAuthTestClient()} initialAuthSession={testSession}>
        <Routes>
          <Route path="/prescriptions" element={<PrescriptionHistoryPage />} />
        </Routes>
      </AppProviders>
    </MemoryRouter>,
  );
}

describe('prescription history list page', () => {
  it('renders list of user prescriptions with details and status badges', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/me')) {
        return new Response(JSON.stringify({ user: testSession.user }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(mockHistoryResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    renderHistoryPage(fetchMock);

    expect(await screen.findByText(id1)).toBeTruthy();
    expect(screen.getByText(id2)).toBeTruthy();
    expect(screen.getByText('Completed')).toBeTruthy();
    expect(screen.getByText('Queued')).toBeTruthy();
    expect(screen.getByText('512.0 KB')).toBeTruthy();
    expect(screen.getByText('1.0 MB')).toBeTruthy();
    expect(screen.getAllByText('View analysis')).toHaveLength(2);
  });

  it('renders empty state when no prescriptions are found', async () => {
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
          items: [],
          pagination: { limit: 20, offset: 0, returned: 0, has_more: false, next_offset: null },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    renderHistoryPage(fetchMock);

    expect(await screen.findByText('No Prescriptions Uploaded')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: /Upload Prescription/i })).toHaveLength(1);
  });

  it('handles error state and provides retry action', async () => {
    let callCount = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/me')) {
        return new Response(JSON.stringify({ user: testSession.user }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      callCount++;
      if (callCount === 1) {
        return new Response('{}', { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify(mockHistoryResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    renderHistoryPage(fetchMock);

    expect(await screen.findByText('Unable to Load Prescriptions')).toBeTruthy();
    const retryBtn = screen.getByRole('button', { name: 'Try Again' });
    fireEvent.click(retryBtn);

    expect(await screen.findByText(id1)).toBeTruthy();
  });
});
