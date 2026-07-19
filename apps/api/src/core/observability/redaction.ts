/**
 * S8-H3 — THE redaction denylist. One definition, used by every outbound
 * channel: structured logs, the error tracker, and anything else that
 * serialises application data off the box.
 *
 * H2's audit verified that audit rows and server logs carry no PII today. That
 * held because the code is careful about what it puts in them. Observability
 * changes the risk profile: a structured logger serialises whole objects and an
 * error tracker ships request context and local variables automatically, so
 * "we were careful" stops being sufficient. This module is the mechanical
 * guarantee that replaces the care.
 *
 * The classes are the ones the privacy rules name: passport numbers, phone,
 * email, tokens, OTPs, document URLs/keys, and every credential.
 */

/**
 * Keys whose VALUE is always replaced, matched case-insensitively as a
 * substring. Substring matching is deliberate: it catches `candidatePhone`,
 * `phone_number` and `userEmail` without needing an exhaustive list, and the
 * cost of over-redacting an operational field is trivial next to leaking PII.
 */
const DENY_KEY_PATTERNS = [
  // Credentials and secrets
  'password',
  'secret',
  'token',
  'authorization',
  'cookie',
  'apikey',
  'api_key',
  'accesskey',
  'privatekey',
  'signature',
  'jwt',
  'credential',
  // Personal identifiers
  'phone',
  'mobile',
  'email',
  'passport',
  'documentnumber',
  'dob',
  'dateofbirth',
  'fathername',
  'religion',
  // One-time codes
  'otp',
  'code',
  'pin',
  // Object storage
  'r2key',
  'presigned',
  'uploadurl',
  'downloadurl',
  'signedurl',
];

export const REDACTED = '[REDACTED]';

/**
 * Value-shaped redaction for text that is not key/value structured — a log
 * message or an exception message, where PII arrives inline.
 *
 * Deliberately conservative and few: over-aggressive text patterns mangle
 * legitimate operational data (ids, counts, durations) and make logs useless,
 * which causes engineers to turn logging off — a worse outcome than the risk.
 * Structured fields are the primary defence; this is the backstop.
 */
const VALUE_PATTERNS: { re: RegExp; label: string }[] = [
  // E.164-ish phone numbers (+91… and friends)
  { re: /\+\d{10,15}\b/g, label: '[REDACTED_PHONE]' },
  // Email addresses
  { re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, label: '[REDACTED_EMAIL]' },
  // Bearer tokens / JWTs
  { re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, label: '[REDACTED_JWT]' },
  // Presigned URLs — the query string carries the signature
  { re: /https?:\/\/[^\s"']*[?&]X-Amz-Signature=[^\s"'&]+/gi, label: '[REDACTED_SIGNED_URL]' },
];

export function redactText(input: string): string {
  let out = input;
  for (const { re, label } of VALUE_PATTERNS) out = out.replace(re, label);
  return out;
}

function keyIsDenied(key: string): boolean {
  const k = key.toLowerCase();
  return DENY_KEY_PATTERNS.some((p) => k.includes(p));
}

/**
 * Deep-redact an arbitrary value for outbound serialisation.
 *
 * - Denied KEYS have their values replaced wholesale (the value is never
 *   inspected, so a nested object under `passport` cannot leak through).
 * - Surviving strings are still run through the text patterns, because PII
 *   also arrives in innocently-named fields (`detail`, `message`).
 * - Cycles are handled, and depth/breadth are bounded: an unbounded walk over a
 *   Prisma result or an Express request can be enormous, and a logger that
 *   stalls the event loop is its own outage.
 */
export function redactValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (depth > 8) return '[REDACTED_DEPTH]';
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') return redactText(value);
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return value;

  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactText(value.message),
      stack: value.stack ? redactText(value.stack) : undefined,
    };
  }

  if (typeof value === 'object') {
    const obj = value as object;
    if (seen.has(obj)) return '[CIRCULAR]';
    seen.add(obj);

    if (Array.isArray(value)) {
      const capped = value.slice(0, 50).map((v) => redactValue(v, depth + 1, seen));
      return value.length > 50 ? [...capped, `[+${value.length - 50} more]`] : capped;
    }

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = keyIsDenied(k) ? REDACTED : redactValue(v, depth + 1, seen);
    }
    return out;
  }

  return '[UNSERIALISABLE]';
}

/** Exposed for tests and for the Sentry integration's own assertions. */
export const __denyKeyPatterns = DENY_KEY_PATTERNS;
