import { createClient, type Session, type SupabaseClient, type User } from '@supabase/supabase-js';

export type AuthSession = Pick<Session, 'access_token' | 'expires_at' | 'user'>;
export type AuthUser = Pick<User, 'id' | 'email'>;

export interface BrowserAuthClient {
  getSession(): Promise<{ session: AuthSession | null; error: Error | null }>;
  onAuthStateChange(callback: (session: AuthSession | null) => void): () => void;
  signIn(email: string, password: string): Promise<{ session: AuthSession | null; error: Error | null }>;
  signUp(email: string, password: string, fullName: string): Promise<{ session: AuthSession | null; error: Error | null }>;
  requestPasswordReset(email: string): Promise<{ error: Error | null }>;
  updatePassword(password: string): Promise<{ error: Error | null }>;
  signOut(): Promise<{ error: Error | null }>;
}

function publicConfiguration(): { url: string; key: string } {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) throw new Error('Authentication is not configured for this deployment.');
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error('Authentication is not configured correctly.'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('Authentication is not configured correctly.');
  if (/service[_-]?role/i.test(key) || key.startsWith('sb_secret_')) throw new Error('A privileged Supabase key must never be used in the browser.');
  return { url: parsed.toString().replace(/\/$/, ''), key };
}

function wrap(client: SupabaseClient): BrowserAuthClient {
  return {
    async getSession() { const { data, error } = await client.auth.getSession(); return { session: data.session, error }; },
    onAuthStateChange(callback) { const { data } = client.auth.onAuthStateChange((_event, session) => callback(session)); return () => data.subscription.unsubscribe(); },
    async signIn(email, password) { const { data, error } = await client.auth.signInWithPassword({ email, password }); return { session: data.session, error }; },
    async signUp(email, password, fullName) { const { data, error } = await client.auth.signUp({ email, password, options: { data: { full_name: fullName } } }); return { session: data.session, error }; },
    async requestPasswordReset(email) { const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` }); return { error }; },
    async updatePassword(password) { const { error } = await client.auth.updateUser({ password }); return { error }; },
    // The browser boundary must clear its own persisted session even when the
    // remote auth service is unavailable. Server-side/global revocation is a
    // separate account-security operation and is not implied by this UI action.
    async signOut() { const { error } = await client.auth.signOut({ scope: 'local' }); return { error }; },
  };
}

export function createBrowserAuthClient(): BrowserAuthClient {
  const { url, key } = publicConfiguration();
  return wrap(createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }));
}
