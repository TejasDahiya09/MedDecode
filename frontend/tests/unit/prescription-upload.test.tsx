import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRoutes } from '../../src/app/App';
import { AppProviders } from '../../src/providers/AppProviders';
import { isPrescriptionAutoSubmitEnabled, isPrescriptionUploadResult, prescriptionUploadField, uploadPrescription } from '../../src/features/prescriptions/prescription-upload';
import { createAuthTestClient, testSession } from './auth-test-client';

const prescriptionId = '10000000-0000-4000-8000-000000000001';
const successfulResponse = {
  prescription_id: prescriptionId,
  upload: { state: 'stored', mime_type: 'application/pdf', size_bytes: 14 },
  processing: { requested: false, job_id: null },
} as const;

const confirmedResponse = {
  prescription_id: prescriptionId,
  upload: { state: 'stored', mime_type: 'application/pdf', size_bytes: 14 },
  processing: { requested: true, job_id: '20000000-0000-4000-8000-000000000002' },
} as const;

const unconfirmedResponse = {
  prescription_id: prescriptionId,
  upload: { state: 'stored', mime_type: 'application/pdf', size_bytes: 14 },
  processing: { requested: null, job_id: null, submission: 'unconfirmed' },
} as const;

beforeEach(() => {
  vi.stubEnv('VITE_API_BASE_URL', '/backend');
  vi.stubEnv('VITE_PRESCRIPTION_AUTO_SUBMIT_ENABLED', 'false');
  vi.stubEnv('VITE_PRESCRIPTION_AUTO_SUBMIT_BACKEND_ENABLED', 'false');
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
    expect(String(url)).toBe(`${window.location.origin}/api/v1/prescriptions/upload`);
    expect(init?.method).toBe('POST');
    expect(headers.get('Authorization')).toBe(`Bearer ${testSession.access_token}`);
    expect(headers.has('X-MedDecode-Auto-Submit')).toBe(false);
    expect(headers.has('Content-Type')).toBe(false);
    expect(init?.body).toBeInstanceOf(FormData);
    expect((init?.body as FormData).get(prescriptionUploadField)).toBe(file);
    expect([...(init?.body as FormData).keys()]).toEqual(['file']);
  });

  it('rejects malformed, fabricated, or processing-started responses', async () => {
    for (const response of [
      undefined,
      { ...successfulResponse, prescription_id: 'not-a-uuid' },
      { ...successfulResponse, processing: { requested: true, job_id: 'fake' } },
      { ...successfulResponse, processing: { requested: null, job_id: null } },
      { ...successfulResponse, private_object_key: 'must-not-pass' },
    ]) {
      const transport = vi.fn(async () => response);
      await expect(uploadPrescription(new File(['x'], 'x.pdf'), testSession.access_token, { transport })).rejects.toThrow('unexpected response');
    }
    expect(isPrescriptionUploadResult(successfulResponse)).toBe(true);
    expect(isPrescriptionUploadResult(confirmedResponse)).toBe(true);
    expect(isPrescriptionUploadResult(unconfirmedResponse)).toBe(true);
  });

  it('requires explicit frontend opt-in and backend readiness before sending the negotiation header', async () => {
    expect(isPrescriptionAutoSubmitEnabled()).toBe(false);
    vi.stubEnv('VITE_PRESCRIPTION_AUTO_SUBMIT_ENABLED', 'true');
    expect(isPrescriptionAutoSubmitEnabled()).toBe(false);
    vi.stubEnv('VITE_PRESCRIPTION_AUTO_SUBMIT_BACKEND_ENABLED', 'true');
    expect(isPrescriptionAutoSubmitEnabled()).toBe(true);

    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(confirmedResponse), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(uploadPrescription(new File(['synthetic-data'], 'synthetic.pdf', { type: 'application/pdf' }), testSession.access_token, {
      autoSubmit: isPrescriptionAutoSubmitEnabled(),
    })).resolves.toEqual(confirmedResponse);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(new Headers(init?.headers).get('X-MedDecode-Auto-Submit')).toBe('v1');
  });

  it('does not send the opt-in header if either rollout setting is disabled', async () => {
    vi.stubEnv('VITE_PRESCRIPTION_AUTO_SUBMIT_ENABLED', 'true');
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(successfulResponse), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    await uploadPrescription(new File(['synthetic-data'], 'synthetic.pdf', { type: 'application/pdf' }), testSession.access_token, {
      autoSubmit: isPrescriptionAutoSubmitEnabled(),
    });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(new Headers(init?.headers).has('X-MedDecode-Auto-Submit')).toBe(false);
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

  it('explains backend signature and malformed-document validation responses', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => String(input).endsWith('/api/v1/auth/me')
      ? new Response(JSON.stringify({ user: testSession.user }), { headers: { 'Content-Type': 'application/json' } })
      : new Response(JSON.stringify({ error: { code: 'FILE_SIGNATURE_MISMATCH', message: 'File content does not match a supported document type.' } }), {
          status: 422,
          headers: { 'Content-Type': 'application/json' },
        }));
    mount(fetchMock);
    fireEvent.change(screen.getByLabelText('Choose prescription file'), { target: { files: [new File(['synthetic-data'], 'synthetic.pdf', { type: 'application/pdf' })] } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload prescription' }));
    expect(await screen.findAllByText(/document content does not match its declared type or appears malformed/i)).toHaveLength(2);
    expect(screen.queryByText('Prescription uploaded successfully')).toBeNull();
  });

  it('confirms genuine support for image uploads (JPEG, PNG) and honest hosted worker status', async () => {
    const imageUploadResponse = {
      prescription_id: prescriptionId,
      upload: { state: 'stored', mime_type: 'image/jpeg', size_bytes: 4096 },
      processing: { requested: false, job_id: null },
    };
    const fetchMock = vi.fn<typeof fetch>(async (input) => String(input).endsWith('/api/v1/auth/me')
      ? new Response(JSON.stringify({ user: testSession.user }), { headers: { 'Content-Type': 'application/json' } })
      : new Response(JSON.stringify(imageUploadResponse), { status: 201, headers: { 'Content-Type': 'application/json' } }));
    mount(fetchMock);
    fireEvent.change(screen.getByLabelText('Choose prescription file'), { target: { files: [new File(['synthetic-image-data'], 'scan.jpg', { type: 'image/jpeg' })] } });
    expect(screen.getByText(/Supported format \(PDF, JPEG, PNG\)/i)).toBeTruthy();
    expect(screen.getByText(/Hosted worker currently disabled/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Upload prescription' }));
    expect(await screen.findByText(prescriptionId)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Start OCR & Analysis/i })).toBeTruthy();
    expect(screen.getByText(/Hosted cloud worker is currently disabled/i)).toBeTruthy();
  });

  it('navigates to the result page after confirmed automatic submission', async () => {
    vi.stubEnv('VITE_PRESCRIPTION_AUTO_SUBMIT_ENABLED', 'true');
    vi.stubEnv('VITE_PRESCRIPTION_AUTO_SUBMIT_BACKEND_ENABLED', 'true');
    const jobId = confirmedResponse.processing.job_id;
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/me')) {
        return new Response(JSON.stringify({ user: testSession.user }), { headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/api/v1/prescriptions/upload')) {
        return new Response(JSON.stringify(confirmedResponse), { status: 201, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/processing-status')) {
        return new Response(JSON.stringify({
          prescription_id: prescriptionId,
          processing: { job_id: jobId, status: 'queued', created_at: '2026-11-14T00:00:00Z', started_at: null, completed_at: null },
        }), { headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith(`/api/v1/prescriptions/${prescriptionId}`)) {
        return new Response(JSON.stringify({ prescription: { ...successfulResponse.upload, id: prescriptionId, file_type: 'application/pdf', file_size_bytes: '14', status: 'queued', prescription_date: null, created_at: '2026-11-14T00:00:00Z', updated_at: '2026-11-14T00:00:00Z', processed_at: null } }), { headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } });
    });
    mount(fetchMock);
    fireEvent.change(screen.getByLabelText('Choose prescription file'), { target: { files: [new File(['synthetic-data'], 'synthetic.pdf', { type: 'application/pdf' })] } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload prescription' }));

    expect(await screen.findByText('Prescription Details & Results')).toBeTruthy();
    expect(await screen.findByText('Queued')).toBeTruthy();
    const uploadCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/api/v1/prescriptions/upload'));
    expect(uploadCall).toBeTruthy();
    expect(new Headers(uploadCall?.[1]?.headers).get('X-MedDecode-Auto-Submit')).toBe('v1');
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/v1/prescriptions/upload'))).toHaveLength(1);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/process'))).toBe(false);
  });
});
