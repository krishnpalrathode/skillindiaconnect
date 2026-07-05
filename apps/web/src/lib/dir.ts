import type { Locale } from '@/i18n/routing';

const RTL_LOCALES: Locale[] = ['ar'];

export function getDir(locale: Locale): 'ltr' | 'rtl' {
  return RTL_LOCALES.includes(locale) ? 'rtl' : 'ltr';
}
