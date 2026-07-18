import { CompanyType } from '@prisma/client';

/**
 * Pure subunit money math for checkout — NO floats transit anywhere.
 *
 * Every amount in the billing surface is an INTEGER count of currency subunits
 * (paise for INR). This module is the single place the GST split is computed;
 * the client never derives tax (the checkout response is authoritative).
 */

export interface MoneyTotals {
  /** Base price, excluding GST. */
  amountSubunits: number;
  /** GST portion (0 for FOREIGN — zero-rated, see computeTotals). */
  gstSubunits: number;
  /** amountSubunits + gstSubunits — what the gateway charges. */
  totalSubunits: number;
}

function assertIntSubunits(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer subunit amount, got ${value}`);
  }
}

/**
 * Compute the checkout money split.
 *
 * - LOCAL (Indian company): GST applies — `gst = round(price × rate / 100)`,
 *   half-up, computed in PURE INTEGER arithmetic (`(price*rate + 50) / 100`
 *   floored) so no float ever carries a money value.
 * - FOREIGN (Gulf/overseas company): `gst = 0`. Tax rationale: a subscription
 *   sold to an overseas business is a ZERO-RATED export of services under
 *   Indian GST (IGST Act §16) — the rate is 0%, it is NOT an exempt/absent
 *   charge, which is why the schema still carries `gstSubunits: 0` explicitly
 *   rather than omitting the field.
 */
export function computeTotals(
  priceSubunits: number,
  companyType: CompanyType,
  gstRatePct: number,
): MoneyTotals {
  assertIntSubunits('priceSubunits', priceSubunits);
  if (!Number.isSafeInteger(gstRatePct) || gstRatePct < 0 || gstRatePct > 100) {
    throw new Error(`gstRatePct must be an integer 0–100, got ${gstRatePct}`);
  }

  const gstSubunits =
    companyType === CompanyType.LOCAL
      ? // Integer half-up rounding: floor((price*rate + 50) / 100). Safe range:
        // price ≤ 2^53/100 — far beyond any plan price.
        Math.floor((priceSubunits * gstRatePct + 50) / 100)
      : 0; // zero-rated export — deliberately 0, never absent

  return {
    amountSubunits: priceSubunits,
    gstSubunits,
    totalSubunits: priceSubunits + gstSubunits,
  };
}
