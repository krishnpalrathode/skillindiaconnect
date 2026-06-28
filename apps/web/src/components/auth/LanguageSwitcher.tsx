'use client';

import { useLocale } from 'next-intl';
import { useRouter, usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const LOCALES = [
  { code: 'en', label: 'EN' },
  { code: 'hi', label: 'हि' },
  { code: 'ar', label: 'ع' },
] as const;

type LocaleCode = (typeof LOCALES)[number]['code'];

const ALL_LOCALE_CODES = LOCALES.map((l) => l.code);

export function LanguageSwitcher({ className }: { className?: string }) {
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
