import { requestAuthenticatedJson } from '../../services/api-client';

export const prescriptionUploadField = 'file';

export type PrescriptionUploadProcessing =
  | { requested: false; job_id: null }
  | { requested: true; job_id: string }
  | { requested: null; job_id: null; submission: 'unconfirmed' };

export type PrescriptionUploadResult = {
  prescription_id: string;
  upload: { state: 'stored'; mime_type: 'image/jpeg' | 'image/png' | 'application/pdf'; size_bytes: number };
  processing: PrescriptionUploadProcessing;
};

type AuthenticatedTransport = (path: string, accessToken: string, init?: RequestInit) => Promise<unknown | undefined>;
type UploadOptions = {
  readonly autoSubmit?: boolean;
  readonly transport?: AuthenticatedTransport;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const mimeTypes = new Set(['image/jpeg', 'image/png', 'application/pdf']);

function exactKeys(value: object, expected: readonly string[]) {
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return keys.length === sortedExpected.length && keys.every((key, index) => key === sortedExpected[index]);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUploadProcessing(value: unknown): value is PrescriptionUploadProcessing {
  if (!isObject(value)) return false;
  if (value.requested === false) {
    return value.job_id === null && exactKeys(value, ['job_id', 'requested']);
  }
  if (value.requested === true) {
    return typeof value.job_id === 'string'
      && uuid.test(value.job_id)
      && exactKeys(value, ['job_id', 'requested']);
  }
  return value.requested === null
    && value.job_id === null
    && value.submission === 'unconfirmed'
    && exactKeys(value, ['job_id', 'requested', 'submission']);
}

export function isPrescriptionAutoSubmitEnabled(): boolean {
  return import.meta.env.VITE_PRESCRIPTION_AUTO_SUBMIT_ENABLED === 'true'
    && import.meta.env.VITE_PRESCRIPTION_AUTO_SUBMIT_BACKEND_ENABLED === 'true';
}

export function isPrescriptionUploadResult(value: unknown): value is PrescriptionUploadResult {
  if (!isObject(value) || !exactKeys(value, ['prescription_id', 'processing', 'upload'])) return false;
  const candidate = value;
  const upload = candidate.upload;
  return typeof candidate.prescription_id === 'string'
    && uuid.test(candidate.prescription_id)
    && isObject(upload)
    && exactKeys(upload, ['mime_type', 'size_bytes', 'state'])
    && upload.state === 'stored'
    && typeof upload.mime_type === 'string'
    && mimeTypes.has(upload.mime_type)
    && Number.isSafeInteger(upload.size_bytes)
    && (upload.size_bytes as number) >= 0
    && isUploadProcessing(candidate.processing);
}

export async function uploadPrescription(
  file: File,
  accessToken: string,
  options: UploadOptions = {},
): Promise<PrescriptionUploadResult> {
  const body = new FormData();
  body.append(prescriptionUploadField, file);
  const response = await (options.transport ?? requestAuthenticatedJson)(
    '/api/v1/prescriptions/upload',
    accessToken,
    {
      method: 'POST',
      body,
      ...(options.autoSubmit ? { headers: { 'X-MedDecode-Auto-Submit': 'v1' } } : {}),
    },
  );
  if (!isPrescriptionUploadResult(response)) throw new Error('The upload service returned an unexpected response.');
  return response;
}
