/**
 * Money display helpers (S5-F1).
 *
 * The server owns every amount — all figures arrive as INTEGER SUBUNITS (paise
 * for INR) and are NEVER computed on the client. Dividing by 100 to render a
 * display string is fine; a client-side TOTAL calculation is not (the checkout
 * response's `gstSubunits` / `totalSubunits` are the authoritative numbers).
 */

const SUBUNITS_PER_UNIT = 100;

/**
 * Format integer subunits as a localized currency string.
 * e.g. formatSubunits(299900, 'INR', 'en') → "₹2,999" ; (353882) → "₹3,538.82".
 *
 * minimumFractionDigits 0 keeps whole-rupee plan prices clean ("₹2,999"),
 * while a GST-inclusive total with paise still shows them ("₹3,538.82").
 */
export function formatSubunits(subunits: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(subunits / SUBUNITS_PER_UNIT);
}
