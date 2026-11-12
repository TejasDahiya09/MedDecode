import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import FictionalIntelligenceDemo from '../../src/features/dev/FictionalIntelligenceDemo';

const token = 'development-token-not-rendered';
vi.mock('../../src/features/auth/AuthProvider', () => ({ useAuth: () => ({ getAccessToken: () => token }) }));

const response = { schema_version: '1.0', status: 'completed_with_warnings', medicines: [{ sequence_number: 1, extraction: { raw_text: 'Examplemed 10 mg', medicine_name: 'Examplemed', strength: { value: 10, unit: 'mg' }, instructions: 'One tablet once daily for 3 days' }, medicine_match: { status: 'matched', brand_name: 'Examplemed', dosage_form: 'tablet' } }], warnings: [{ code: 'DEVELOPMENT_FIXTURE_INJECTED_OCR', severity: 'info', message: 'Injected OCR only.' }] };

beforeEach(() => { vi.stubEnv('VITE_API_BASE_URL', '/backend'); vi.stubGlobal('fetch', vi.fn()); });

it('does not run on mount and renders only the explicit fictional fixture result', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(response), { headers: { 'Content-Type': 'application/json' } }));
  const { container } = render(<FictionalIntelligenceDemo />);
  expect(fetch).not.toHaveBeenCalled();
  expect(container.textContent).toContain('DEVELOPMENT FIXTURE / SIMULATED OCR');
  expect(container.textContent).not.toContain(token);
  fireEvent.click(screen.getByRole('button', { name: 'Run fictional intelligence fixture' }));
  expect(await screen.findByText('Examplemed')).toBeTruthy();
  expect(screen.getByText('DEVELOPMENT_FIXTURE_INJECTED_OCR')).toBeTruthy();
  expect(screen.queryByText(/alternative|price|recommendation/i)).toBeTruthy();
  const [url, init] = vi.mocked(fetch).mock.calls[0]!;
  expect(String(url)).toBe(`${window.location.origin}/backend/api/v1/development/fictional-intelligence-result`);
  expect(init?.method).toBe('POST');
  expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${token}`);
});

it('rejects malformed results without rendering medicine data', async () => {
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ status: 'completed' }), { headers: { 'Content-Type': 'application/json' } }));
  render(<FictionalIntelligenceDemo />);
  fireEvent.click(screen.getByRole('button', { name: 'Run fictional intelligence fixture' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('Examplemed')).toBeNull();
});
