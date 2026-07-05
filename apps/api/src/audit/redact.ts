/**
 * PII redaction helper — constitution-level requirement.
 *
 * Audit rows MUST NOT contain: passwords, tokens/JWTs, OTPs, passport numbers,
 * document storage keys/URLs, raw phone numbers, raw email addresses, or secrets.
 *
 * Export PII_DENYLIST_KEYS so the application logger config and Sentry `beforeSend`
 * can reuse the same denylist rather than duplicating it.
 */

const REDACTED = '[REDACTED]';

/**
 * Denylisted key names (normalised to lowercase, stripped of _ and - separators).
 * This constant is exported for reuse by the app logger and Sentry beforeSend.
 *
 * Extend here when a new PII field is introduced — keep it reviewable and explicit.
 */
export const PII_DENYLIST_KEYS = new Set<string>([
  // Credentials
  'password',
  'passwordhash',
  'secret',
  'clientsecret',
  'secretkey',
  'apikey',
  // Tokens / auth headers
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'bearertoken',
  'authtoken',
  'sessiontoken',
  'authorization',
  'cookie',
  // OTP / challenge codes
  'otp',
  'otpcode',
  'otphash',
  'codehash',
  // Passport / government ID
  'passportnumber',
  // Document storage keys and signed URLs
  'r2key',
  'documentkey',
  'filekey',
  'storagekey',
  'signedurl',
  'presignedurl',
  'documenturl',
  'fileurl',
  'uploadurl',
  // Contact PII
  'phone',
  'phonenumber',
  'mobilenumber',
  'email',
  'toemail',
  'emailaddress',
  // Financial instrument PII
  'cardnumber',
  'cvv',
  'ssn',
  'aadhaar',
  'pancard',
]);

/** UUID v4 pattern — UUIDs are safe identifiers, never masked. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** JWT: three base64url-encoded parts separated by dots. */
const JWT_RE = /^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$/;

/**
 * Long opaque token/hash: ≥ 40 chars of alphanumeric + base64 special chars, no spaces.
 * Excludes dots (.) so file paths like `dir/file.pdf` are never masked.
 */
const OPAQUE_TOKEN_RE = /^[A-Za-z0-9+/=_\-]{40,}$/;

/** Normalise an object key for denylist lookup: lowercase, strip _ and -. */
function normaliseKey(k: string): string {
  return k.toLowerCase().replace(/[_\-]/g, '');
}

/** True if the string value looks like a secret, token, or JWT. UUIDs are excluded. */
function isTokenLike(value: string): boolean {
  if (UUID_RE.test(value)) return false;
  if (JWT_RE.test(value)) return true;
  if (OPAQUE_TOKEN_RE.test(value)) return true;
  return false;
}

/**
 * Recursively redact PII from an arbitrary value.
 *
 * - Object keys matching the denylist (case-insensitive, ignores _ and -) → `[REDACTED]`
 * - String values under non-denylisted keys that look like tokens/JWTs → `[REDACTED]`
 * - UUID string values → preserved (actor/target IDs are UUIDs, not direct PII)
 * - Arrays → each element redacted recursively
 * - Primitives → returned as-is
 */
export function redact<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => redact(item)) as unknown as T;
  }

  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (PII_DENYLIST_KEYS.has(normaliseKey(k))) {
        result[k] = REDACTED;
      } else if (typeof v === 'string' && isTokenLike(v)) {
        result[k] = REDACTED;
      } else {
        result[k] = redact(v);
      }
    }
    return result as unknown as T;
  }

  return value;
}
