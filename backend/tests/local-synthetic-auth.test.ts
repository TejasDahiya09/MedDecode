import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLocalSyntheticAuth } from '../src/services/local-synthetic-auth.js';

test('fictional sessions reject arbitrary identities and remain isolated per user', async () => {
  const secrets = { alice: 'a'.repeat(40), bob: 'b'.repeat(40) };
  assert.throws(() => createLocalSyntheticAuth(secrets, false));
  assert.throws(() => createLocalSyntheticAuth({ alice: secrets.alice, bob: secrets.alice }, true));
  const auth = createLocalSyntheticAuth(secrets, true);
  assert.equal(auth.signIn('10000000-0000-4000-8000-000000000001', secrets.alice), null);
  assert.equal(auth.signIn('alice', secrets.bob), null);
  const alice = auth.signIn('alice', secrets.alice)!;
  const bob = auth.signIn('bob', secrets.bob)!;
  assert.notEqual(alice, bob);
  assert.notEqual((await auth.verifier.verifyAccessToken(alice)).userId, (await auth.verifier.verifyAccessToken(bob)).userId);
  await assert.rejects(auth.verifier.verifyAccessToken('fabricated'));
  auth.signOut(alice);
  await assert.rejects(auth.verifier.verifyAccessToken(alice));
  assert.equal((await auth.verifier.verifyAccessToken(bob)).email, 'bob@synthetic.invalid');
});
