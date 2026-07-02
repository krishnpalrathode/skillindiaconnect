import { MOCK_SSR_ORIGIN } from '@/mocks/ssr-origin';
import type { ApiError } from './client';

// Server Component-only fetch. Node's fetch() has no implicit origin, so it
// always needs an absolute URL — unlike client.ts's API_BASE, which can stay
// relative because the browser resolves it against the current page origin.
//
// When mocking is enabled, this must dial the exact origin handlers.ts uses
// for its Node-side absolute BASE (see mocks/ssr-origin.ts) — the Node MSW
// server registered in instrumentation.ts matches on byte-identical origin.
const SERVER_API_BASE =
  process.env['NEXT_PUBLIC_API_MOCKING'] === 'enabled'
    ? `${MOCK_SSR_ORIGIN}/api/v1`
    : `${process.env['NEXT_PUBLIC_API_URL'] ?? ''}/api/v1`;

export class ServerApiError extends Error {
  constructor(public readonly error: ApiError) {
    super(error.detail);
    this.name = 'ServerApiError';
  }
}

/**
 * Fetch a JSON API endpoint from a Server Component during SSR.
 *
 * Returns the raw parsed JSON body — unlike client.ts's apiFetch, callers
 * unwrap the envelope themselves since shapes differ (`{ data }` for a single
 * resource vs. `{ data, nextCursor }` for a cursor-paginated list).
 *
 * Always `cache: 'no-store'`: job search results vary per query string, and
 * Next.js's fetch cache would otherwise serve stale results across different
 * filter combinations.
 */
export async function serverFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${SERVER_API_BASE}${path}`, {
    ...init,
    cache: 'no-store',
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({
      code: 'UNKNOWN_ERROR',
      status: res.status,
      title: 'Error',
      detail: 'An unexpected error occurred.',
    }));
    throw new ServerApiError(body as ApiError);
  }

  return res.json() as Promise<T>;
}
