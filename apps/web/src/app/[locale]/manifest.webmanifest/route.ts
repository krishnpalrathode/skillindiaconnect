import { getTranslations } from 'next-intl/server';
import { getDirection, isLocale } from '@/i18n/locales';
import { routing } from '@/i18n/routing';

/**
 * The web app manifest — one PER LOCALE, not one for the app.
 *
 * ── Why per-locale ───────────────────────────────────────────────────────────
 * A manifest's `name`, `short_name`, `description`, `lang` and `dir` are all
 * SINGLE-VALUED. This app ships 22 languages and the brand itself is translated
 * (`स्किल इंडिया कनेक्ट`, `سكيل إنديا كونكت`), so one global manifest would put an
 * English label under every home-screen icon and declare `dir: ltr` for the four
 * RTL languages. Serving a manifest per locale is the only way those fields can
 * be correct, and it costs one route handler.
 *
 * ── start_url: `/{locale}`, pinned at install time ───────────────────────────
 * The alternative was a locale-neutral `/` and letting middleware re-negotiate
 * on every launch. Rejected: middleware negotiates from the BROWSER's
 * Accept-Language, not from the language the user picked inside the app. A user
 * on a phone set to English who chose Hindi would get English on every cold
 * start — the one moment they cannot easily correct it, because the launcher
 * gave them no address bar. Pinning start_url to the locale they installed from
 * makes the choice stick.
 *
 * TRADE-OFF, stated: the installed app's start_url is whatever locale they were
 * browsing when they installed. Changing language in-app does not rewrite an
 * already-installed shortcut — they would re-install, or switch language after
 * launch as they do today. Worth confirming on a real device in Unit 3.
 *
 * ── scope: `/` ───────────────────────────────────────────────────────────────
 * Deliberately the whole origin, not `/{locale}`. A scope of `/hi` would treat
 * a switch to Arabic as an EXTERNAL navigation and kick the user out to a
 * browser tab mid-session. `/` keeps every locale inside the installed app.
 *
 * ── id: `/`, stable across locales ───────────────────────────────────────────
 * Without an explicit `id`, Chrome derives app identity from `start_url`, which
 * would make each locale a SEPARATE installable app — a user could end up with
 * three Skill India Connect icons. A fixed `id` means one app in 22 languages.
 */
export const dynamicParams = false;

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) {
    return new Response('Not found', { status: 404 });
  }

  const t = await getTranslations({ locale, namespace: 'pwa' });
  const common = await getTranslations({ locale, namespace: 'common' });
  const meta = await getTranslations({ locale, namespace: 'landing.meta' });

  const manifest = {
    id: '/',
    name: common('brand'),
    short_name: t('shortName'),
    description: meta('description'),
    lang: locale,
    dir: getDirection(locale),
    start_url: `/${locale}`,
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    /*
      Both colours come from src/styles/tokens.css — no new palette.
        theme_color      --color-primary-700  #1a3c6e  ("brand anchor")
        background_color --background         #ffffff
      background_color paints the splash screen BEFORE the first frame renders,
      so it must match the app's real page ground or the launch flashes.
    */
    theme_color: '#1a3c6e',
    background_color: '#ffffff',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icons/icon-maskable-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };

  return new Response(JSON.stringify(manifest, null, 2), {
    headers: {
      // The registered type for a manifest. Chrome accepts application/json too,
      // but Lighthouse and some Android launchers check for this one.
      'Content-Type': 'application/manifest+json; charset=utf-8',
      'Cache-Control': 'public, max-age=0, must-revalidate',
    },
  });
}
