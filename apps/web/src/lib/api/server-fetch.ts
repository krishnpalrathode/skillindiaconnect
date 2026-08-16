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
  process.env.NEXT_PUBLIC_API_MOCKING === 'enabled'
    ? `${MOCK_SSR_ORIGIN}/api/v1`
    : `${process.env.NEXT_PUBLIC_API_URL ?? ''}/api/v1`;

export class ServerApiError extends Error {
  constructor(public readonly error: ApiError) {
    super(error.detail);
    this.name = 'ServerApiError';
  }
}

export interface ServerFetchOptions extends RequestInit {
  /**
   * Seconds to cache this response for, instead of the `no-store` default.
   *
   * For the LANDING page only, where one fixed query is served to every
   * anonymous visitor: without this each visit would be an uncached API call on
   * the most-trafficked page we have, and a marketing page that waits on the
   * API is a marketing page that loses the visitor. A minute of staleness on a
   * "recently posted" list is invisible to a reader and cannot be wrong in a
   * way that matters.
   *
   * Do NOT reach for this on the search page: those responses vary per query
   * string, which is exactly what the default guards against.
   */
  revalidate?: number;
}

/**
 * Fetch a JSON API endpoint from a Server Component during SSR.
 *
 * Returns the raw parsed JSON body — unlike client.ts's apiFetch, callers
 * unwrap the envelope themselves since shapes differ (`{ data }` for a single
 * resource vs. `{ data, meta }` for a paginated list).
 *
 * `cache: 'no-store'` by default: job search results vary per query string, and
 * Next.js's fetch cache would otherwise serve stale results across different
 * filter combinations. Pass `revalidate` to opt a specific fixed query into
 * time-based caching.
 */
export async function serverFetch<T>(path: string, init: ServerFetchOptions = {}): Promise<T> {
  const { revalidate, ...rest } = init;

  const res = await fetch(`${SERVER_API_BASE}${path}`, {
    ...rest,
    // Exactly one of these — Next.js rejects `cache: 'no-store'` combined with
    // a revalidate window, and silently keeping both would drop the caching.
    ...(revalidate === undefined ? { cache: 'no-store' as const } : { next: { revalidate } }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({
      code: 'UNKNOWN_ERROR',
      title: 'Error',
      detail: 'An unexpected error occurred.',
    }));
    // Stamp the transport status LAST — `error.status` must always be the real
    // HTTP status (SSR pages gate notFound() on it), never undefined.
    throw new ServerApiError({ ...(body as ApiError), status: res.status });
  }

  return res.json() as Promise<T>;
}
