/**
 * S8-H3 — the redaction denylist is the mechanical guarantee that observability
 * cannot leak PII. H2 verified logs and audit rows are clean today; structured
 * logging and an error tracker serialise far more, so this is tested directly
 * rather than trusted.
 */
import { redactSentryEvent } from './error-tracking';
import { REDACTED, redactText, redactValue } from './redaction';

describe('redaction', () => {
  describe('redactValue — key-based', () => {
    it.each([
      'phone',
      'candidatePhone',
      'phone_number',
      'email',
      'userEmail',
      'password',
      'passwordHash',
      'passportNumber',
      'documentNumber',
      'otp',
      'accessToken',
      'authorization',
      'r2Key',
      'signedUrl',
      'dob',
      'fatherName',
      'religion',
    ])('redacts the value of "%s"', (key) => {
      const out = redactValue({ [key]: 'sensitive-value' }) as Record<string, unknown>;
      expect({ key, value: out[key] }).toEqual({ key, value: REDACTED });
    });

    it('redacts a denied key even when it holds a nested object', () => {
      const out = redactValue({ passport: { number: 'P1234567', issued: '2020' } }) as Record<
        string,
        unknown
      >;
      // The value is replaced wholesale — the nested content is never walked,
      // so nothing under a denied key can escape.
      expect(out.passport).toBe(REDACTED);
    });

    it('keeps operational fields intact — redaction must not destroy usefulness', () => {
      const out = redactValue({
        jobId: 'job-123',
        durationMs: 42,
        status: 'ACTIVE',
        count: 7,
      }) as Record<string, unknown>;
      expect(out).toEqual({ jobId: 'job-123', durationMs: 42, status: 'ACTIVE', count: 7 });
    });

    it('handles cycles without hanging', () => {
      const a: Record<string, unknown> = { name: 'x' };
      a.self = a;
      expect(() => redactValue(a)).not.toThrow();
      expect((redactValue(a) as Record<string, unknown>).self).toBe('[CIRCULAR]');
    });

    it('bounds depth and array length so a logger cannot stall the event loop', () => {
      let deep: Record<string, unknown> = { end: 'value' };
      for (let i = 0; i < 20; i++) deep = { nested: deep };
      expect(JSON.stringify(redactValue(deep))).toContain('[REDACTED_DEPTH]');

      const big = Array.from({ length: 120 }, (_, i) => i);
      const out = redactValue(big) as unknown[];
      expect(out.length).toBeLessThanOrEqual(51);
    });
  });

  describe('redactText — value-based', () => {
    it('redacts phone numbers, emails, JWTs and presigned URLs in free text', () => {
      const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc-def_123';
      const text =
        `failed for +919876543210 (worker@example.com) token=${jwt} ` +
        'url=https://r2.example.com/doc.pdf?X-Amz-Signature=deadbeefcafe';

      const out = redactText(text);

      expect(out).not.toContain('+919876543210');
      expect(out).not.toContain('worker@example.com');
      expect(out).not.toContain(jwt);
      expect(out).not.toContain('X-Amz-Signature=deadbeefcafe');
      // And the operational shape survives, or the log is worthless.
      expect(out).toContain('failed for');
    });

    it('leaves ordinary identifiers and numbers alone', () => {
      const text = 'job 4f7ff938-4b33-411d-92b3-c3704cf97a99 rendered in 812ms';
      expect(redactText(text)).toBe(text);
    });
  });

  describe('redactSentryEvent — the highest-risk channel', () => {
    it('drops the request body, cookies and query string entirely', () => {
      const event = redactSentryEvent({
        request: {
          data: { password: 'hunter2', passportNumber: 'P123' },
          cookies: 'session=abc',
          query_string: 'token=secret',
          headers: { authorization: 'Bearer abc', 'user-agent': 'curl/8', 'x-api-key': 'k' },
          url: 'https://api.example.com/v1/jobs?token=secret',
        },
      });

      expect(event.request?.data).toBeUndefined();
      expect(event.request?.cookies).toBeUndefined();
      expect(event.request?.query_string).toBeUndefined();
      // Headers are an ALLOWLIST — authorization and unknown headers are gone.
      expect(event.request?.headers).toEqual({ 'user-agent': 'curl/8' });
      // The url keeps its path but loses the query string.
      expect(event.request?.url).toBe('https://api.example.com/v1/jobs');
    });

    it('reduces the user to an opaque id and role', () => {
      const event = redactSentryEvent({
        user: { id: 'user-1', email: 'a@b.com', username: 'alice', role: 'CANDIDATE' },
      });
      expect(event.user).toEqual({ id: 'user-1', role: 'CANDIDATE' });
    });

    it('redacts extra, contexts, breadcrumbs and the message', () => {
      const event = redactSentryEvent({
        message: 'failed for +919876543210',
        extra: { phone: '+919876543210', jobId: 'job-1' },
        breadcrumbs: [{ data: { email: 'a@b.com' } }],
        contexts: { profile: { passportNumber: 'P1' } },
      });

      expect(event.message).not.toContain('+919876543210');
      expect((event.extra as Record<string, unknown>).phone).toBe(REDACTED);
      // Non-sensitive context survives — the report must stay actionable.
      expect((event.extra as Record<string, unknown>).jobId).toBe('job-1');
      expect(JSON.stringify(event.breadcrumbs)).not.toContain('a@b.com');
      expect(JSON.stringify(event.contexts)).not.toContain('P1');
    });
  });
});
