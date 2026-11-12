import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, requestAuthenticatedJson } from '../../services/api-client';
import { createBrowserAuthClient, type AuthSession, type AuthUser, type BrowserAuthClient } from './auth-client';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'error';
type AuthActionResult = { ok: true; confirmationRequired?: boolean } | { ok: false; message: string };
type AuthContextValue = {
  status: AuthStatus; user: AuthUser | null; error: string | null;
  getAccessToken(): string | null;
  signIn(email: string, password: string): Promise<AuthActionResult>;
  signUp(email: string, password: string, fullName: string): Promise<AuthActionResult>;
  requestPasswordReset(email: string): Promise<AuthActionResult>;
  updatePassword(password: string): Promise<AuthActionResult>;
  signOut(): Promise<void>; retry(): Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function validIdentity(value: unknown, session: AuthSession): AuthUser | null {
  if (!value || typeof value !== 'object' || !('user' in value)) return null;
  const user = (value as { user?: unknown }).user;
  if (!user || typeof user !== 'object') return null;
  const id = (user as { id?: unknown }).id;
  const email = (user as { email?: unknown }).email;
  if (typeof id !== 'string' || id !== session.user.id || (email !== undefined && typeof email !== 'string')) return null;
  return { id, ...(typeof email === 'string' ? { email } : {}) };
}

export function AuthProvider({ children, client: suppliedClient, initialSession }: PropsWithChildren<{ client?: BrowserAuthClient; initialSession?: AuthSession | null }>) {
  const queryClient = useQueryClient();
  const clientRef = useRef<BrowserAuthClient | null>(suppliedClient ?? null);
  const [status, setStatus] = useState<AuthStatus>(initialSession ? 'authenticated' : 'loading');
  const [user, setUser] = useState<AuthUser | null>(initialSession ? { id: initialSession.user.id, ...(initialSession.user.email ? { email: initialSession.user.email } : {}) } : null);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const verifiedUserId = useRef<string | null>(initialSession?.user.id ?? null);
  const verifiedSession = useRef<AuthSession | null>(initialSession ?? null);
  const client = useCallback(() => {
    if (!clientRef.current) clientRef.current = createBrowserAuthClient();
    return clientRef.current;
  }, []);

  const clearSession = useCallback(() => { verifiedUserId.current = null; verifiedSession.current = null; setUser(null); setError(null); setStatus('unauthenticated'); queryClient.clear(); }, [queryClient]);
  const verify = useCallback(async (session: AuthSession | null, showLoading = true) => {
    const run = ++sequence.current;
    if (!session) { clearSession(); return false; }
    if (showLoading) setStatus('loading'); setError(null);
    try {
      const response = await requestAuthenticatedJson('/api/v1/auth/me', session.access_token);
      const identity = validIdentity(response, session);
      if (!identity) throw new Error('The backend returned an invalid identity response.');
      if (run !== sequence.current) return false;
      if (verifiedUserId.current !== identity.id) queryClient.clear();
      verifiedUserId.current = identity.id;
      verifiedSession.current = session;
      setUser(identity); setStatus('authenticated'); return true;
    } catch (cause) {
      if (run !== sequence.current) return false;
      if (cause instanceof ApiError && cause.status === 401) {
        await client().signOut().catch(() => undefined); clearSession(); return false;
      }
      setUser(null); setError('We could not verify your MedDecode session. Please try again.'); setStatus('error'); return false;
    }
  }, [clearSession, client, queryClient]);

  const restore = useCallback(async () => {
    setStatus('loading'); setError(null);
    try { const result = await client().getSession(); if (result.error) throw result.error; await verify(result.session); }
    catch { setUser(null); setError('Authentication could not be initialized. Check this deployment configuration.'); setStatus('error'); }
  }, [client, verify]);

  useEffect(() => {
    queueMicrotask(() => { if (initialSession) void verify(initialSession, false); else void restore(); });
    let unsubscribe: () => void = () => undefined;
    try { unsubscribe = client().onAuthStateChange((session) => { void verify(session); }); }
    catch { queueMicrotask(() => { setError('Authentication could not be initialized. Check this deployment configuration.'); setStatus('error'); }); }
    return unsubscribe;
  }, [client, restore, verify, initialSession]);

  const message = (cause: Error | null, fallback: string) => cause?.message ? fallback : fallback;
  const unavailable = (cause: Error | null) => cause?.name === 'AuthRetryableFetchError' || cause?.name === 'TypeError';
  const value = useMemo<AuthContextValue>(() => ({
    status, user, error,
    getAccessToken() { return status === 'authenticated' ? verifiedSession.current?.access_token ?? null : null; },
    async signIn(email, password) { try { const result = await client().signIn(email, password); if (unavailable(result.error)) return { ok: false, message: 'Authentication is temporarily unavailable. Please try again.' }; if (result.error || !result.session) return { ok: false, message: message(result.error, 'Sign-in failed. Check your credentials and try again.') }; return await verify(result.session) ? { ok: true } : { ok: false, message: 'Your session could not be verified by MedDecode.' }; } catch { return { ok: false, message: 'Authentication is unavailable in this deployment.' }; } },
    async signUp(email, password, fullName) { try { const result = await client().signUp(email, password, fullName); if (result.error) return { ok: false, message: 'Account creation failed. Please review your details and try again.' }; if (!result.session) return { ok: true, confirmationRequired: true }; return await verify(result.session) ? { ok: true } : { ok: false, message: 'Your new session could not be verified by MedDecode.' }; } catch { return { ok: false, message: 'Authentication is unavailable in this deployment.' }; } },
    async requestPasswordReset(email) { try { const result = await client().requestPasswordReset(email); return result.error ? { ok: false, message: 'The recovery request could not be sent.' } : { ok: true }; } catch { return { ok: false, message: 'Authentication is unavailable in this deployment.' }; } },
    async updatePassword(password) { try { const result = await client().updatePassword(password); return result.error ? { ok: false, message: 'The password could not be updated.' } : { ok: true }; } catch { return { ok: false, message: 'Authentication is unavailable in this deployment.' }; } },
    async signOut() { ++sequence.current; await client().signOut().catch(() => undefined); clearSession(); },
    retry: restore,
  }), [status, user, error, client, verify, clearSession, restore]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// The hook intentionally lives beside its provider so the context remains private.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used within AuthProvider.');
  return value;
}
