'use client';

import { useLocale } from 'next-intl';
import { useRouter, usePathname } from 'next/navigation';
import { Globe } from 'lucide-react';
import { cn } from '@/lib/utils';

const LOCALES = [
  { code: 'en', label: 'EN', fullLabel: 'English' },
  { code: 'hi', label: 'हि', fullLabel: 'हिंदी' },
  { code: 'ar', label: 'ع', fullLabel: 'العربية' },
] as const;

type LocaleCode = (typeof LOCALES)[number]['code'];

const ALL_LOCALE_CODES = LOCALES.map((l) => l.code);

interface LanguageSwitcherProps {
  className?: string;
  /**
   * Visual variant only. 'dark' (default) is the original style for dark hero
   * backgrounds; 'light' renders full language names for white backgrounds
   * (sign-up page). Switching behavior is identical in both.
   */
  variant?: 'dark' | 'light';
}

export function LanguageSwitcher({ className, variant = 'dark' }: LanguageSwitcherProps) {
  const currentLocale = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  function switchLocale(newLocale: LocaleCode) {
    if (newLocale === currentLocale) return;
    // Pathname is /en/login → replace the locale segment
    const segments = pathname.split('/').filter(Boolean);
    if (ALL_LOCALE_CODES.includes(segments[0] as LocaleCode)) {
      segments[0] = newLocale;
    } else {
      segments.unshift(newLocale);
    }
    router.push('/' + segments.join('/'));
  }

  if (variant === 'light') {
    return (
      <div
        className={cn('flex items-center gap-1', className)}
        role="group"
        aria-label="Select language"
      >
        <Globe className="size-4 text-[#0F3D91] me-1" aria-hidden="true" />
        {LOCALES.map(({ code, fullLabel }) => (
          <button
            key={code}
            type="button"
            onClick={() => switchLocale(code)}
            aria-pressed={currentLocale === code}
            aria-label={`Switch language to ${code}`}
            className={cn(
              // A11Y-002 (S8-H4): was h-9 (36px), below the product's 44px
              // minimum. This is the single most important target in the
              // product for the audience that needs it — an Arabic-reading
              // user on a cheap Android phone cannot switch the interface into
              // their language if they cannot hit the control. It appeared on
              // every screen, so this one line was the most-repeated target
              // failure in the audit.
              'px-2.5 h-11 rounded text-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70',
              currentLocale === code
                ? 'text-[#0F3D91] font-semibold underline underline-offset-4 decoration-2'
                : // A11Y-003: was text-neutral-500 (3.52:1 on white) — below the
                  // 4.5:1 body-text minimum. neutral-600 is 5.9:1.
                  'text-neutral-600 hover:text-neutral-800',
            )}
          >
            {fullLabel}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className={cn('flex gap-1', className)} role="group" aria-label="Select language">
      {LOCALES.map(({ code, label }) => (
        <button
          key={code}
          type="button"
          onClick={() => switchLocale(code)}
          aria-pressed={currentLocale === code}
          aria-label={`Switch language to ${code}`}
          className={cn(
            'px-2.5 py-1 rounded text-sm font-medium transition-colors min-w-[2.5rem] h-9',
            'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-white/50',
            currentLocale === code
              ? 'bg-white text-primary-800'
              : 'text-white/80 hover:text-white hover:bg-white/10',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
