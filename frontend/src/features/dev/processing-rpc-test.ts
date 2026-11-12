export const approvedPrescriptionId = '79dac9bf-4ea2-4949-acfa-caea7c301040';
export const testBackendOrigin = 'http://127.0.0.1:3001';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const timestamp = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const exactKeys = (value: object, expected: readonly string[]) => {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
};

export class RpcPanelError extends Error {
  constructor(readonly status: number | null, message: string) { super(message); this.name = 'RpcPanelError'; }
}

export type SafeResponse = { readonly status: number; readonly body: unknown };

export async function requestTestBackend(path: string, accessToken: string, init: RequestInit = {}): Promise<SafeResponse> {
  if (!accessToken.trim()) throw new RpcPanelError(401, 'The authenticated session is unavailable.');
  if (!path.startsWith('/api/v1/') || path.includes('?') || path.includes('#') || path.includes('\\')) {
    throw new RpcPanelError(null, 'The local test request path is invalid.');
  }
  const headers = new Headers(init.headers);
  if (headers.has('Authorization')) throw new RpcPanelError(null, 'Authorization is managed internally.');
  headers.set('Authorization', `Bearer ${accessToken}`);
  headers.set('Accept', 'application/json');
  let response: Response;
  try {
    response = await fetch(new URL(path, testBackendOrigin), { ...init, headers });
  } catch {
    throw new RpcPanelError(null, 'The isolated backend could not be reached.');
  }
  let body: unknown;
  try { body = await response.json(); }
  catch { throw new RpcPanelError(response.status, 'The isolated backend returned malformed JSON.'); }
  if (!response.ok) throw new RpcPanelError(response.status, response.status === 401 ? 'Authentication failed.' : `The isolated backend rejected the request (${response.status}).`);
  return { status: response.status, body };
}

export function verifiedIdentity(value: unknown, expectedUserId: string): boolean {
  if (!value || typeof value !== 'object' || !exactKeys(value, ['user'])) return false;
  const user = (value as { user?: unknown }).user;
  if (!user || typeof user !== 'object') return false;
  const candidate = user as Record<string, unknown>;
  if (!exactKeys(candidate, typeof candidate.email === 'string' ? ['email', 'id'] : ['id'])) return false;
  return candidate.id === expectedUserId && uuid.test(expectedUserId);
}

export function verifiedOwnedPrescription(value: unknown): boolean {
  if (!value || typeof value !== 'object' || !exactKeys(value, ['prescription'])) return false;
  const prescription = (value as { prescription?: unknown }).prescription;
  if (!prescription || typeof prescription !== 'object' || !exactKeys(prescription, [
    'created_at', 'file_size_bytes', 'file_type', 'id', 'prescription_date', 'processed_at', 'status', 'updated_at'
  ])) return false;
  const row = prescription as Record<string, unknown>;
  return row.id === approvedPrescriptionId && row.status === 'uploaded' &&
    ['image/jpeg', 'image/png', 'application/pdf'].includes(String(row.file_type)) &&
    (row.file_size_bytes === null || (typeof row.file_size_bytes === 'string' && /^(0|[1-9]\d*)$/.test(row.file_size_bytes))) &&
    timestamp(row.created_at) && timestamp(row.updated_at) &&
    (row.prescription_date === null || typeof row.prescription_date === 'string') &&
    (row.processed_at === null || timestamp(row.processed_at));
}

export type Processing = null | { readonly job_id: string; readonly status: 'queued'; readonly created_at: string; readonly started_at: null; readonly completed_at: null };

export function processingStatus(value: unknown): Processing | undefined {
  if (!value || typeof value !== 'object' || !exactKeys(value, ['prescription_id', 'processing'])) return undefined;
  const candidate = value as Record<string, unknown>;
  if (candidate.prescription_id !== approvedPrescriptionId) return undefined;
  if (candidate.processing === null) return null;
  if (!candidate.processing || typeof candidate.processing !== 'object' || !exactKeys(candidate.processing, [
    'completed_at', 'created_at', 'job_id', 'started_at', 'status'
  ])) return undefined;
  const job = candidate.processing as Record<string, unknown>;
  if (typeof job.job_id !== 'string' || !uuid.test(job.job_id) || job.status !== 'queued' ||
      !timestamp(job.created_at) || job.started_at !== null || job.completed_at !== null) return undefined;
  return job as Processing;
}

export type Submission = { readonly jobId: string; readonly createdAt: string };

export function verifiedSubmission(value: unknown, expectedCreated: boolean, expectedJobId?: string): Submission | null {
  if (!value || typeof value !== 'object' || !exactKeys(value, ['job', 'prescription_id', 'submission'])) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.prescription_id !== approvedPrescriptionId || !candidate.job || typeof candidate.job !== 'object' ||
      !candidate.submission || typeof candidate.submission !== 'object' ||
      !exactKeys(candidate.job, ['created_at', 'id', 'status']) || !exactKeys(candidate.submission, ['created'])) return null;
  const job = candidate.job as Record<string, unknown>;
  const submission = candidate.submission as Record<string, unknown>;
  if (typeof job.id !== 'string' || !uuid.test(job.id) || job.status !== 'queued' || !timestamp(job.created_at) ||
      submission.created !== expectedCreated || (expectedJobId !== undefined && job.id !== expectedJobId)) return null;
  return { jobId: job.id, createdAt: job.created_at as string };
}
