import { constants } from 'node:fs';
import { lstat, open, realpath, unlink } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import type { GetObjectCommand } from '@aws-sdk/client-s3';
import { PrescriptionStorageError, type PrescriptionStorage, type PrescriptionStorageUpload } from './prescription-storage.service.js';

const keyPattern = /^private\/prescriptions\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/source\.(pdf|jpg|png)$/i;
const maximumBytes = 10 * 1024 * 1024;

function validContent(input: PrescriptionStorageUpload, extension: string): boolean {
  const bytes = input.bytes;
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > maximumBytes) return false;
  if (extension === 'pdf') return input.fileType === 'application/pdf' && bytes.subarray(0, 5).toString('ascii') === '%PDF-';
  if (extension === 'jpg') return input.fileType === 'image/jpeg' && bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return input.fileType === 'image/png' && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
}

/** Explicit development-only transport. It is never wired into application startup. */
export async function createLocalSyntheticDocumentStore(options: { readonly root: string; readonly bucket: string }): Promise<{
  storage: PrescriptionStorage;
  client: { send(command: GetObjectCommand, options?: { abortSignal?: AbortSignal }): Promise<{ Body: Readable }> };
}> {
  if (!isAbsolute(options.root) || options.bucket !== 'meddecode-local-synthetic') throw new Error('Local synthetic storage configuration is invalid.');
  const root = resolve(options.root);
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || await realpath(root) !== root) throw new Error('Local synthetic storage root is invalid.');
  const fileFor = (key: string): { file: string; extension: string } => {
    const match = keyPattern.exec(key);
    if (!match) throw new PrescriptionStorageError();
    return { file: join(root, `${match[1]!.toLowerCase()}.${match[2]!.toLowerCase()}`), extension: match[2]!.toLowerCase() };
  };
  const noFollow = constants.O_NOFOLLOW ?? 0;
  return {
    storage: {
      async upload(input) {
        let created: string | undefined;
        try {
          const { file, extension } = fileFor(input.objectKey);
          if (!validContent(input, extension)) throw new PrescriptionStorageError();
          const handle = await open(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow, 0o600);
          created = file;
          try { await handle.writeFile(input.bytes); } finally { await handle.close(); }
        } catch { if (created) await unlink(created).catch(() => undefined); throw new PrescriptionStorageError(); }
      },
      async delete(key) {
        try { await unlink(fileFor(key).file); } catch { throw new PrescriptionStorageError(); }
      },
    },
    client: {
      async send(command, requestOptions) {
        if (requestOptions?.abortSignal?.aborted || command.input.Bucket !== options.bucket || !command.input.Key) throw new PrescriptionStorageError();
        const { file } = fileFor(command.input.Key);
        let handle;
        try {
          const entry = await lstat(file);
          if (!entry.isFile() || entry.isSymbolicLink()) throw new PrescriptionStorageError();
          handle = await open(file, constants.O_RDONLY | noFollow);
          const info = await handle.stat();
          if (!info.isFile() || info.size < 1 || info.size > maximumBytes || requestOptions?.abortSignal?.aborted) throw new PrescriptionStorageError();
          const bytes = await handle.readFile(requestOptions?.abortSignal ? { signal: requestOptions.abortSignal } : undefined);
          if (bytes.length !== info.size || requestOptions?.abortSignal?.aborted) throw new PrescriptionStorageError();
          return { Body: Readable.from([bytes]) };
        } catch { throw new PrescriptionStorageError(); }
        finally { await handle?.close(); }
      },
    },
  };
}
