import { describe, it, expect } from 'vitest';
import { candidateDisplayName } from '../format/display-name';

describe('candidateDisplayName', () => {
  it('prefers the name the candidate gave us', () => {
    expect(
      candidateDisplayName({
        fullName: 'Ramesh Kumar',
        email: 'ramesh@example.com',
        phone: '+919876543210',
      }),
    ).toBe('Ramesh Kumar');
  });

  it('falls back to email while the profile is still empty', () => {
    expect(candidateDisplayName({ fullName: null, email: 'ramesh@example.com' })).toBe(
      'ramesh@example.com',
    );
  });

  /**
   * The case this helper exists for. A phone-signup account has `email: null`
   * until onboarding verifies an address, so `fullName ?? email` — which every
   * call site used before — resolved to null and greeted a brand-new candidate
   * as "Hi, null" on their first screen.
   */
  it('falls back to the phone number for a fresh phone-signup account', () => {
    expect(candidateDisplayName({ fullName: null, email: null, phone: '+919876543210' })).toBe(
      '+919876543210',
    );
  });

  it('never renders the string "null" or "undefined"', () => {
    for (const profile of [
      { fullName: null, email: null, phone: null },
      { fullName: undefined, email: undefined, phone: undefined },
      {},
    ]) {
      const out = candidateDisplayName(profile);
      expect(out).toBe('');
      expect(out).not.toMatch(/null|undefined/);
    }
  });

  /**
   * An empty fullName is what the API stores for a profile that has been
   * created but never filled in (`fullName: ''`), so it must not win over a
   * real identifier — hence `||` rather than `??`.
   */
  it('treats an empty name as absent, not as a name', () => {
    expect(candidateDisplayName({ fullName: '', email: 'ramesh@example.com' })).toBe(
      'ramesh@example.com',
    );
  });
});
