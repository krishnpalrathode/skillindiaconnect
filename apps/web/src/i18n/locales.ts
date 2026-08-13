/**
 * THE locale registry — the single source of truth for every language the app
 * offers.
 *
 * Before this file the locale set was restated in six places (the routing
 * config, two switcher `LOCALES` arrays, an `'en' | 'hi' | 'ar'` union in the
 * employer API types, the employer language `<select>`, and the MSW handler),
 * plus an RTL list and an `Intl` tag map that each knew about `ar` separately.
 * Adding a language meant finding all eight and getting all eight right; miss
 * one and the language either fails to route, renders LTR, or formats dates in
 * the wrong calendar. Everything now derives from the array below, so adding a
 * language is ONE entry here plus its message catalog.
 *
 * What each field is for:
 * - `code`        the URL segment and the `languagePref` value sent to the API.
 * - `nativeName`  the label shown to users. Always written in the language
 *                 itself — someone who cannot read the current UI language must
 *                 still be able to find their own, which is the entire point of
 *                 a language switcher.
 * - `shortLabel`  the compact glyph for the narrow header switcher.
 * - `englishName` disambiguation for staff-facing pickers, never shown alone.
 * - `dir`         writing direction, applied to <html dir> and used by any
 *                 component that needs to know (the date picker's arrows).
 * - `intlLocale`  the BCP-47 tag handed to `Intl.*`. Deliberately separate from
 *                 `code`: `en` must format as `en-IN` (day-first dates for an
 *                 India-first product), and several Indian languages need the
 *                 `-IN` region to pick the right numbering and calendar.
 */

export interface LocaleDefinition {
  code: string;
  nativeName: string;
  shortLabel: string;
  englishName: string;
  dir: 'ltr' | 'rtl';
  intlLocale: string;
}

/**
 * Ordered deliberately: English first (the default and the fallback), Hindi
 * second (the largest candidate language), then the remaining Indian languages
 * by speaker population, then Arabic last as the destination-market language.
 * The switcher renders this order as-is.
 */
