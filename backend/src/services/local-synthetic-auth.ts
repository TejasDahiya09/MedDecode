import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { AuthVerifier, VerifiedIdentity } from './auth.service.js';

const identities = {
  alice: { userId: '10000000-0000-4000-8000-000000000001', email: 'alice@synthetic.invalid' },
  bob: { userId: '20000000-0000-4000-8000-000000000002', email: 'bob@synthetic.invalid' },
} as const;
type Account = keyof typeof identities;

/** In-memory fictional sessions. Construct only after local isolation verification. */
export function createLocalSyntheticAuth(secrets: Readonly<Record<Account, string>>, isolationVerified: boolean): {
  signIn(account: string, secret: string): string | null;
  signOut(token: string): void;
  verifier: AuthVerifier;
} {
  if (!isolationVerified || Object.values(secrets).some(value => typeof value !== 'string' || Buffer.byteLength(value) < 32) || secrets.alice === secrets.bob) {
    throw new Error('Local synthetic identity configuration is invalid.');
  }
  const sessions = new Map<string, { identity: VerifiedIdentity; expires: number }>();
  function equal(left: string, right: string): boolean {
    const a = Buffer.from(left), b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
  }
  return {
    signIn(account, secret) {
      if (!Object.hasOwn(identities, account) || typeof secret !== 'string' || secret.length > 512) return null;
      const key = account as Account;
      if (!equal(secret, secrets[key])) return null;
      const token = randomBytes(32).toString('base64url');
      sessions.set(token, { identity: identities[key], expires: Date.now() + 8 * 60 * 60 * 1000 });
      return token;
    },
    signOut(token) { sessions.delete(token); },
    verifier: { async verifyAccessToken(token) {
      const session = sessions.get(token);
      if (!session || session.expires <= Date.now()) { sessions.delete(token); throw new Error('Authentication failed.'); }
      return Object.freeze({ ...session.identity });
    } },
  };
}
