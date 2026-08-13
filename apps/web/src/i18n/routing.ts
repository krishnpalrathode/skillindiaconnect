import { defineRouting } from 'next-intl/routing';
import { DEFAULT_LOCALE, LOCALE_CODES } from './locales';

/**
 * Routing derives its locale list from the registry in `./locales` — that file
 * is the single place a language is added. Nothing here needs to change when the
 * set grows.
 */
export const routing = defineRouting({
  locales: LOCALE_CODES,
  defaultLocale: DEFAULT_LOCALE,
});

// Re-exported so the many `import type { Locale } from '@/i18n/routing'` call
// sites keep working; the type itself is owned by the registry.
export type { Locale } from './locales';
