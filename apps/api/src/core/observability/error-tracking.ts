/**
 * S8-H3 — error tracking (Sentry-compatible) with mandatory PII redaction.
 *
 * DESIGN: the SDK is loaded LAZILY and OPTIONALLY.
 *
 *  - No `SENTRY_DSN` → tracking is inert. The app must run identically with no
 *    error tracker configured, which is how local development and CI run.
 *  - The `@sentry/node` package is resolved at runtime rather than imported at
 *    the top level, so the dependency is not required to build or boot. If it
 *    is absent, this logs once and stays inert rather than crashing the
 *    process — an observability dependency must never be able to take down the
 *    thing it observes.
 *
 * THE REDACTION IS THE POINT. An error tracker is the highest-risk PII channel
 * in the system: it ships request bodies, headers, query strings and local
 * scope automatically, and it ships them to a third party. H2 verified that
 * logs and audit rows are clean; that verification says nothing about a tracker
 * that serialises whatever it can reach. Every event therefore passes through
 * the SAME denylist (redaction.ts) in `beforeSend`, and the pieces most likely
 * to carry PII — request body, headers, cookies, query string — are dropped
 * outright rather than filtered, because there is no operational question those
 * answer that the redacted context does not.
 */
import { Logger } from '@nestjs/common';
import { redactText, redactValue } from './redaction';
import { getRequestContext } from './request-context';

const logger = new Logger('ErrorTracking');

interface SentryLike {
  init(options: Record<string, unknown>): void;
  captureException(err: unknown, context?: Record<string, unknown>): void;
  captureMessage(msg: string, context?: Record<string, unknown>): void;
}

let sentry: SentryLike | null = null;
let initialised = false;

interface SentryEvent {
  request?: {
    data?: unknown;
    headers?: Record<string, string>;
    cookies?: unknown;
    query_string?: unknown;
    url?: string;
  };
  user?: Record<string, unknown>;
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  message?: string;
  breadcrumbs?: unknown[];
  exception?: unknown;
  tags?: Record<string, string>;
}

/**
 * The redaction hook. Exported so it can be unit-tested directly — a
 * `beforeSend` that is only exercised through a live SDK is a hook nobody
 * verifies until it has already leaked something.
 */
export function redactSentryEvent(event: SentryEvent): SentryEvent {
  if (event.request) {
    // Dropped wholesale rather than filtered: a request body may contain a
    // password, an OTP, a passport number or a cover letter, and none of them
    // help diagnose a stack trace. The url is kept but stripped of its query
    // string, which is where identifiers and tokens travel.
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.query_string;
    if (event.request.headers) {
      const safe: Record<string, string> = {};
      for (const [k, v] of Object.entries(event.request.headers)) {
        const lower = k.toLowerCase();
        // An allowlist, not a denylist: headers are attacker- and
        // client-controlled, so anything not explicitly known-safe is dropped.
        if (['content-type', 'user-agent', 'x-request-id', 'accept-language'].includes(lower)) {
          safe[k] = redactText(String(v));
        }
      }
      event.request.headers = safe;
    }
    if (event.request.url) event.request.url = redactText(event.request.url.split('?')[0]!);
  }

  // Identify the actor by opaque id only — never by email or name.
  if (event.user) {
    event.user = { id: event.user.id ?? event.user.userId, role: event.user.role };
  }

  if (event.extra) event.extra = redactValue(event.extra) as Record<string, unknown>;
  if (event.contexts) event.contexts = redactValue(event.contexts) as Record<string, unknown>;
  if (event.message) event.message = redactText(event.message);
  // Breadcrumbs replay recent activity and routinely include request data.
  if (event.breadcrumbs) event.breadcrumbs = redactValue(event.breadcrumbs) as unknown[];
  if (event.exception) event.exception = redactValue(event.exception) as unknown;

  return event;
}

export function initErrorTracking(): void {
  if (initialised) return;
  initialised = true;

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    logger.log('SENTRY_DSN not set — error tracking is inert');
    return;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@sentry/node') as SentryLike;
    mod.init({
      dsn,
      environment: process.env.NODE_ENV ?? 'development',
      release: process.env.APP_RELEASE,
      // Performance tracing off by default: it multiplies event volume and
      // this system already exports its own latency histograms.
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
      // Do NOT let the SDK attach request bodies in the first place; the
      // beforeSend hook is the second line of defence, not the only one.
      sendDefaultPii: false,
      maxBreadcrumbs: 20,
      beforeSend: (event: SentryEvent) => redactSentryEvent(event),
    });
    sentry = mod;
    logger.log('error tracking initialised (PII redaction active)');
  } catch (err) {
    logger.warn(
      `@sentry/node not installed — error tracking stays inert: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

/** Report a handled or unhandled error, with correlation context attached. */
export function captureError(err: unknown, extra?: Record<string, unknown>): void {
  if (!sentry) return;
  const ctx = getRequestContext();
  try {
    sentry.captureException(err, {
      tags: { requestId: ctx?.requestId ?? 'none', route: ctx?.route ?? 'none' },
      user: ctx?.userId ? { id: ctx.userId, role: ctx.role } : undefined,
      extra: redactValue(extra ?? {}) as Record<string, unknown>,
    });
  } catch {
    // Never let the tracker's failure become the application's failure.
  }
}
