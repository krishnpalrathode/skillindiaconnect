'use client';

import { useLocale } from 'next-intl';
import { useRouter, usePathname } from 'next/navigation';
import { Globe, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LOCALES, isLocale, type Locale } from '@/i18n/locales';

interface LanguageSwitcherProps {
  className?: string;
  /**
   * Visual variant only. 'dark' (default) is the original style for dark hero
   * backgrounds; 'light' renders for white backgrounds (sign-up page).
   * Switching behavior is identical in both.
   */
  variant?: 'dark' | 'light';
}

/**
 * Language switcher.
 *
 * A native `<select>` rather than the previous row of inline buttons. With three
 * languages a button row fit; the registry now carries fifteen, and fifteen
 * buttons either overflow the header or wrap into a block that pushes the page
 * down on a 360px screen.
 *
 * A native select is the right control for this audience specifically: Android
 * renders it as a full-screen system picker with proper scrolling and the
 * platform's own font fallback, which matters when the options span nine
 * scripts. It is also keyboard- and screen-reader-native, and it cannot break
 * the way a hand-rolled popover breaks on an old WebView.
 *
 * Options are labelled in their OWN language. Someone stranded in a UI they
 * cannot read has to be able to find their language in the list — an English
 * label ("Malayalam") is useless to the exact person reaching for this control.
 */
export function LanguageSwitcher({ className, variant = 'dark' }: LanguageSwitcherProps) {
  const currentLocale = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  function switchLocale(newLocale: Locale) {
    if (newLocale === currentLocale) return;
    // Pathname is /en/login → replace the locale segment
    const segments = pathname.split('/').filter(Boolean);
    if (isLocale(segments[0])) {
      segments[0] = newLocale;
    } else {
      segments.unshift(newLocale);
    }
    router.push('/' + segments.join('/'));
  }

  const isLight = variant === 'light';

  return (
    <div className={cn('relative inline-flex items-center', className)}>
      <Globe
        className={cn(
          'pointer-events-none absolute start-2.5 size-4',
          isLight ? 'text-[#0F3D91]' : 'text-white/80',
        )}
        aria-hidden="true"
      />
      <select
        // The accessible name has to be language-independent: this control is
        // reached by people who cannot read the current UI language.
        aria-label="Select language / भाषा चुनें"
        value={currentLocale}
        onChange={(e) => switchLocale(e.target.value as Locale)}
        className={cn(
          // A11Y-002 (S8-H4): 44px minimum target. This is the single most
          // important control in the product for the audience that needs it —
          // someone who cannot read the interface cannot reach their own
          // language if they cannot hit the control.
          'h-11 cursor-pointer appearance-none rounded-lg ps-8 pe-8 text-sm font-medium',
          'transition-colors focus-visible:outline-none focus-visible:ring-[3px]',
          isLight
            ? // A11Y-003: neutral-600 is 5.9:1 on white; neutral-500 was 3.52:1.
              'border border-neutral-200 bg-white text-neutral-800 hover:border-neutral-300 focus-visible:ring-ring/70'
            : 'border border-white/25 bg-white/10 text-white hover:bg-white/20 focus-visible:ring-white/50',
        )}
      >
        {LOCALES.map(({ code, nativeName }) => (
          <option key={code} value={code} className="text-neutral-900">
            {nativeName}
          </option>
        ))}
      </select>
      <ChevronDown
        className={cn(
          'pointer-events-none absolute end-2.5 size-4',
          isLight ? 'text-neutral-600' : 'text-white/80',
        )}
        aria-hidden="true"
      />
    </div>
  );
}
