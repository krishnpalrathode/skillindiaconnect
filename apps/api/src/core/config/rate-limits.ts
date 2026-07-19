/**
 * S8-H1 — rate-limit configuration, in one place and env-tunable.
 *
 * The DEFAULTS are exactly the contract in `.claude/rules/api-conventions.md`
 * (global authed 100/min, search 30/min); an unset environment behaves exactly
 * as before. They are overridable so a load run can raise the ceiling and
 * measure the PATH rather than the throttler — see docs/performance-report.md.
 *
 * Read from `process.env` rather than ConfigService because `@Throttle({...})`
 * is a decorator argument, evaluated at class-decoration time before DI exists.
 *
 * ⚠️ KNOWN GAP (not introduced here, see app-api.module.ts): ThrottlerModule is
 * still backed by IN-MEMORY storage, so these limits are enforced PER REPLICA.
 * api-conventions.md specifies Redis-backed limiting. With N API replicas the
 * effective global limit is N × the number below. Raising replica count without
 * fixing this multiplies every limit here.
 */

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

const MINUTE = 60_000;

export const RATE_LIMITS = {
  /** Global authed ceiling, applied by the APP_GUARD ThrottlerGuard. */
  global: {
    ttl: MINUTE,
    limit: positiveInt(process.env.RATE_LIMIT_GLOBAL_PER_MIN, 100),
  },
  /** Public job search — the highest-traffic public path. */
  search: {
    ttl: MINUTE,
    limit: positiveInt(process.env.RATE_LIMIT_SEARCH_PER_MIN, 30),
  },
} as const;
