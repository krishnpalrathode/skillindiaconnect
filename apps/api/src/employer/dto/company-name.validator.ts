/**
 * A company name must carry at least one letter or digit.
 *
 * `\p{L}` / `\p{N}` are Unicode-aware on purpose: names arrive in Latin,
 * Devanagari and Arabic script, so an ASCII-only `[A-Za-z0-9]` check would
 * reject legitimate names like "अजय बिल्डर्स" or "شركة النور".
 *
 * This rejects names made ONLY of punctuation or symbols ("---", "@@@", "!!!")
 * without banning punctuation inside an otherwise real name ("L&T Ltd.").
 */
export const COMPANY_NAME_HAS_ALNUM = /[\p{L}\p{N}]/u;

/** Shared so register and update report the identical message. */
export const COMPANY_NAME_MESSAGE = 'name must contain at least one letter or number';

/** Longest company name accepted. Real names run past 20 — "Gulf Star Contracting LLC" is 25. */
export const COMPANY_NAME_MAX = 100;

/** Longest country name accepted. */
export const COMPANY_COUNTRY_MAX = 60;

/** Dial code: a leading "+" and 1–4 digits, e.g. +91, +971. */
export const PHONE_CODE_PATTERN = /^\+[0-9]{1,4}$/;

export const PHONE_CODE_MESSAGE = 'phoneCode must look like +91';
