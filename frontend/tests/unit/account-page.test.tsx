import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountPage } from '../../src/features/profile/AccountPage';
import { fetchAccountProfile } from '../../src/features/profile/profile-api';
import { AppProviders } from '../../src/providers/AppProviders';
import { createAuthTestClient, testSession } from './auth-test-client';

const profile = {
  id: testSession.user.id,
  email: 'synthetic@example.test',
  name: 'Synthetic Student',
  created_at: '2026-01-02T00:00:00.000Z',
  updated_at: '2026-01-03T00:00:00.000Z',
};

beforeEach(() => {
  vi.stubEnv('VITE_API_BASE_URL', '/backend');
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});

function mount(client = createAuthTestClient()) {
  return render(<MemoryRouter><AppProviders authClient={client} initialAuthSession={testSession}><AccountPage /></AppProviders></MemoryRouter>);
}

describe('account page', () => {
  it('loads only the supported owner account fields and exposes session controls', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input) => {
      const url = String(input);
      const body = url.endsWith('/api/v1/auth/me') ? { user: testSession.user } : { profile };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
    const client = createAuthTestClient();
    mount(client);
    expect(await screen.findByRole('heading', { name: 'Verified account' })).toBeTruthy();
    expect(screen.getByText('Synthetic Student')).toBeTruthy();
    expect(screen.getByText('synthetic@example.test')).toBeTruthy();
    expect(screen.queryByText(/allerg/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(client.signOut).toHaveBeenCalledOnce();
  });

  it('shows a clear retryable state when the application profile is absent', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/me')) return new Response(JSON.stringify({ user: testSession.user }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({ error: { code: 'USER_PROFILE_NOT_FOUND' } }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }));
    mount();
    expect((await screen.findByRole('alert')).textContent).toContain('does not yet have an application profile');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('distinguishes an expired session from an unavailable account service', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/me')) return new Response(JSON.stringify({ user: testSession.user }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }));
    mount();
    expect((await screen.findByRole('alert')).textContent).toContain('session has expired');
  });

  it('rejects malformed account responses instead of displaying invented identity data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ profile: { ...profile, created_at: 'not-a-date' } }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    await expect(fetchAccountProfile('synthetic-token')).rejects.toMatchObject({ status: 502, kind: 'response' });
  });
});
