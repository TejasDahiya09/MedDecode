import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../../src/app/App';
import { AppProviders } from '../../src/providers/AppProviders';
import { isPrescriptionUploadResult, prescriptionUploadField, uploadPrescription } from '../../src/features/prescriptions/prescription-upload';
import { createAuthTestClient, testSession } from './auth-test-client';

const prescriptionId = '10000000-0000-4000-8000-000000000001';
const successfulResponse = {
  prescription_id: prescriptionId,
  upload: { state: 'stored', mime_type: 'application/pdf', size_bytes: 14 },
  processing: { requested: false, job_id: null },
} as const;

beforeEach(() => {
  vi.stubEnv('VITE_API_BASE_URL', '/backend');
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});

describe('prescription upload transport', () => {
  it('sends the authenticated file using the exact backend multipart contract', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(successfulResponse), { status: 201, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const file = new File(['synthetic-data'], 'synthetic.pdf', { type: 'application/pdf' });
    await expect(uploadPrescription(file, testSession.access_token)).resolves.toEqual(successfulResponse);
    const [url, init] = fetchMock.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(String(url)).toBe(`${window.location.origin}/backend/api/v1/prescriptions/upload`);
    expect(init?.method).toBe('POST');
    expect(headers.get('Authorization')).toBe(`Bearer ${testSession.access_token}`);
    expect(headers.has('Content-Type')).toBe(false);
    expect(init?.body).toBeInstanceOf(FormData);
    expect((init?.body as FormData).get(prescriptionUploadField)).toBe(file);
    expect([...(init?.body as FormData).keys()]).toEqual(['file']);
  });

  it('rejects malformed, fabricated, or processing-started responses', async () => {
    for (const response of [undefined, { ...successfulResponse, prescription_id: 'not-a-uuid' }, { ...successfulResponse, processing: { requested: true, job_id: 'fake' } }, { ...successfulResponse, private_object_key: 'must-not-pass' }]) {
      const transport = vi.fn(async () => response);
      await expect(uploadPrescription(new File(['x'], 'x.pdf'), testSession.access_token, transport)).rejects.toThrow('unexpected response');
    }
    expect(isPrescriptionUploadResult(successfulResponse)).toBe(true);
  });

  it.each([[401, 'http'], [400, 'http'], [413, 'http'], [415, 'http'], [500, 'http']])('preserves backend HTTP failure %i', async (status, kind) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status, headers: { 'Content-Type': 'application/json' } })));
    await expect(uploadPrescription(new File(['x'], 'x.pdf'), testSession.access_token)).rejects.toMatchObject({ status, kind });
  });

  it('preserves a safe network failure without exposing file contents', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('synthetic network detail'); }));
    await expect(uploadPrescription(new File(['private-file-content'], 'x.pdf'), testSession.access_token)).rejects.toMatchObject({ kind: 'network', status: null });
  });
});

describe('upload page integration', () => {
  function mount(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>) {
    vi.stubGlobal('fetch', fetchMock);
    return render(<MemoryRouter initialEntries={['/upload-prescription']}><AppProviders authClient={createAuthTestClient()} initialAuthSession={testSession}><AppRoutes /></AppProviders></MemoryRouter>);
  }

  it('prevents duplicate submission, shows the real ID, and never fabricates a result', async () => {
    let resolveUpload!: (response: Response) => void;
    const pending = new Promise<Response>(resolve => { resolveUpload = resolve; });
    const fetchMock = vi.fn<typeof fetch>((input) => String(input).endsWith('/api/v1/auth/me')
      ? Promise.resolve(new Response(JSON.stringify({ user: testSession.user }), { headers: { 'Content-Type': 'application/json' } }))
      : pending);
    mount(fetchMock);
    fireEvent.change(screen.getByLabelText('Choose prescription file'), { target: { files: [new File(['synthetic-data'], 'synthetic.pdf', { type: 'application/pdf' })] } });
    const upload = screen.getByRole('button', { name: 'Upload prescription' });
    fireEvent.click(upload); fireEvent.click(upload);
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/v1/prescriptions/upload'))).toHaveLength(1));
    resolveUpload(new Response(JSON.stringify(successfulResponse), { status: 201, headers: { 'Content-Type': 'application/json' } }));
    expect(await screen.findByText(prescriptionId)).toBeTruthy();
    expect(screen.getAllByText(/processing has not been requested/i)).toHaveLength(2);
    expect(screen.queryByText(/Sample Analysis — predefined example/)).toBeNull();
    expect(screen.queryByText('RX-DEMO-01')).toBeNull();
  });

  it('keeps the fictional sample isolated from a real upload', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => String(input).endsWith('/api/v1/auth/me')
      ? new Response(JSON.stringify({ user: testSession.user }), { headers: { 'Content-Type': 'application/json' } })
      : new Response(JSON.stringify(successfulResponse), { status: 201, headers: { 'Content-Type': 'application/json' } }));
    mount(fetchMock);
    fireEvent.change(screen.getByLabelText('Choose prescription file'), { target: { files: [new File(['synthetic-data'], 'synthetic.pdf', { type: 'application/pdf' })] } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload prescription' }));
    expect(await screen.findByText(prescriptionId)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /View Sample Analysis/ }));
    expect(await screen.findByText('RX-DEMO-01')).toBeTruthy();
    expect(screen.getByText(prescriptionId)).toBeTruthy();
    expect(screen.getByText(/Fictional sample. Not an analysis of your selected file/)).toBeTruthy();
  });

  it('makes an expired session actionable and does not show success', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => String(input).endsWith('/api/v1/auth/me')
      ? new Response(JSON.stringify({ user: testSession.user }), { headers: { 'Content-Type': 'application/json' } })
      : new Response('{}', { status: 401, headers: { 'Content-Type': 'application/json' } }));
    mount(fetchMock);
    fireEvent.change(screen.getByLabelText('Choose prescription file'), { target: { files: [new File(['synthetic-data'], 'synthetic.pdf', { type: 'application/pdf' })] } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload prescription' }));
    expect(await screen.findAllByText(/session expired or is invalid/i)).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Sign in again' })).toBeTruthy();
    expect(screen.queryByText('Prescription uploaded')).toBeNull();
  });
});
