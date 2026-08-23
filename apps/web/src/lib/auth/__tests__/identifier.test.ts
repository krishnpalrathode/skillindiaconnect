import { describe, it, expect } from 'vitest';
import { classifyIdentifier, toE164 } from '../identifier';

describe('classifyIdentifier', () => {
  it('reads a plain mobile number as a phone', () => {
    expect(classifyIdentifier('9876543210')).toBe('phone');
  });

  it.each(['+91 98765 43210', '(987) 654-3210', '98765-43210'])(
    'accepts the punctuation people actually type: %s',
    (input) => {
      expect(classifyIdentifier(input)).toBe('phone');
    },
  );

  it('reads an address as an email', () => {
    expect(classifyIdentifier('ramesh@example.com')).toBe('email');
  });

  /**
   * The "@" has to win immediately. Without this, an address is classified as
   * 'unknown' for its first few characters and the password box appears late,
   * after the user has already started typing.
   */
  it('commits to email as soon as an "@" appears, even mid-address', () => {
    expect(classifyIdentifier('ramesh@')).toBe('email');
  });

  /**
   * A digits-only local part is the case that makes the "@" check need to come
   * first: "9876543210@gmail.com" is unambiguously an address, but its opening
   * looks exactly like a phone number.
   */
  it('does not mistake a numeric email address for a phone number', () => {
    expect(classifyIdentifier('9876543210@gmail.com')).toBe('email');
  });

  it('treats any letter as ruling out a phone number', () => {
    expect(classifyIdentifier('ramesh')).toBe('email');
  });

  it('recognises letters outside the Latin script', () => {
    // A candidate may type their address in their own script.
    expect(classifyIdentifier('रमेश')).toBe('email');
  });

  /**
   * 'unknown' is what stops the form flickering between two layouts while
   * somebody types. A few digits is not yet a phone number worth offering an
   * OTP for.
   */
  it.each(['', '   ', '98', '12345'])('stays undecided on "%s"', (input) => {
    expect(classifyIdentifier(input)).toBe('unknown');
  });

  it('ignores surrounding whitespace', () => {
    expect(classifyIdentifier('  9876543210  ')).toBe('phone');
    expect(classifyIdentifier('  ramesh@example.com ')).toBe('email');
  });
});

describe('toE164', () => {
  it('prefixes national digits with the chosen dial code', () => {
    expect(toE164('9876543210', '+91')).toBe('+919876543210');
  });

  it('strips the punctuation the user typed', () => {
    expect(toE164('98765 43210', '+91')).toBe('+919876543210');
  });

  /**
   * The double-prefix bug: pasting a number that already carries its country
   * code, into a field whose select also says +91.
   */
  it('does not prefix a number that already carries its country code', () => {
    expect(toE164('919876543210', '+91')).toBe('+919876543210');
    expect(toE164('+91 98765 43210', '+91')).toBe('+919876543210');
  });

  it('works for a dial code other than the default', () => {
    expect(toE164('501234567', '+971')).toBe('+971501234567');
  });
});
