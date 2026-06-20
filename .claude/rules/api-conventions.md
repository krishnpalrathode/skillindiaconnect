# API conventions

- **Versioning:** URI `/api/v1`; `/health` is unversioned.
- **Response envelope:** `{ data, meta? }`. Admin/offset lists include
  `meta: { page, pageSize, total, totalPages }`.
- **Error envelope (RFC 7807-style):**
  `{ type, title, status, detail, code, meta? }`. The machine-readable `code` is
  the contract (e.g. `PROFILE_INCOMPLETE`, `MANDATORY_DOCS_MISSING`,
  `ILLEGAL_TRANSITION`); `title`/`detail` are human, localizable copy. Validation
  errors carry `meta.errors[]` with per-field codes.
- **Pagination:** cursor/keyset for candidate-facing feeds (`{ data, nextCursor }`,
  `?cursor=&limit=`); offset for admin tables (`?page=&pageSize=&sort=field:dir`).
- **Filtering/sorting:** whitelisted per endpoint — never arbitrary field access.
- **Rate limiting (Redis-backed):** global authed 100/min; auth/OTP 5/min/IP +
  5/hour/phone; resume sends 5/day/candidate; search 30/min. Return `RateLimit-*`.
- **Idempotency:** checkout and resume-send accept `Idempotency-Key` (Redis, 24h).
- **Webhooks:** verify the signature BEFORE parsing the body (raw-body middleware
  on webhook routes only); dedupe on `(provider, eventId)` via `webhook_events`;
  respond 200 fast and do heavy work via BullMQ. Unsigned/invalid → 401, logged.
