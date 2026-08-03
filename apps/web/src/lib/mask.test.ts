import { describe, it, expect } from 'vitest';
import { maskEmail, maskPhone } from './mask';

describe('maskEmail', () => {
  it('masks the local part and keeps the domain readable', () => {
    expect(maskEmail('krishnpal@gmail.com')).toBe('kr••••••@gmail.com');
  });

  it('caps the bullet run so a long local part stays readable', () => {
    const masked = maskEmail('averyveryverylonglocalpart@example.com');
    expect(masked).toBe('av••••••@example.com');
    expect(masked).not.toContain('averyvery');
  });

  it('never leaks the tail of the local part', () => {
    expect(maskEmail('secretname@x.io')).not.toContain('name');
  });

  it('handles one- and two-character local parts without exposing them', () => {
    expect(maskEmail('a@x.com')).toBe('•@x.com');
    expect(maskEmail('ab@x.com')).toBe('a•@x.com');
  });

  it('splits on the last @ so a quoted local part cannot smuggle the domain', () => {
    expect(maskEmail('"weird@inner"@example.com')).toBe('"w••••••@example.com');
  });

  it('masks conservatively rather than echoing unparseable input', () => {
    expect(maskEmail('not-an-email')).toBe('no••••••');
    expect(maskEmail('trailing@')).toBe('tr••••••');
    expect(maskEmail('@leading.com')).toBe('@l••••••');
  });

  it('trims surrounding whitespace', () => {
    expect(maskEmail('  krishnpal@gmail.com  ')).toBe('kr••••••@gmail.com');
  });

  it('returns empty string for empty input', () => {
    expect(maskEmail('')).toBe('');
    expect(maskEmail('   ')).toBe('');
  });
});

describe('maskPhone', () => {
  it('shows only the last four digits', () => {
    expect(maskPhone('9876543210')).toBe('••••••3210');
  });

  it('ignores separators when counting digits', () => {
    expect(maskPhone('98765 43210')).toBe('••••••3210');
    expect(maskPhone('98-765-43210')).toBe('••••••3210');
  });

  it('masks entirely when the number is too short to mask usefully', () => {
    expect(maskPhone('1234')).toBe('••••');
    expect(maskPhone('12')).toBe('••');
  });

  it('returns empty string when there are no digits', () => {
    expect(maskPhone('')).toBe('');
    expect(maskPhone('abc')).toBe('');
  });
});
