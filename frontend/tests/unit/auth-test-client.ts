import { vi } from 'vitest';
import type { AuthSession, BrowserAuthClient } from '../../src/features/auth/auth-client';

export const testSession: AuthSession = {
  access_token: 'synthetic-access-token',
  expires_at: 4_102_444_800,
  user: { id: '00000000-0000-4000-8000-000000000001', email: 'synthetic@example.test' } as AuthSession['user'],
};

export function createAuthTestClient(session: AuthSession | null = testSession): BrowserAuthClient {
  return {
    getSession: vi.fn(async () => ({ session, error: null })),
    onAuthStateChange: vi.fn(() => () => undefined),
    signIn: vi.fn(async () => ({ session: testSession, error: null })),
    signUp: vi.fn(async () => ({ session: testSession, error: null })),
    requestPasswordReset: vi.fn(async () => ({ error: null })),
    updatePassword: vi.fn(async () => ({ error: null })),
    signOut: vi.fn(async () => ({ error: null })),
  };
}

export function mockVerifiedIdentity() {
  vi.stubEnv('VITE_API_BASE_URL', '/backend');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ user: { id: testSession.user.id, email: testSession.user.email } }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
}