export const LOCALES = [
  {
    code: 'en',
    nativeName: 'English',
    shortLabel: 'EN',
    englishName: 'English',
    dir: 'ltr',
    intlLocale: 'en-IN',
  },
  {
    code: 'hi',
    nativeName: 'हिन्दी',
    shortLabel: 'हि',
    englishName: 'Hindi',
    dir: 'ltr',
    intlLocale: 'hi-IN',
  },
  {
    code: 'bn',
    nativeName: 'বাংলা',
    shortLabel: 'বা',
    englishName: 'Bengali',
    dir: 'ltr',
    intlLocale: 'bn-IN',
  },
  {
    code: 'mr',
    nativeName: 'मराठी',
    shortLabel: 'मर',
    englishName: 'Marathi',
    dir: 'ltr',
    intlLocale: 'mr-IN',
  },
  {
    code: 'te',
    nativeName: 'తెలుగు',
    shortLabel: 'తె',
    englishName: 'Telugu',
    dir: 'ltr',
    intlLocale: 'te-IN',
  },
  {
    code: 'ta',
    nativeName: 'தமிழ்',
    shortLabel: 'த',
    englishName: 'Tamil',
    dir: 'ltr',
    intlLocale: 'ta-IN',
  },
  {
    code: 'gu',
    nativeName: 'ગુજરાતી',
    shortLabel: 'ગુ',
    englishName: 'Gujarati',
    dir: 'ltr',
    intlLocale: 'gu-IN',
  },
  {
    code: 'kn',
    nativeName: 'ಕನ್ನಡ',
    shortLabel: 'ಕ',
    englishName: 'Kannada',
    dir: 'ltr',
    intlLocale: 'kn-IN',
  },
  {
    code: 'ml',
    nativeName: 'മലയാളം',
    shortLabel: 'മ',
    englishName: 'Malayalam',
    dir: 'ltr',
    intlLocale: 'ml-IN',
  },
  {
    code: 'pa',
    nativeName: 'ਪੰਜਾਬੀ',
    shortLabel: 'ਪੰ',
    englishName: 'Punjabi',
    dir: 'ltr',
    intlLocale: 'pa-IN',
  },
  {
    code: 'or',
    nativeName: 'ଓଡ଼ିଆ',
    shortLabel: 'ଓ',
    englishName: 'Odia',
    dir: 'ltr',
    intlLocale: 'or-IN',
  },
  {
    code: 'as',
    nativeName: 'অসমীয়া',
    shortLabel: 'অ',
    englishName: 'Assamese',
    dir: 'ltr',
    intlLocale: 'as-IN',
  },
  {
    code: 'ne',
    nativeName: 'नेपाली',
    shortLabel: 'ने',
    englishName: 'Nepali',
    dir: 'ltr',
    intlLocale: 'ne-NP',
  },
  /*
    ── The wider Gulf corridor ────────────────────────────────────────────────
    The languages above cover workers leaving India. These cover the rest of the
    GCC blue-collar workforce this platform's employers hire alongside them —
    Filipino, Indonesian and Sri Lankan workers are a large share of Gulf site
    and service labour, and Amharic and Swahili speakers a large share of
    domestic and hospitality work. Arabic is the destination language and is
    already listed below.
  */
  {
    code: 'tl',
    nativeName: 'Filipino',
    shortLabel: 'FIL',
    englishName: 'Filipino',
    dir: 'ltr',
    intlLocale: 'fil-PH',
  },
  {
    code: 'id',
    nativeName: 'Bahasa Indonesia',
    shortLabel: 'ID',
    englishName: 'Indonesian',
    dir: 'ltr',
    intlLocale: 'id-ID',
  },
  {
    code: 'si',
    nativeName: 'සිංහල',
    shortLabel: 'සි',
    englishName: 'Sinhala',
    dir: 'ltr',
    intlLocale: 'si-LK',
  },
  {
    code: 'am',
    nativeName: 'አማርኛ',
    shortLabel: 'አማ',
    englishName: 'Amharic',
    dir: 'ltr',
    intlLocale: 'am-ET',
  },
  {
    code: 'sw',
    nativeName: 'Kiswahili',
    shortLabel: 'SW',
    englishName: 'Swahili',
    dir: 'ltr',
    intlLocale: 'sw-KE',
  },
  // The RTL group. `ur` and `ps` are written in Nastaʿlīq/Arabic script and `ar`
  // in Naskh; `fa` is Perso-Arabic. All set dir="rtl", which the
  // logical-property CSS convention (see frontend-conventions.md) turns into a
  // correct mirror with no per-component work.
  {
    code: 'ur',
    nativeName: 'اردو',
    shortLabel: 'اد',
    englishName: 'Urdu',
    dir: 'rtl',
    intlLocale: 'ur-IN',
  },
  {
    code: 'fa',
    nativeName: 'فارسی',
    shortLabel: 'فا',
    englishName: 'Persian',
    dir: 'rtl',
    intlLocale: 'fa-IR',
  },
  {
    code: 'ps',
    nativeName: 'پښتو',
    shortLabel: 'پښ',
    englishName: 'Pashto',
    dir: 'rtl',
    intlLocale: 'ps-AF',
  },
  {
    code: 'ar',
    nativeName: 'العربية',
    shortLabel: 'ع',
    englishName: 'Arabic',
    dir: 'rtl',
    intlLocale: 'ar',
  },
] as const satisfies readonly LocaleDefinition[];

export type Locale = (typeof LOCALES)[number]['code'];

/** Every locale code, in display order. Feeds `routing.locales`. */
export const LOCALE_CODES = LOCALES.map((l) => l.code) as unknown as readonly Locale[];

export const DEFAULT_LOCALE: Locale = 'en';

const BY_CODE = new Map<string, LocaleDefinition>(LOCALES.map((l) => [l.code, l]));

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && BY_CODE.has(value);
}

/**
 * Definition lookup that never returns undefined — an unknown code falls back to
 * the default rather than throwing, because these run during render (the header
 * switcher, `<html dir>`, every formatted date). A bad or stale locale value
 * should degrade to English, not blank the page.
 */
export function getLocaleDefinition(code: string | undefined): LocaleDefinition {
  return (code ? BY_CODE.get(code) : undefined) ?? BY_CODE.get(DEFAULT_LOCALE)!;
}

export function getDirection(code: string | undefined): 'ltr' | 'rtl' {
  return getLocaleDefinition(code).dir;
}

/** BCP-47 tag for `Intl.*`. See `intlLocale` above for why it isn't `code`. */
export function getIntlLocale(code: string | undefined): string {
  return getLocaleDefinition(code).intlLocale;
}
