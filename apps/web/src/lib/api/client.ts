// Module-level token store. Set by AuthProvider; read by every authenticated request.
// NEVER stored in localStorage/sessionStorage — in-memory only.
let _accessToken: string | null = null;
let _refreshFn: (() => Promise<string | null>) | null = null;

export function setAccessToken(token: string | null) {
  _accessToken = token;
}

export function setRefreshFn(fn: (() => Promise<string | null>) | null) {
  _refreshFn = fn;
}

/** Reset module-level state. Used in test teardown only. */
export function resetClient() {
  _accessToken = null;
  _refreshFn = null;
}

// ─── Error types ──────────────────────────────────────────────────────────────

export interface ApiError {
  code: string;
  status: number;
  title: string;
  detail: string;
  meta?: {
    errors?: Array<{ field: string; code: string }>;
    [key: string]: unknown;
  };
}

export class ApiRequestError extends Error {
  constructor(public readonly error: ApiError) {
    super(error.detail);
    this.name = 'ApiRequestError';
  }
}

// ─── Core fetch ───────────────────────────────────────────────────────────────

// When MSW mocking is enabled the service worker intercepts same-origin requests.
// MSW handlers register with relative paths (/api/v1), which resolve to localhost:3000.
// Sending to http://localhost:3001 would miss the service worker entirely.
const API_BASE =
  process.env['NEXT_PUBLIC_API_MOCKING'] === 'enabled'
    ? '/api/v1'
    : `${process.env['NEXT_PUBLIC_API_URL'] ?? ''}/api/v1`;

async function rawFetch(path: string, init: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((init.headers as Record<string, string>) ?? {}),
  };
  if (_accessToken) {
    headers['Authorization'] = `Bearer ${_accessToken}`;
  }
  return fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...init,
    headers,
  });
}

/**
 * Fetch a JSON API endpoint.
 *
 * Unwraps the `{ data }` envelope on success and throws `ApiRequestError` from
 * the RFC-7807 error envelope on failure. On a 401, attempts one silent refresh
 * before giving up (pass `skipRefreshRetry = true` for the refresh call itself
 * to prevent infinite recursion).
 */
export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  skipRefreshRetry = false,
): Promise<T> {
  let res = await rawFetch(path, init);

  // Single silent refresh on 401
  if (res.status === 401 && !skipRefreshRetry && _refreshFn) {
    const newToken = await _refreshFn().catch(() => null);
    if (newToken) {
      _accessToken = newToken;
      res = await rawFetch(path, init);
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({
      code: 'UNKNOWN_ERROR',
      title: 'Error',
      detail: 'An unexpected error occurred.',
    }));
    // Stamp the transport status LAST so `error.status` is always the real HTTP
    // status — consumers gate UX on it (404 → notFound, 403 → forbidden), and a
    // body that omits or mis-states `status` must never leave it undefined.
    throw new ApiRequestError({ ...(body as ApiError), status: res.status });
  }

  if (res.status === 204) return undefined as T;

  const json = (await res.json()) as { data?: T };
  return (json.data ?? json) as T;
}

/**
 * Fetch a NON-JSON endpoint (the audit-log CSV export) as a Blob, with the same
 * auth + single-silent-refresh behavior as apiFetch. Errors still arrive as the
 * RFC-7807 JSON envelope (e.g. 422 EXPORT_TOO_LARGE) and throw ApiRequestError.
 */
export async function apiFetchBlob(
  path: string,
  init: RequestInit = {},
): Promise<{ blob: Blob; filename: string | null }> {
  let res = await rawFetch(path, init);

  if (res.status === 401 && _refreshFn) {
    const newToken = await _refreshFn().catch(() => null);
    if (newToken) {
      _accessToken = newToken;
      res = await rawFetch(path, init);
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({
      code: 'UNKNOWN_ERROR',
      title: 'Error',
      detail: 'An unexpected error occurred.',
    }));
    throw new ApiRequestError({ ...(body as ApiError), status: res.status });
  }

  const disposition = res.headers.get('Content-Disposition') ?? '';
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? null;
  return { blob: await res.blob(), filename };
}

/**
 * Like `apiFetch`, but returns the raw parsed JSON body without unwrapping
 * `{ data }`. Needed for cursor-paginated endpoints whose envelope is
 * `{ data, nextCursor }` — unwrapping would discard `nextCursor`.
 */
export async function apiFetchRaw<T>(
  path: string,
  init: RequestInit = {},
  skipRefreshRetry = false,
): Promise<T> {
  let res = await rawFetch(path, init);

  if (res.status === 401 && !skipRefreshRetry && _refreshFn) {
    const newToken = await _refreshFn().catch(() => null);
    if (newToken) {
      _accessToken = newToken;
      res = await rawFetch(path, init);
    }
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({
      code: 'UNKNOWN_ERROR',
      title: 'Error',
      detail: 'An unexpected error occurred.',
    }));
    // Same status-stamping rule as apiFetch — transport status is ground truth.
    throw new ApiRequestError({ ...(body as ApiError), status: res.status });
  }

  return res.json() as Promise<T>;
}
