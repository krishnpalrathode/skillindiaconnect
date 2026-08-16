/**
 * THE passport validity rule — one definition, read by every gate.
 *
 * ── Why six months ──────────────────────────────────────────────────────────
 * Not a product preference. Every GCC state this platform recruits into refuses
 * a work visa on a passport with less than six months left, and several airlines
 * refuse boarding on the same basis. A candidate who reaches Selected on a
 * five-month passport has their offer collapse at the visa stage — after the
 * employer has committed and often after they have given notice on their current
 * job. Blocking at upload costs them a renewal appointment; not blocking costs
 * them the placement.
 *
 * ── Why a year for the warning ──────────────────────────────────────────────
 * Passport renewal in India runs weeks to months (tatkaal is faster but costs
 * more, and rural applicants queue for police verification). A warning at six
 * months and one day would be a warning that arrives too late to act on. Twelve
 * months gives a worker time to renew through the ordinary channel, at ordinary
 * cost, before the hard gate ever applies to them.
 *
 * These are CONSTANTS rather than Settings on purpose: `SettingsService.get`
 * uses `findUniqueOrThrow`, so a new key needs a seeded row in every existing
 * environment, and this change is otherwise migration-free. The sibling
 * `passport-expiry.constants.ts` sets the same precedent.
 */

/** Below this many days remaining, the passport blocks upload and apply. */
export const PASSPORT_MIN_VALIDITY_DAYS = 180;

/** Below this many days remaining, the candidate is warned but not blocked. */
export const PASSPORT_WARNING_DAYS = 365;

export type PassportValidityStatus =
  /** No passport uploaded. */
  | 'missing'
  /** Expiry date is in the past. */
  | 'expired'
  /** Valid today, but under the six-month floor — blocks. */
  | 'below_minimum'
  /** Over the floor, under a year — warns only. */
  | 'expiring_soon'
  /** Over a year remaining. */
  | 'ok';

export interface PassportValidity {
  status: PassportValidityStatus;
  /** Whole days from today to expiry. Negative once expired; null when missing. */
  daysRemaining: number | null;
  /** True when this state must stop the candidate progressing. */
  blocks: boolean;
}

/**
 * Whole days between two dates, compared at DATE granularity.
 *
 * Midnight-normalised so a passport expiring later today is "0 days", not "-0.4
 * rounded to 0" — the same approach `passport-expiry.processor` already uses, so
 * the reminder emails and the gate never disagree about which day it is.
 */
export function daysUntil(expiry: Date, now: Date = new Date()): number {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((startOfDay(expiry) - startOfDay(now)) / 86_400_000);
}

export function assessPassportValidity(
  expiry: Date | null | undefined,
  now: Date = new Date(),
): PassportValidity {
  if (!expiry || Number.isNaN(expiry.getTime())) {
    return { status: 'missing', daysRemaining: null, blocks: true };
  }
  const daysRemaining = daysUntil(expiry, now);
  if (daysRemaining <= 0) return { status: 'expired', daysRemaining, blocks: true };
  if (daysRemaining < PASSPORT_MIN_VALIDITY_DAYS) {
    return { status: 'below_minimum', daysRemaining, blocks: true };
  }
  if (daysRemaining < PASSPORT_WARNING_DAYS) {
    return { status: 'expiring_soon', daysRemaining, blocks: false };
  }
  return { status: 'ok', daysRemaining, blocks: false };
}
