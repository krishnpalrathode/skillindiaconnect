import { getDirection } from '@/i18n/locales';
import type { Locale } from '@/i18n/routing';

/**
 * Writing direction for a locale. Delegates to the locale registry, which
 * carries `dir` per language — previously this file kept its own `['ar']` list,
 * so adding an RTL language (Urdu) meant remembering to edit here as well or
 * silently rendering it left-to-right.
 */
export function getDir(locale: Locale): 'ltr' | 'rtl' {
  return getDirection(locale);
}
