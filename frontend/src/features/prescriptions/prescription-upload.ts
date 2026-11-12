import { requestAuthenticatedJson } from '../../services/api-client';

export const prescriptionUploadField = 'file';

export type PrescriptionUploadResult = {
  prescription_id: string;
  upload: { state: 'stored'; mime_type: 'image/jpeg' | 'image/png' | 'application/pdf'; size_bytes: number };
  processing: { requested: false; job_id: null };
};

type AuthenticatedTransport = (path: string, accessToken: string, init?: RequestInit) => Promise<unknown | undefined>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const mimeTypes = new Set(['image/jpeg', 'image/png', 'application/pdf']);

function exactKeys(value: object, expected: readonly string[]) {
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return keys.length === sortedExpected.length && keys.every((key, index) => key === sortedExpected[index]);
}

export function isPrescriptionUploadResult(value: unknown): value is PrescriptionUploadResult {
  if (!value || typeof value !== 'object' || !exactKeys(value, ['prescription_id', 'processing', 'upload'])) return false;
  const candidate = value as Record<string, unknown>;
  const upload = candidate.upload;
  const processing = candidate.processing;
  return typeof candidate.prescription_id === 'string'
    && uuid.test(candidate.prescription_id)
    && !!upload && typeof upload === 'object'
    && exactKeys(upload, ['mime_type', 'size_bytes', 'state'])
    && (upload as Record<string, unknown>).state === 'stored'
    && typeof (upload as Record<string, unknown>).mime_type === 'string'
    && mimeTypes.has((upload as Record<string, unknown>).mime_type as string)
    && Number.isSafeInteger((upload as Record<string, unknown>).size_bytes)
    && ((upload as Record<string, unknown>).size_bytes as number) >= 0
    && !!processing && typeof processing === 'object'
    && exactKeys(processing, ['job_id', 'requested'])
    && (processing as Record<string, unknown>).requested === false
    && (processing as Record<string, unknown>).job_id === null;
}

export async function uploadPrescription(file: File, accessToken: string, transport: AuthenticatedTransport = requestAuthenticatedJson): Promise<PrescriptionUploadResult> {
  const body = new FormData();
  body.append(prescriptionUploadField, file);
  const response = await transport('/api/v1/prescriptions/upload', accessToken, { method: 'POST', body });
  if (!isPrescriptionUploadResult(response)) throw new Error('The upload service returned an unexpected response.');
  return response;
}
