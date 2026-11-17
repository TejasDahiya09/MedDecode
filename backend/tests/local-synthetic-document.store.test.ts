import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { createLocalSyntheticDocumentStore } from '../src/services/local-synthetic-document.store.js';
import { createS3WorkerDocumentReader } from '../src/services/worker-document.reader.js';
import type { WorkerJobClaim } from '../src/types/worker-jobs.js';

const bucket = 'meddecode-local-synthetic';
const key = 'private/prescriptions/10000000-0000-4000-8000-000000000001/source.pdf';
const bytes = Buffer.from('%PDF-1.4\nfictional content\n%%EOF');

test('local synthetic store preserves bytes and rejects invalid paths, types and buckets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'meddecode-synthetic-storage-'));
  try {
    const store = await createLocalSyntheticDocumentStore({ root, bucket });
    await store.storage.upload({ objectKey: key, fileType: 'application/pdf', bytes });
    const object = await store.client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const chunks: Buffer[] = [];
    for await (const chunk of object.Body) chunks.push(Buffer.from(chunk));
    assert.deepEqual(Buffer.concat(chunks), bytes);
    const claim: WorkerJobClaim = { jobId: '20000000-0000-4000-8000-000000000002', userId: '30000000-0000-4000-8000-000000000003', prescriptionId: '10000000-0000-4000-8000-000000000001', attemptCount: 1, claimGeneration: 1, leaseExpiresAt: '2030-01-01T00:00:00Z', storageProvider: 'aws_s3', storageBucket: bucket, objectKey: key, fileType: 'application/pdf', inputReference: null };
    const reader = createS3WorkerDocumentReader({ region: 'local', bucket, client: store.client });
    const staged = await reader.download(claim, new AbortController().signal);
    try { assert.deepEqual(await readFile(staged.path), bytes); } finally { await staged.cleanup(); }
    await assert.rejects(reader.download({ ...claim, prescriptionId: '40000000-0000-4000-8000-000000000004' }, new AbortController().signal));
    await assert.rejects(store.storage.upload({ objectKey: key, fileType: 'application/pdf', bytes }));
    await assert.rejects(store.storage.upload({ objectKey: '../outside', fileType: 'application/pdf', bytes }));
    await assert.rejects(store.storage.upload({ objectKey: key.replace('.pdf', '.png'), fileType: 'image/png', bytes }));
    await assert.rejects(store.storage.upload({ objectKey: key.replace('.pdf', '.jpg'), fileType: 'image/jpeg', bytes: Buffer.alloc(10 * 1024 * 1024 + 1) }));
    for (const sample of [
      { ext: 'jpg', type: 'image/jpeg' as const, content: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) },
      { ext: 'png', type: 'image/png' as const, content: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) },
    ]) {
      const imageKey = key.replace('.pdf', `.${sample.ext}`);
      await store.storage.upload({ objectKey: imageKey, fileType: sample.type, bytes: sample.content });
      await store.storage.delete(imageKey);
    }
    await assert.rejects(store.client.send(new GetObjectCommand({ Bucket: 'other', Key: key })));
    const abort = new AbortController(); abort.abort();
    await assert.rejects(store.client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: abort.signal }));
    await store.storage.delete(key);
    await assert.rejects(store.client.send(new GetObjectCommand({ Bucket: bucket, Key: key })));
  } finally { await rm(root, { recursive: true, force: true }); }
});
