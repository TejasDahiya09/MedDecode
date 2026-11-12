import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, requestJson } from '../../src/services/api-client';

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.stubEnv('VITE_API_BASE_URL', 'https://service.invalid/base/');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

describe('API transport', () => {
  it.each(['', ' ', 'not a URL', '//other.invalid', 'ftp://service.invalid', 'https://user:pass@service.invalid', 'https://service.invalid?x=1', 'https://service.invalid#fragment'])('rejects invalid configuration %s', async (base) => {
    vi.stubEnv('VITE_API_BASE_URL', base);
    await expect(requestJson('/probe')).rejects.toMatchObject({ kind: 'configuration', status: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('supports the development proxy base', async () => {
    vi.stubEnv('VITE_API_BASE_URL', '/backend');
    fetchMock.mockResolvedValue(new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } }));
    await expect(requestJson('/probe')).resolves.toEqual({ ok: true });
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${window.location.origin}/backend/probe`);
  });
  it.each(['probe', '//other.invalid', '/../probe', '/./probe', '/%2e%2E/probe', '/%252e%252e/probe', '/%2fprobe', '/%5cprobe', '/probe?x=1', '/probe#x', '/%00probe', '/%zz', '/a\\b', '/a b'])('rejects unsafe path %s', async (path) => {
    await expect(requestJson(path)).rejects.toMatchObject({ kind: 'path' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each(['https://service.invalid/base', 'https://service.invalid/base/'])('preserves base prefix %s', async (base) => {
    vi.stubEnv('VITE_API_BASE_URL', base);
    fetchMock.mockResolvedValue(new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } }));
    expect(await requestJson('/probe')).toEqual({ ok: true });
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://service.invalid/base/probe');
  });
  it.each(['application/json', 'Application/JSON; charset=utf-8', 'application/problem+json'])('accepts JSON media type %s', async (type) => {
    fetchMock.mockResolvedValue(new Response('{"ok":true}', { headers: { 'Content-Type': type } }));
    expect(await requestJson('/probe')).toEqual({ ok: true });
  });
  it.each([204, 205])('handles bodyless status %i', async (status) => {
    fetchMock.mockResolvedValue(new Response(null, { status }));
    expect(await requestJson('/probe')).toBeUndefined();
  });
  it('handles empty success and HEAD', async () => {
    fetchMock.mockResolvedValueOnce(new Response('')).mockResolvedValueOnce(new Response(null));
    expect(await requestJson('/probe')).toBeUndefined();
    expect(await requestJson('/probe', { method: 'HEAD' })).toBeUndefined();
  });
  it('retains status for HTTP failures', async () => {
    fetchMock.mockResolvedValue(new Response('unavailable', { status: 503 }));
    await expect(requestJson('/probe')).rejects.toMatchObject({ kind: 'http', status: 503 });
  });
  it('distinguishes malformed JSON and non-JSON', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{', { headers: { 'Content-Type': 'application/json' } })).mockResolvedValueOnce(new Response('<html/>', { headers: { 'Content-Type': 'text/html' } }));
    await expect(requestJson('/probe')).rejects.toMatchObject({ kind: 'response', status: 200, message: expect.stringContaining('malformed JSON') });
    await expect(requestJson('/probe')).rejects.toMatchObject({ kind: 'response', status: 200, message: expect.stringContaining('response type') });
  });
  it('wraps network failures with their cause', async () => {
    const failure = new TypeError('offline');
    fetchMock.mockRejectedValue(failure);
    await expect(requestJson('/probe')).rejects.toMatchObject({ kind: 'network', cause: failure });
  });
  it('preserves recognizable cancellation', async () => {
    const controller = new AbortController();
    const cancellation = new DOMException('Cancelled', 'AbortError');
    controller.abort();
    fetchMock.mockRejectedValue(cancellation);
    await expect(requestJson('/probe', { signal: controller.signal })).rejects.toBe(cancellation);
  });
  it('preserves multipart body, options, signal and caller headers', async () => {
    const body = new FormData();
    body.append('synthetic', 'transport-only');
    const signal = new AbortController().signal;
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await requestJson('/probe', { method: 'POST', body, signal, credentials: 'omit', headers: { Accept: 'application/problem+json', 'X-Test': 'synthetic' } });
    const options = fetchMock.mock.calls[0][1]!;
    expect(options).toMatchObject({ method: 'POST', body, signal, credentials: 'omit' });
    expect(new Headers(options.headers).get('Accept')).toBe('application/problem+json');
    expect(new Headers(options.headers).get('X-Test')).toBe('synthetic');
    expect(new Headers(options.headers).has('Content-Type')).toBe(false);
  });
  it('adds the default Accept header', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await requestJson('/probe');
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('Accept')).toBe('application/json');
  });
  it('keeps the original ApiError construction supported', () => {
    expect(new ApiError('Failure', 400)).toMatchObject({ name: 'ApiError', status: 400, kind: 'http' });
  });
});
