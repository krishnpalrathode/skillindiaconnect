import { PII_DENYLIST_KEYS, redact } from './redact';

describe('redact — PII denylist (SECURITY-CRITICAL)', () => {
  // ── Denylisted key masking ───────────────────────────────────────────────────

  it('masks password', () => {
    expect(redact({ password: 'hunter2' })).toEqual({ password: '[REDACTED]' });
  });

  it('masks token / accessToken / refreshToken', () => {
    const result = redact({
      token: 'abc.def.ghi',
      accessToken: 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1MSJ9.sig',
      refreshToken: 'opaque-refresh-token',
    });
    expect(result.token).toBe('[REDACTED]');
    expect(result.accessToken).toBe('[REDACTED]');
    expect(result.refreshToken).toBe('[REDACTED]');
  });

  it('masks otp, otpHash, codeHash', () => {
    const result = redact({ otp: '123456', otpHash: 'hashed', codeHash: 'hashed2' });
    expect(result.otp).toBe('[REDACTED]');
    expect(result.otpHash).toBe('[REDACTED]');
    expect(result.codeHash).toBe('[REDACTED]');
  });

  it('masks passportNumber', () => {
    expect(redact({ passportNumber: 'A1234567' })).toEqual({ passportNumber: '[REDACTED]' });
  });

  it('masks r2Key (document storage key)', () => {
    expect(redact({ r2Key: 'candidates/abc/PASSPORT/file.pdf' })).toEqual({
      r2Key: '[REDACTED]',
    });
  });

  it('masks r2_key and document_key (underscore variants)', () => {
    const result = redact({ r2_key: 'some/path', document_key: 'some/other/path' });
    expect(result.r2_key).toBe('[REDACTED]');
    expect(result.document_key).toBe('[REDACTED]');
  });

  it('masks signedUrl, presignedUrl, documentUrl', () => {
    const result = redact({
      signedUrl: 'https://r2.example.com/file?X-Amz-Signature=abc',
      presignedUrl: 'https://storage.example.com/upload',
      documentUrl: 'https://cdn.example.com/doc.pdf',
    });
    expect(result.signedUrl).toBe('[REDACTED]');
    expect(result.presignedUrl).toBe('[REDACTED]');
    expect(result.documentUrl).toBe('[REDACTED]');
  });

  it('masks phone and email', () => {
    const result = redact({ phone: '+919876543210', email: 'user@example.com' });
    expect(result.phone).toBe('[REDACTED]');
    expect(result.email).toBe('[REDACTED]');
  });

  it('masks toEmail and emailAddress', () => {
    const result = redact({ toEmail: 'a@b.com', emailAddress: 'c@d.com' });
    expect(result.toEmail).toBe('[REDACTED]');
    expect(result.emailAddress).toBe('[REDACTED]');
  });

  it('masks authorization header', () => {
    expect(redact({ authorization: 'Bearer eyJ...' })).toEqual({
      authorization: '[REDACTED]',
    });
  });

  it('masks secret and apiKey', () => {
    const result = redact({ secret: 'top-secret', apiKey: 'key-123' });
    expect(result.secret).toBe('[REDACTED]');
    expect(result.apiKey).toBe('[REDACTED]');
  });

  // ── Key normalisation (strips _ and - separators) ───────────────────────────

  it('treats access_token, access-token, and accessToken identically', () => {
    const result = redact({
      access_token: 'tok1',
      'access-token': 'tok2',
      accessToken: 'tok3',
    });
    expect(result.access_token).toBe('[REDACTED]');
    expect(result['access-token']).toBe('[REDACTED]');
    expect(result.accessToken).toBe('[REDACTED]');
  });

  // ── UUID preservation ────────────────────────────────────────────────────────

  it('preserves UUID values under any key', () => {
    const uuid = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    const result = redact({ userId: uuid, targetId: uuid, actorId: uuid });
    expect(result.userId).toBe(uuid);
    expect(result.targetId).toBe(uuid);
    expect(result.actorId).toBe(uuid);
  });

  // ── Token-like value masking (non-denylisted keys) ───────────────────────────

  it('masks a JWT-shaped value under a non-denylisted key', () => {
    // eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyMSJ9.SflKxwRJSMeKKF2QT4fwpMeJf
    const jwt =
      'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyMSJ9.SflKxwRJSMeKKF2QT4fwpMeJf';
    expect(redact({ randomKey: jwt })).toEqual({ randomKey: '[REDACTED]' });
  });

  it('masks a long opaque token under a non-denylisted key', () => {
    const longToken = 'a'.repeat(40);
    expect(redact({ txRef: longToken })).toEqual({ txRef: '[REDACTED]' });
  });

  it('does NOT mask short normal strings', () => {
    const result = redact({ status: 'active', action: 'settings.update' });
    expect(result.status).toBe('active');
    expect(result.action).toBe('settings.update');
  });

  it('does NOT mask strings with spaces (not a token)', () => {
    const result = redact({ description: 'this is a normal sentence value' });
    expect(result.description).toBe('this is a normal sentence value');
  });

  // ── Recursion — nested objects ───────────────────────────────────────────────

  it('redacts within nested objects', () => {
    const result = redact({
      outer: {
        inner: {
          password: 'secret',
          safe: 'value',
        },
      },
    });
    expect((result.outer as Record<string, unknown>).inner).toEqual({
      password: '[REDACTED]',
      safe: 'value',
    });
  });

  it('redacts deeply nested PII', () => {
    const result = redact({ a: { b: { c: { phone: '+1234567890' } } } });
    expect(
      ((result.a as Record<string, unknown>).b as Record<string, unknown>).c,
    ).toEqual({ phone: '[REDACTED]' });
  });

  // ── Recursion — arrays ───────────────────────────────────────────────────────

  it('redacts PII inside arrays', () => {
    const result = redact({
      items: [{ phone: '+1234567890', name: 'Alice' }, { email: 'b@c.com', id: 'uuid-123' }],
    });
    const items = result.items as Array<Record<string, unknown>>;
    expect(items[0]?.phone).toBe('[REDACTED]');
    expect(items[0]?.name).toBe('Alice');
    expect(items[1]?.email).toBe('[REDACTED]');
  });

  it('handles arrays of primitives without crashing', () => {
    const result = redact({ tags: ['one', 'two', 'three'] });
    expect(result.tags).toEqual(['one', 'two', 'three']);
  });

  // ── Safe fields not accidentally masked ──────────────────────────────────────

  it('does not mask candidateId (UUID)', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    expect(redact({ candidateId: uuid }).candidateId).toBe(uuid);
  });

  it('does not mask settings key string (not a storage key)', () => {
    const settingsKey = 'worker_protection.accommodation_required';
    expect(redact({ key: settingsKey }).key).toBe(settingsKey);
  });

  it('does not mask numeric values', () => {
    expect(redact({ version: 3, completionPct: 85 })).toEqual({
      version: 3,
      completionPct: 85,
    });
  });

  it('does not mask boolean values', () => {
    expect(redact({ enabled: true, core: false })).toEqual({ enabled: true, core: false });
  });

  it('handles null and undefined gracefully', () => {
    expect(redact(null)).toBeNull();
    expect(redact(undefined)).toBeUndefined();
  });

  it('handles empty object', () => {
    expect(redact({})).toEqual({});
  });

  // ── PII_DENYLIST_KEYS is exported and reviewable ─────────────────────────────

  it('PII_DENYLIST_KEYS is exported and contains the key sentinel entries', () => {
    expect(PII_DENYLIST_KEYS).toBeInstanceOf(Set);
    expect(PII_DENYLIST_KEYS.has('password')).toBe(true);
    expect(PII_DENYLIST_KEYS.has('r2key')).toBe(true);
    expect(PII_DENYLIST_KEYS.has('phone')).toBe(true);
    expect(PII_DENYLIST_KEYS.has('email')).toBe(true);
    expect(PII_DENYLIST_KEYS.has('passportnumber')).toBe(true);
    expect(PII_DENYLIST_KEYS.has('otp')).toBe(true);
    expect(PII_DENYLIST_KEYS.has('token')).toBe(true);
  });
});
