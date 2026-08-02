/**
 * Masking helpers for identifiers echoed back to the user in confirmation
 * screens ("we sent a link to kr•••••@gmail.com").
 *
 * These mask the value the USER JUST TYPED — never a value returned by the
 * server. That distinction is what keeps the enumeration-safe auth screens
 * enumeration-safe: echoing back the submitted input reveals nothing about
 * whether an account actually exists.
 */

const BULLET = '•';

/** Longest run of bullets we render, so a 40-char local part stays readable. */
const MAX_BULLETS = 6;

const bullets = (n: number) => BULLET.repeat(Math.min(Math.max(n, 1), MAX_BULLETS));

/**
 * Masks the local part of an email and leaves the domain intact:
 * `krishnpal@gmail.com` → `kr•••••••@gmail.com`.
 *
 * The domain stays visible on purpose. It is not the identifying half, the user
 * just typed it, and showing it is what lets someone notice they sent the link
 * to `gmial.com`. Input that is not an email is masked conservatively rather
 * than echoed back raw.
 */
export function maskEmail(email: string): string {
  const trimmed = email.trim();
  if (!trimmed) return '';

  // Split on the LAST '@' — quoted local parts may legally contain one.
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1) return maskOpaque(trimmed);

  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);

  if (local.length === 1) return `${bullets(1)}@${domain}`;
  if (local.length === 2) return `${local[0]}${bullets(1)}@${domain}`;
  return `${local.slice(0, 2)}${bullets(local.length - 2)}@${domain}`;
}

/**
 * Masks a phone number down to its last 4 digits: `9876543210` → `••••••3210`.
 *
 * Pass the NATIONAL part only and render the country code beside it — deriving
 * the country code from a merged string means guessing how many leading digits
 * belong to it, which is wrong for a platform spanning India and the Gulf.
 */
export function maskPhone(nationalNumber: string): string {
  const digits = nationalNumber.replace(/\D/g, '');
  if (!digits) return '';
  // Too short to both mask and stay useful — mask the lot rather than leak it.
  if (digits.length <= 4) return bullets(digits.length);
  return `${bullets(digits.length - 4)}${digits.slice(-4)}`;
}

/** Fallback for input we cannot parse: keep a hint, hide the rest. */
function maskOpaque(value: string): string {
  if (value.length <= 2) return bullets(value.length);
  return `${value.slice(0, 2)}${bullets(value.length - 2)}`;
}
