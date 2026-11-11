import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../../src/app/App';
import { AppProviders } from '../../src/providers/AppProviders';
import { createAuthTestClient, testSession } from './auth-test-client';

beforeEach(() => {
  vi.stubEnv('VITE_API_BASE_URL', '/backend');
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});

describe('authenticated application boundary', () => {
  it('restores a session, sends its bearer token, and verifies backend identity', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ user: { id: testSession.user.id, email: testSession.user.email } }), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    render(<MemoryRouter initialEntries={['/home']}><AppProviders authClient={createAuthTestClient()}><AppRoutes /></AppProviders></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Welcome, Demo User.' })).toBeTruthy();
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get('Authorization')).toBe(`Bearer ${testSession.access_token}`);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`${window.location.origin}/backend/api/v1/auth/me`);
  });

  it('redirects an unauthenticated protected route to sign in', async () => {
    vi.stubGlobal('fetch', vi.fn());
    render(<MemoryRouter initialEntries={['/my-cabinet']}><AppProviders authClient={createAuthTestClient(null)}><AppRoutes /></AppProviders></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy();
  });

  it('clears a rejected backend session and returns to sign in', async () => {
    const client = createAuthTestClient();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Authentication required.' } }), { status: 401, headers: { 'Content-Type': 'application/json' } })));
    render(<MemoryRouter initialEntries={['/home']}><AppProviders authClient={client}><AppRoutes /></AppProviders></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Welcome back.' })).toBeTruthy();
    await waitFor(() => expect(client.signOut).toHaveBeenCalledOnce());
  });

  it('shows a safe retry state for backend/network failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('synthetic offline'); }));
    render(<MemoryRouter initialEntries={['/home']}><AppProviders authClient={createAuthTestClient()}><AppRoutes /></AppProviders></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Session verification unavailable' })).toBeTruthy();
    expect(document.body.textContent).not.toContain('synthetic offline');
  });
});
