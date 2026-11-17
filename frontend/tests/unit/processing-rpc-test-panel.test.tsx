import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import ProcessingRpcTestPanel from '../../src/features/dev/ProcessingRpcTestPanel';
import { approvedPrescriptionId, requestTestBackend } from '../../src/features/dev/processing-rpc-test';

const token = 'synthetic-secret-token-never-rendered';
const userId = '00000000-0000-4000-8000-000000000001';
vi.mock('../../src/features/auth/AuthProvider', () => ({ useAuth: () => ({ status: 'authenticated', user: { id: userId }, getAccessToken: () => token }) }));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => { window.localStorage.removeItem('meddecode.synthetic-cancellation.65624a5e-f197-465e-a34a-712f979e9624'); vi.stubEnv('VITE_API_BASE_URL', '/backend'); vi.stubGlobal('fetch', vi.fn()); vi.stubGlobal('confirm', vi.fn(() => true)); });

it('mounts without requests and never renders the access token', () => {
  const { container } = render(<ProcessingRpcTestPanel />);
  expect(fetch).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain(token);
  expect((screen.getByRole('button', { name: 'Run ownership check' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Confirm and submit first job' }) as HTMLButtonElement).disabled).toBe(true);
});

it('uses the isolated authenticated helper without exposing authorization', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(json({ user: { id: userId } }));
  render(<ProcessingRpcTestPanel />);
  fireEvent.click(screen.getByRole('button', { name: 'Run authentication check' }));
  await screen.findByText('Authenticated test account verified.');
  const [url, init] = vi.mocked(fetch).mock.calls[0]!;
  expect(String(url)).toBe(`${window.location.origin}/api/v1/auth/me`);
  expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${token}`);
  expect(document.body.textContent).not.toContain(token);
});

it('verifies the existing queued synthetic job using only authenticated reads', async () => {
  vi.mocked(fetch)
    .mockResolvedValueOnce(json({ user: { id: userId } }))
    .mockResolvedValueOnce(json({ prescription: { id: approvedPrescriptionId, file_type: 'application/pdf', file_size_bytes: '2484', status: 'queued', prescription_date: null, created_at: '2026-11-12T00:00:00Z', updated_at: '2026-11-12T00:00:00Z', processed_at: null } }))
    .mockResolvedValueOnce(json({ prescription_id: approvedPrescriptionId, processing: { job_id: '65624a5e-f197-465e-a34a-712f979e9624', status: 'queued', created_at: '2026-11-12T00:01:00Z', started_at: null, completed_at: null } }));
  render(<ProcessingRpcTestPanel />);
  fireEvent.click(screen.getByRole('button', { name: 'Verify existing synthetic job' }));
  await screen.findByText(/Signed-in account owns the approved queued synthetic job/);
  expect(fetch).toHaveBeenCalledTimes(3);
  for (const [, init] of vi.mocked(fetch).mock.calls) expect(init?.method ?? 'GET').toBe('GET');
  expect(document.body.textContent).not.toContain(token);
});

it('sends the approved cancellation only once after fresh authenticated owner and job checks', async () => {
  vi.mocked(fetch)
    .mockResolvedValueOnce(json({ user: { id: userId } }))
    .mockResolvedValueOnce(json({ prescription: { id: approvedPrescriptionId, file_type: 'application/pdf', file_size_bytes: '2484', status: 'queued', prescription_date: null, created_at: '2026-11-12T00:00:00Z', updated_at: '2026-11-12T00:00:00Z', processed_at: null } }))
    .mockResolvedValueOnce(json({ prescription_id: approvedPrescriptionId, processing: { job_id: '65624a5e-f197-465e-a34a-712f979e9624', status: 'queued', created_at: '2026-11-12T00:01:00Z', started_at: null, completed_at: null } }))
    .mockResolvedValueOnce(json({ prescription_id: approvedPrescriptionId, job_id: '65624a5e-f197-465e-a34a-712f979e9624', status: 'cancelled', cancelled_at: '2026-11-13T10:00:00Z', already_cancelled: false }));
  render(<ProcessingRpcTestPanel />);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel approved synthetic job once' }));
  await screen.findByText(/Cancellation response received/);
  expect(fetch).toHaveBeenCalledTimes(4);
  const [url, options] = vi.mocked(fetch).mock.calls[3]!;
  expect(String(url)).toBe(`${window.location.origin}/api/v1/prescriptions/${approvedPrescriptionId}/jobs/65624a5e-f197-465e-a34a-712f979e9624/cancel`);
  expect(options?.method).toBe('POST');
  expect(options?.body).toBe('{}');
  expect((screen.getByRole('button', { name: 'Cancel approved synthetic job once' }) as HTMLButtonElement).disabled).toBe(true);
  expect(document.body.textContent).not.toContain(token);
});

it('does not attempt cancellation when owner verification fails', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(json({ user: { id: userId } })).mockResolvedValueOnce(json({ error: {} }, 404));
  render(<ProcessingRpcTestPanel />);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel approved synthetic job once' }));
  await screen.findByText(/not accessible to this account/);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(vi.mocked(fetch).mock.calls.every(([, init]) => (init?.method ?? 'GET') === 'GET')).toBe(true);
});

it('never retries an ambiguous cancellation response', async () => {
  vi.mocked(fetch)
    .mockResolvedValueOnce(json({ user: { id: userId } }))
    .mockResolvedValueOnce(json({ prescription: { id: approvedPrescriptionId, file_type: 'application/pdf', file_size_bytes: '2484', status: 'queued', prescription_date: null, created_at: '2026-11-12T00:00:00Z', updated_at: '2026-11-12T00:00:00Z', processed_at: null } }))
    .mockResolvedValueOnce(json({ prescription_id: approvedPrescriptionId, processing: { job_id: '65624a5e-f197-465e-a34a-712f979e9624', status: 'queued', created_at: '2026-11-12T00:01:00Z', started_at: null, completed_at: null } }))
    .mockRejectedValueOnce(new Error('private failure'));
  render(<ProcessingRpcTestPanel />);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel approved synthetic job once' }));
  await screen.findByText(/Cancellation outcome is uncertain or rejected/);
  expect((screen.getByRole('button', { name: 'Cancel approved synthetic job once' }) as HTMLButtonElement).disabled).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(4);
  expect(document.body.textContent).not.toContain('private failure');
});

it('requires verified read-only checks and explicit confirmation before the first POST', async () => {
  vi.mocked(fetch)
    .mockResolvedValueOnce(json({ user: { id: userId } }))
    .mockResolvedValueOnce(json({ prescription: { id: approvedPrescriptionId, file_type: 'application/pdf', file_size_bytes: '2484', status: 'uploaded', prescription_date: null, created_at: '2026-11-12T00:00:00Z', updated_at: '2026-11-12T00:00:00Z', processed_at: null } }))
    .mockResolvedValueOnce(json({ prescription_id: approvedPrescriptionId, processing: null }))
    .mockResolvedValueOnce(json({ prescription_id: approvedPrescriptionId, job: { id: '20000000-0000-4000-8000-000000000001', status: 'queued', created_at: '2026-11-12T00:01:00Z' }, submission: { created: true } }, 202))
    .mockResolvedValueOnce(json({ prescription_id: approvedPrescriptionId, job: { id: '20000000-0000-4000-8000-000000000001', status: 'queued', created_at: '2026-11-12T00:01:00Z' }, submission: { created: false } }, 200));
  render(<ProcessingRpcTestPanel />);
  fireEvent.click(screen.getByRole('button', { name: 'Run authentication check' }));
  await screen.findByText('Authenticated test account verified.');
  fireEvent.click(screen.getByRole('button', { name: 'Run ownership check' }));
  await screen.findByText('Owned uploaded prescription verified.');
  fireEvent.click(screen.getByRole('button', { name: 'Run processing-status check' }));
  await screen.findByText('No processing job exists.');
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and submit first job' }));
  await screen.findByText(/Queued job created and verified/);
  expect(confirm).toHaveBeenCalledOnce();
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(4);
  expect(vi.mocked(fetch).mock.calls[3]?.[1]?.method).toBe('POST');
  expect((screen.getByRole('button', { name: 'Run authorized deduplication retry' }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Run authorized deduplication retry' }));
  await screen.findByText('Deduplication returned the same queued job.');
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(5);
  expect(vi.mocked(fetch).mock.calls[4]?.[1]?.method).toBe('POST');
});

it('does not submit when confirmation is declined', async () => {
  vi.stubGlobal('confirm', vi.fn(() => false));
  vi.mocked(fetch)
    .mockResolvedValueOnce(json({ user: { id: userId } }))
    .mockResolvedValueOnce(json({ prescription: { id: approvedPrescriptionId, file_type: 'application/pdf', file_size_bytes: '2484', status: 'uploaded', prescription_date: null, created_at: '2026-11-12T00:00:00Z', updated_at: '2026-11-12T00:00:00Z', processed_at: null } }))
    .mockResolvedValueOnce(json({ prescription_id: approvedPrescriptionId, processing: null }));
  render(<ProcessingRpcTestPanel />);
  fireEvent.click(screen.getByRole('button', { name: 'Run authentication check' }));
  await screen.findByText('Authenticated test account verified.');
  fireEvent.click(screen.getByRole('button', { name: 'Run ownership check' }));
  await screen.findByText('Owned uploaded prescription verified.');
  fireEvent.click(screen.getByRole('button', { name: 'Run processing-status check' }));
  await screen.findByText('No processing job exists.');
  fireEvent.click(screen.getByRole('button', { name: 'Confirm and submit first job' }));
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
});

it('reports a historical cancelled job without enabling a new submission', async () => {
  vi.mocked(fetch)
    .mockResolvedValueOnce(json({ user: { id: userId } }))
    .mockResolvedValueOnce(json({ prescription: { id: approvedPrescriptionId, file_type: 'application/pdf', file_size_bytes: '2484', status: 'uploaded', prescription_date: null, created_at: '2026-11-12T00:00:00Z', updated_at: '2026-11-12T00:00:00Z', processed_at: null } }))
    .mockResolvedValueOnce(json({ prescription_id: approvedPrescriptionId, processing: { job_id: '65624a5e-f197-465e-a34a-712f979e9624', status: 'cancelled', created_at: '2026-11-12T00:01:00Z', started_at: null, completed_at: '2026-11-13T10:00:00Z' } }));
  render(<ProcessingRpcTestPanel />);
  fireEvent.click(screen.getByRole('button', { name: 'Run authentication check' }));
  await screen.findByText('Authenticated test account verified.');
  fireEvent.click(screen.getByRole('button', { name: 'Run ownership check' }));
  await screen.findByText('Owned uploaded prescription verified.');
  fireEvent.click(screen.getByRole('button', { name: 'Run processing-status check' }));
  await screen.findByText('A historical cancelled job is recorded. No new submission was made.');
  expect((screen.getByRole('button', { name: 'Confirm and submit first job' }) as HTMLButtonElement).disabled).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(vi.mocked(fetch).mock.calls.every(([, init]) => (init?.method ?? 'GET') === 'GET')).toBe(true);
});

it('rejects malformed responses and does not leak raw failures', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(json({ user: { id: 'wrong-user' }, token }));
  const { container } = render(<ProcessingRpcTestPanel />);
  fireEvent.click(screen.getByRole('button', { name: 'Run authentication check' }));
  await screen.findByText('Unexpected verification response. No write was performed.');
  expect(container.textContent).not.toContain(token);
  expect((screen.getByRole('button', { name: 'Run ownership check' }) as HTMLButtonElement).disabled).toBe(true);
});

it('reports inaccessible prescriptions without claiming which account owns them', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(json({ user: { id: userId } })).mockResolvedValueOnce(json({ error: { message: 'private' } }, 404));
  render(<ProcessingRpcTestPanel />);
  fireEvent.click(screen.getByRole('button', { name: 'Verify existing synthetic job' }));
  await screen.findByText(/not accessible to this account \(HTTP 404\)/);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(document.body.textContent).not.toContain('private');
});

it('distinguishes unavailable processing status from a network failure', async () => {
  const queued = { prescription: { id: approvedPrescriptionId, file_type: 'application/pdf', file_size_bytes: '2484', status: 'queued', prescription_date: null, created_at: '2026-11-12T00:00:00Z', updated_at: '2026-11-12T00:00:00Z', processed_at: null } };
  vi.mocked(fetch).mockResolvedValueOnce(json({ user: { id: userId } })).mockResolvedValueOnce(json(queued)).mockResolvedValueOnce(json({ error: {} }, 503));
  render(<ProcessingRpcTestPanel />);
  fireEvent.click(screen.getByRole('button', { name: 'Verify existing synthetic job' }));
  await screen.findByText(/processing service is unavailable \(HTTP 503\)/i);
  expect(fetch).toHaveBeenCalledTimes(3);
});

it('explains that the pre-submission check is not the queued-job check', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(json({ user: { id: userId } })).mockResolvedValueOnce(json({ prescription: { id: approvedPrescriptionId, file_type: 'application/pdf', file_size_bytes: '2484', status: 'queued', prescription_date: null, created_at: '2026-11-12T00:00:00Z', updated_at: '2026-11-12T00:00:00Z', processed_at: null } }));
  render(<ProcessingRpcTestPanel />);
  fireEvent.click(screen.getByRole('button', { name: 'Run authentication check' }));
  await screen.findByText('Authenticated test account verified.');
  fireEvent.click(screen.getByRole('button', { name: 'Run ownership check' }));
  await screen.findByText(/pre-submission check requires an uploaded prescription/);
  expect((screen.getByRole('button', { name: 'Confirm and submit first job' }) as HTMLButtonElement).disabled).toBe(true);
});

it('rejects caller-supplied authorization headers', async () => {
  await expect(requestTestBackend('/api/v1/auth/me', token, { headers: { Authorization: 'Bearer caller-value' } })).rejects.toThrow('Authorization is managed internally.');
  expect(fetch).not.toHaveBeenCalled();
});
