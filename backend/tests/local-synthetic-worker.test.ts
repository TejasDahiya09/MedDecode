import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startLocalSyntheticWorker } from '../src/services/local-synthetic-worker.js';
import type { DisabledProcessingWorkerComposition } from '../src/services/processing-worker.composition.js';

const local = { database: 'meddecode_local_ocr_demo', login: 'meddecode_local_ocr_worker', address: '127.0.0.1', port: 5433, version: 17, marker: 'meddecode-fictional-local-ocr-v1', isSuperuser: false, canCreateRole: false, canCreateDatabase: false };

test('local worker refuses hosted, wrong or privileged identities before constructing worker', async () => {
  let constructed = false;
  for (const identity of [ { ...local, address: '10.0.0.1' }, { ...local, database: 'postgres' }, { ...local, login: 'postgres' }, { ...local, isSuperuser: true }, { ...local, marker: 'wrong' } ]) {
    await assert.rejects(startLocalSyntheticWorker({ explicitOptIn: true, hostedWorkerEnabled: false,
      identity: { async readIdentity() { return identity; } }, makeComposition: () => { constructed = true; throw new Error('must not construct'); } }));
  }
  await assert.rejects(startLocalSyntheticWorker({ explicitOptIn: true, hostedWorkerEnabled: true,
    identity: { async readIdentity() { return local; } }, makeComposition: () => { constructed = true; throw new Error('must not construct'); } }));
  assert.equal(constructed, false);
});

test('verified local worker recovers before starting and stops the injected runtime', async () => {
  const events: string[] = [];
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const composition = {
    async recoverExpired() { events.push('recovery'); },
    runtime: { async start() { events.push('start'); await waiting; }, async stop() { events.push('stop'); release(); } },
  } as unknown as DisabledProcessingWorkerComposition;
  const worker = await startLocalSyntheticWorker({ explicitOptIn: true, hostedWorkerEnabled: false,
    identity: { async readIdentity() { return local; } }, makeComposition: () => composition });
  assert.deepEqual(events, ['recovery', 'start']);
  await worker.stop();
  assert.deepEqual(events, ['recovery', 'start', 'stop']);
});

test('continuous wrapper restarts the existing runtime after separate jobs', async () => {
  let starts = 0;
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const composition = {
    async recoverExpired() {},
    runtime: { async start() { starts++; if (starts >= 3) await waiting; }, async stop() { release(); } },
  } as unknown as DisabledProcessingWorkerComposition;
  const worker = await startLocalSyntheticWorker({ explicitOptIn: true, hostedWorkerEnabled: false,
    identity: { async readIdentity() { return local; } }, makeComposition: () => composition });
  const deadline = Date.now() + 2000;
  while (starts < 3 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
  await worker.stop();
  assert.equal(starts, 3);
});
