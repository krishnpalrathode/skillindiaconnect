/**
 * What to call a candidate on screen when they have not told us their name yet.
 *
 * The order is fullName → email → phone, and the last step is why this exists.
 * Phone signup creates an account with `email: null` — the phone number IS the
 * credential — so `fullName ?? email` used to be a total expression and is not
 * one any more. Left alone, a brand-new phone-signup candidate would be greeted
 * as "Hi, null" on their very first screen.
 *
 * Both remaining fallbacks are identifiers the person recognises as themselves,
 * which is the whole job here. Nothing is invented: the empty-string case is
 * reached only by an account with no name, no email and no phone, and callers
 * already degrade sensibly (Avatar shows "?").
 *
 * This is deliberately NOT translated. Every branch returns something the user
 * typed themselves, so there is no copy to localise — and the alternative,
 * a generic greeting word, would mean a new key in all 22 locale files.
 */
export function candidateDisplayName(profile: {
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
}): string {
  return profile.fullName || profile.email || profile.phone || '';
}
