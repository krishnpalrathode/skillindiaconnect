# API conventions

- **Versioning:** URI `/api/v1`; `/health` is unversioned.
- **Response envelope:** `{ data, meta? }`. Admin/offset lists include
  `meta: { page, pageSize, total, totalPages }`.
- **Error envelope (RFC 7807-style):**
  `{ type, title, status, detail, code, meta? }`. The machine-readable `code` is
  the contract (e.g. `PROFILE_INCOMPLETE`, `MANDATORY_DOCS_MISSING`,
  `ILLEGAL_TRANSITION`); `title`/`detail` are human, localizable copy. Validation
  errors carry `meta.errors[]` with per-field codes.
- **Pagination:** offset EVERYWHERE — `?page=&pageSize=` returning
  `{ data, meta: { page, pageSize, total, totalPages } }`. Admin tables also
  accept `&sort=field:dir`. Build the envelope with `resolvePaging` / `pageMeta`
  from `apps/api/src/core/pagination.ts` rather than recomputing it inline, so
  the clamping rules stay identical across endpoints.
  - Candidate-facing feeds used to be cursor/keyset (`{ data, nextCursor }`).
    That was changed deliberately: the product wants one pagination idiom across
    candidate, employer and admin, and numbered pages need a `total` that keyset
    cannot supply. Accept the known trade-off — under concurrent inserts an
    offset page can repeat or skip a row at a page boundary, which keyset made
    impossible. Every list here is ordered by a DESC total order with an `id`
    tiebreaker, so the drift is bounded to genuinely concurrent writes.
  - The one cursor holdout is `GET /admin/logs`, which is an append-heavy audit
    stream where keyset is the right tool and no numbered pager is exposed.
  - Only page 1 of the public job search is cached; deeper pages bypass the
    cache rather than multiplying the key space.
- **Filtering/sorting:** whitelisted per endpoint — never arbitrary field access.
- **Rate limiting (Redis-backed):** global authed 100/min; auth/OTP 5/min/IP +
  5/hour/phone; resume sends 5/day/candidate; search 30/min. Return `RateLimit-*`.
- **Idempotency:** checkout and resume-send accept `Idempotency-Key` (Redis, 24h).
- **Webhooks:** verify the signature BEFORE parsing the body (raw-body middleware
  on webhook routes only); dedupe on `(provider, eventId)` via `webhook_events`;
  respond 200 fast and do heavy work via BullMQ. Unsigned/invalid → 401, logged.
