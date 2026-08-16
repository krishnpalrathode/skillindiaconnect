/**
 * Client mirror of the passport validity rule.
 *
 * The SERVER is the gate — `document.service` refuses the upload and
 * `apply-gate.service` refuses the application. This exists so the candidate
 * learns the rule while looking at the date field, instead of after picking a
 * file, waiting for an upload and getting a 422 back. Same pattern as the salary
 * ceiling and the 80% resume gate elsewhere in this app.
 *
 * ⚠️ These two numbers are duplicated from
 * `apps/api/src/candidate/passport-validity.ts`. Changing one means changing
 * both; the API's copy is the one that actually enforces, and the reasoning for
 * the values lives there.
 */

/** Below this many days remaining, upload and apply are refused. */
export const PASSPORT_MIN_VALIDITY_DAYS = 180;

/** Below this many days remaining, the candidate is warned but not blocked. */
export const PASSPORT_WARNING_DAYS = 365;

export type PassportValidityStatus =
  | 'missing'
  | 'expired'
  | 'below_minimum'
  | 'expiring_soon'
  | 'ok';

export interface PassportValidity {
  status: PassportValidityStatus;
  daysRemaining: number | null;
  blocks: boolean;
}

/** Whole days to expiry, compared at date granularity (never partial days). */
export function daysUntil(expiryIso: string, now: Date = new Date()): number {
  const [y, m, d] = expiryIso.split('-').map(Number);
  if (!y || !m || !d) return Number.NaN;
  const expiry = new Date(y, m - 1, d).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((expiry - today) / 86_400_000);
}

/**
 * Assess a `YYYY-MM-DD` expiry string. Empty input is 'missing' rather than an
 * error — an untouched field is not yet a mistake, and flagging it while the
 * candidate is still typing would scold them mid-entry.
 */
export function assessPassportValidity(
  expiryIso: string | null | undefined,
  now: Date = new Date(),
): PassportValidity {
  if (!expiryIso) return { status: 'missing', daysRemaining: null, blocks: true };
  const daysRemaining = daysUntil(expiryIso, now);
  if (Number.isNaN(daysRemaining)) {
    return { status: 'missing', daysRemaining: null, blocks: true };
  }
  if (daysRemaining <= 0) return { status: 'expired', daysRemaining, blocks: true };
  if (daysRemaining < PASSPORT_MIN_VALIDITY_DAYS) {
    return { status: 'below_minimum', daysRemaining, blocks: true };
  }
  if (daysRemaining < PASSPORT_WARNING_DAYS) {
    return { status: 'expiring_soon', daysRemaining, blocks: false };
  }
  return { status: 'ok', daysRemaining, blocks: false };
}

/**
 * The earliest expiry date that satisfies the rule, as `YYYY-MM-DD`.
 *
 * Fed to the date input's `min`, so the native picker greys out dates that would
 * be rejected — the cheapest possible way to communicate the rule.
 */
export function earliestAcceptableExpiry(now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + PASSPORT_MIN_VALIDITY_DAYS);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
