import type { DisabledProcessingWorkerComposition } from './processing-worker.composition.js';

const expected = {
  database: 'meddecode_local_ocr_demo',
  login: 'meddecode_local_ocr_worker',
  address: '127.0.0.1',
  port: 5433,
  marker: 'meddecode-fictional-local-ocr-v1',
} as const;

export interface LocalSyntheticIdentityReader {
  readIdentity(): Promise<{
    database: string; login: string; address: string; port: number; version: number;
    marker: string; isSuperuser: boolean; canCreateRole: boolean; canCreateDatabase: boolean;
  }>;
}

/** No connections or workers are started until the dedicated database is verified. */
export async function startLocalSyntheticWorker(options: {
  readonly explicitOptIn: boolean;
  readonly hostedWorkerEnabled: boolean;
  readonly identity: LocalSyntheticIdentityReader;
  readonly makeComposition: () => DisabledProcessingWorkerComposition;
  readonly recoveryIntervalMs?: number;
}): Promise<{ stop(): Promise<void>; done: Promise<void> }> {
  if (!options.explicitOptIn || options.hostedWorkerEnabled) throw new Error('Local synthetic worker is disabled.');
  const interval = options.recoveryIntervalMs ?? 30000;
  if (!Number.isSafeInteger(interval) || interval < 1000 || interval > 300000) throw new Error('Local recovery interval is invalid.');
  const identity = await options.identity.readIdentity();
  if (identity.database !== expected.database || identity.login !== expected.login || identity.address !== expected.address ||
      identity.port !== expected.port || identity.version !== 17 || identity.marker !== expected.marker ||
      identity.isSuperuser || identity.canCreateRole || identity.canCreateDatabase) {
    throw new Error('Local synthetic database identity verification failed.');
  }
  const composition = options.makeComposition();
  let stopping = false;
  let recovery: Promise<unknown> | undefined;
  const recover = () => {
    if (!recovery && !stopping) {
      recovery = composition.recoverExpired(50).catch(() => undefined).finally(() => { recovery = undefined; });
    }
    return recovery;
  };
  // Initial recovery must succeed before claims are permitted.
  await composition.recoverExpired(50);
  const timer = setInterval(() => { void recover(); }, interval);
  const done = (async () => {
    try {
      while (!stopping) {
        await composition.runtime.start();
        // A disabled or failed runtime must never become a busy loop.
        if (!stopping) await new Promise<void>(resolve => setTimeout(resolve, 100));
      }
    }
    finally { clearInterval(timer); await recovery; }
  })();
  return {
    done,
    async stop() {
      if (stopping) { await done; return; }
      stopping = true; clearInterval(timer);
      await composition.runtime.stop();
      await done;
    },
  };
}
