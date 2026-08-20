/*
  Skill India Connect — app-shell service worker.

  ── Read this before changing anything ──────────────────────────────────────
  This app has a privacy contract: viewer-aware DTOs where an OMITTED FIELD IS
  THE GUARANTEE, and short-expiry signed URLs for documents and resumes. A
  caching mistake here does not degrade performance — it serves one user's data
  to another on a shared phone.

  Two rules make that structurally impossible rather than merely unlikely:

  1. ALLOWLIST, NEVER DENYLIST. Nothing is cached unless it positively matches
     SHELL_PREFIXES below. A denylist fails open the day someone adds an
     endpoint and forgets to exclude it; an allowlist fails closed.

  2. NON-MATCHING REQUESTS ARE NEVER INTERCEPTED. For anything outside the
     allowlist we return without calling event.respondWith(), so the browser
     handles the request natively and it never enters this file's code path at
     all. The API is not "excluded from caching" — it is not seen.

  The API is a DIFFERENT ORIGIN in production (NEXT_PUBLIC_API_URL → Render), as
  is R2. The same-origin check on its own therefore already rejects every API
  call, every signed document URL and every resume PDF. The path allowlist is a
  second, independent gate on top of that.

  No build step, no dependency, no generated manifest — deliberately. Next
  content-hashes /_next/static/*, so a deploy produces NEW filenames and a
  cache-first strategy on them is self-invalidating. That removes the main
  reason to pull in a precache-manifest library, and leaves the caching rules
  readable in one screen, which matters more here than features.
*/

/*
  Bump when the CACHING LOGIC changes — not on every deploy. Hashed asset URLs
  invalidate themselves; this version only exists so an activate can drop caches
  written by an older version of this file.
*/
const CACHE = 'sic-shell-v1';

const OFFLINE_URL = '/offline.html';

/*
  The complete allowlist. Same-origin GET requests under these prefixes only.

  Every entry is a STATIC, PUBLIC, NON-PERSONAL asset:
    /_next/static/     content-hashed JS, CSS and fonts
    /icons/            PWA icons (Unit 1)
    /brand/  /hero/    brand and marketing imagery
    /flags/            country flag SVGs for the dial-code picker
    /resume-templates/ TEMPLATE PREVIEW THUMBNAILS — not user resumes. A
                       generated resume is a short-expiry SIGNED R2 URL on a
                       different origin and can never match this list.
*/
const SHELL_PREFIXES = [
  '/_next/static/',
  '/icons/',
  '/brand/',
  '/hero/',
  '/flags/',
  '/resume-templates/',
];

/*
  Never cache these even though they are same-origin GETs.
    /mockServiceWorker.js  MSW's worker — caching it would pin a dev tool
    /sw.js                 this file; a cached copy would defeat the kill switch
*/
const NEVER = ['/mockServiceWorker.js', '/sw.js'];

function isShellAsset(request) {
  if (request.method !== 'GET') return false;

  const url = new URL(request.url);

  // Rejects the API origin and R2 outright, before any path matching.
  if (url.origin !== self.location.origin) return false;

  if (NEVER.includes(url.pathname)) return false;

  return SHELL_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

self.addEventListener('install', (event) => {
  // The offline page is the ONLY thing precached: it is the one response that
  // must exist when the network does not.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: 'reload' })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  /*
    NAVIGATIONS — network only, with an offline fallback.

    HTML is deliberately NOT cached. Every page in this app fetches its data
    client-side with an in-memory token, so the server-rendered HTML carries no
    user data today — but caching it would mean that the day someone server-
    renders something personal, it silently starts leaking. Network-only also
    means a deploy is picked up on the very next navigation, with no stale-shell
    class of bug to reason about.
  */
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(CACHE);
        return (await cache.match(OFFLINE_URL)) ?? Response.error();
      }),
    );
    return;
  }

  if (!isShellAsset(request)) {
    // Not ours. Return WITHOUT respondWith so the browser handles it natively —
    // API calls, signed URLs and everything else bypass this worker entirely.
    return;
  }

  // Cache-first: these URLs are hashed or static, so a hit is always correct.
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((response) => {
          // Only store a clean, complete same-origin response. An opaque or
          // error response cached here would be served forever.
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
