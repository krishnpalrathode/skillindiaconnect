/**
 * Deciding whether what someone typed is an email address or a phone number.
 *
 * The signup screen has ONE field for both, so this classification drives what
 * the user sees next: a password box, or a country code and a "Send OTP"
 * button. Getting it wrong is not a validation error the user can read — it is
 * the wrong form appearing under their cursor while they type.
 *
 * ── Why 'unknown' exists ─────────────────────────────────────────────────────
 * The obvious two-way version misbehaves on the very first keystroke. Someone
 * typing "9876543210" is a phone from character one, but someone typing
 * "ramesh@..." spends four characters looking like neither. Forcing a verdict
 * there makes the form flicker between two layouts as they type. 'unknown'
 * lets the caller show just the field and wait.
 */
export type IdentifierKind = 'email' | 'phone' | 'unknown';

/** Enough digits to be worth offering an OTP for; below this we stay quiet. */
const MIN_PHONE_DIGITS = 6;

export function classifyIdentifier(raw: string): IdentifierKind {
  const value = raw.trim();
  if (!value) return 'unknown';

  /*
    An "@" is decisive and immediate — no address is a phone number, and no
    phone number contains one. This branch comes first so a half-typed address
    is treated as an address the moment the user commits to one.
  */
  if (value.includes('@')) return 'email';

  // Any letter rules out a phone number. Deliberately Unicode-aware: a
  // candidate may type their address in a non-Latin script.
  if (/\p{L}/u.test(value)) return 'email';

  const digits = value.replace(/\D/g, '');
  /*
    Only digits and the punctuation people actually put in phone numbers.
    Anything else — a stray comma, a slash — is somebody mid-way through
    typing something we should not guess at.
  */
  if (digits.length >= MIN_PHONE_DIGITS && /^[+\d\s()-]+$/.test(value)) return 'phone';

  return 'unknown';
}

/**
 * National digits + a dial code → E.164.
 *
 * A number pasted WITH its country code already attached must not be
 * double-prefixed: "+919876543210" typed into a field whose select says +91
 * would otherwise become "+91919876543210". Mirrors the same helper in
 * PhoneVerify, where this case was found first.
 */
export function toE164(nationalDigits: string, dialCode: string): string {
  const digits = nationalDigits.replace(/\D/g, '');
  const bare = dialCode.replace('+', '');
  return digits.startsWith(bare) ? `+${digits}` : `${dialCode}${digits}`;
}
