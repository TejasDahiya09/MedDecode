// No browser-facing endpoints or authentication scheme have been agreed yet.
// Feature services must validate response data against their eventual contracts.
export class ApiError extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function requestJson<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const base = import.meta.env.VITE_API_BASE_URL?.trim();
  if (!base) throw new ApiError('The application API is not configured.', null);
  if (!path.startsWith('/') || path.startsWith('//') || /[\\?#]|\.\./.test(path)) {
    throw new ApiError('Use an application-relative API path without query or fragment text.', null);
  }
  const endpoint = new URL(base.endsWith('/') ? base : `${base}/`);
  if (!['http:', 'https:'].includes(endpoint.protocol)) throw new ApiError('Unsupported API protocol.', null);
  endpoint.pathname = endpoint.pathname.replace(/\/$/, '') + path;
  const headers = new Headers(init.headers);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  const response = await fetch(endpoint, { ...init, headers });
  if (!response.ok) throw new ApiError(`The request could not be completed (${response.status}).`, response.status);
  if (response.status === 204) return undefined as T;
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new ApiError('The application API returned an unexpected response.', response.status);
  }
  return response.json() as Promise<T>;
}
