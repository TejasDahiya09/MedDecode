// Transport only. Feature services must validate JSON against confirmed contracts.
export type ApiErrorKind = 'configuration' | 'path' | 'http' | 'network' | 'response';

export class ApiError extends Error {
  constructor(message: string, readonly status: number | null, readonly kind: ApiErrorKind = 'http', options?: ErrorOptions) {
    super(message, options);
    this.name = 'ApiError';
  }
}

function endpointFor(path: string): URL {
  const base = import.meta.env.VITE_API_BASE_URL?.trim();
  if (!base) throw new ApiError('The application API is not configured.', null, 'configuration');
  let endpoint: URL;
  try {
    endpoint = base.startsWith('/') && !base.startsWith('//')
      ? new URL(base, window.location.origin)
      : new URL(base);
  }
  catch { throw new ApiError('The application API base must be an HTTP(S) URL or an origin-relative path.', null, 'configuration'); }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || /[?#]/.test(base)) {
    throw new ApiError('The application API base contains unsupported URL components.', null, 'configuration');
  }
  const hasControl = (value: string) => [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
  if (!path.startsWith('/') || path.startsWith('//') || /[\\?#\s]/.test(path) || hasControl(path)) {
    throw new ApiError('Use an application-relative API path without query or fragment text.', null, 'path');
  }
  // Reject encoded separators, dot segments and nested encodings before URL canonicalization.
  for (const segment of path.split('/')) {
    let decoded: string;
    try { decoded = decodeURIComponent(segment); }
    catch { throw new ApiError('The API path contains invalid encoding.', null, 'path'); }
    if (decoded === '.' || decoded === '..' || /[/%\\?#\s]/.test(decoded) || hasControl(decoded)) {
      throw new ApiError('The API path contains unsupported or traversing segments.', null, 'path');
    }
  }
  endpoint.pathname = endpoint.pathname.replace(/\/+$/, '') + path;
  return endpoint;
}

export async function requestJson<T = unknown>(path: string, init: RequestInit = {}): Promise<T | undefined> {
  const endpoint = endpointFor(path);
  const headers = new Headers(init.headers);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  try {
    const response = await fetch(endpoint, { ...init, headers });
    if (!response.ok) throw new ApiError(`The request could not be completed (${response.status}).`, response.status, 'http');
    if (init.method?.toUpperCase() === 'HEAD' || response.status === 204 || response.status === 205) return undefined;
    const text = await response.text();
    if (!text.trim()) return undefined;
    const media = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
    if (media !== 'application/json' && !/^application\/[a-z0-9!#$&^_.+-]+\+json$/.test(media)) {
      throw new ApiError('The application API returned an unexpected response type.', response.status, 'response');
    }
    try { return JSON.parse(text) as T; }
    catch { throw new ApiError('The application API returned malformed JSON.', response.status, 'response'); }
  } catch (error) {
    if (init.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error;
    if (error instanceof ApiError) throw error;
    throw new ApiError('The application API could not be reached or read.', null, 'network', { cause: error });
  }
}

export async function requestAuthenticatedJson<T = unknown>(path: string, accessToken: string, init: RequestInit = {}): Promise<T | undefined> {
  if (!accessToken.trim()) throw new ApiError('An authenticated session is required.', 401, 'http');
  const headers = new Headers(init.headers);
  if (headers.has('Authorization')) throw new ApiError('Authorization is managed by the session transport.', null, 'configuration');
  headers.set('Authorization', `Bearer ${accessToken}`);
  return requestJson<T>(path, { ...init, headers });
}
