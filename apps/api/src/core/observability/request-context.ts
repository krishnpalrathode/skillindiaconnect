/**
 * S8-H3 — per-request correlation context, carried on AsyncLocalStorage.
 *
 * Every log line, metric and error report emitted while handling a request gets
 * the same `requestId`, so an incident can be reconstructed from a single
 * search instead of by correlating timestamps by eye. The alternative —
 * threading a context object through every service signature — is invasive and
 * gets forgotten exactly where it matters, in the error paths.
 *
 * `userId`/`role` are attached AFTER the auth guard resolves them, so early
 * lines (rate-limit rejections, auth failures) carry the requestId alone. That
 * is correct: the request is not yet attributable to anyone.
 *
 * NOTE: userId is an opaque uuid and is NOT PII under the project's rules —
 * it identifies a row, not a person, and it is what makes a report actionable.
 * Phone/email/etc. never enter this context; see redaction.ts.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export interface RequestContext {
  requestId: string;
  method: string;
  route: string;
  startedAt: number;
  userId?: string;
  role?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/** Enrich the active context once authentication has identified the caller. */
export function setRequestPrincipal(userId: string, role: string): void {
  const ctx = storage.getStore();
  if (ctx) {
    ctx.userId = userId;
    ctx.role = role;
  }
}

export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Express middleware establishing the context.
 *
 * An inbound `x-request-id` is honoured so a trace survives across services and
 * from the frontend — but it is LENGTH-CAPPED and pattern-checked before use,
 * because it lands in log lines and an unbounded client-controlled string is a
 * log-injection and log-volume vector.
 */
export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.header(REQUEST_ID_HEADER);
  const requestId =
    inbound && /^[A-Za-z0-9._-]{1,64}$/.test(inbound) ? inbound : randomUUID();

  res.setHeader(REQUEST_ID_HEADER, requestId);

  storage.run(
    {
      requestId,
      method: req.method,
      // `originalUrl` carries the query string (and therefore user input), so
      // only the path is recorded. Route params are still concrete ids here;
      // that is intentional — they are what make a trace useful — and they are
      // opaque uuids, not personal data.
      route: req.path,
      startedAt: Date.now(),
    },
    () => next(),
  );
}
