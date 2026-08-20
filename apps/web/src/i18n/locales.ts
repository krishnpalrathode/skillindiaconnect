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
 * Ordered deliberately: English first (the default and the fallback), then
 * Hindi and Arabic — the two languages of the corridor this product was built
 * for — then the remaining world languages by reach. The switcher renders this
 * order as-is.
 *
 * WHY THIS SET CHANGED. It was previously India-first: Hindi plus ten Indian
 * regional languages plus the South-Asian/East-African migrant corridor. That
 * served candidates. This set serves an INTERNATIONAL market instead — the
 * major business languages — with India represented by Hindi and English.
 *
 * The regional catalogues were deleted rather than left orphaned: an entry here
 * with no catalogue silently renders entirely in English, which looks like a
 * bug to the one user who picked it. If any of them is wanted back, it is one
 * entry here plus its message file.
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
    // Kept despite the pivot: the Gulf is still where these jobs are, and it is
    // the one non-English catalogue that is translated as deeply as Hindi.
    code: 'ar',
    nativeName: 'العربية',
    shortLabel: 'ع',
    englishName: 'Arabic',
    dir: 'rtl',
    intlLocale: 'ar',
  },
  {
    code: 'fr',
    nativeName: 'Français',
    shortLabel: 'FR',
    englishName: 'French',
    dir: 'ltr',
    intlLocale: 'fr-FR',
  },
  {
    code: 'de',
    nativeName: 'Deutsch',
    shortLabel: 'DE',
    englishName: 'German',
    dir: 'ltr',
    intlLocale: 'de-DE',
  },
  {
    code: 'es',
    nativeName: 'Español',
    shortLabel: 'ES',
    englishName: 'Spanish',
    dir: 'ltr',
    intlLocale: 'es-ES',
  },
  {
    code: 'pt',
    nativeName: 'Português',
    shortLabel: 'PT',
    englishName: 'Portuguese',
    dir: 'ltr',
    intlLocale: 'pt-PT',
  },
  {
    // Simplified script. `zh` alone leaves the variant to the browser, which is
    // how a Simplified reader ends up looking at Traditional.
    code: 'zh',
    nativeName: '简体中文',
    shortLabel: '中',
    englishName: 'Chinese (Simplified)',
    dir: 'ltr',
    intlLocale: 'zh-Hans',
  },
  {
    code: 'ru',
    nativeName: 'Русский',
    shortLabel: 'RU',
    englishName: 'Russian',
    dir: 'ltr',
    intlLocale: 'ru-RU',
  },
  {
    code: 'ja',
    nativeName: '日本語',
    shortLabel: '日',
    englishName: 'Japanese',
    dir: 'ltr',
    intlLocale: 'ja-JP',
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
