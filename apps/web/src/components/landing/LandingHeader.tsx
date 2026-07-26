'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { LanguageSwitcher } from '@/components/auth/LanguageSwitcher';
import { buttonVariants } from '@/components/ui/button-variants';
import { cn } from '@/lib/utils';

/**
 * Public landing header. Client-only because LanguageSwitcher reads the router.
 * Every link is locale-prefixed and points at a real existing route.
 */
export function LandingHeader() {
  const t = useTranslations('landing.nav');
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'en';

  return (
    <header className="sticky top-0 z-30 border-b border-neutral-200/70 bg-white/90 backdrop-blur-md">
      <div className="mx-auto flex h-[72px] max-w-7xl items-center justify-between gap-3 px-4 sm:h-24 sm:px-6">
        <Link
          href={`/${locale}`}
          aria-label={t('home')}
          className="relative block h-12 w-40 shrink-0 overflow-hidden rounded-md focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 sm:h-16 sm:w-52"
        >
          <Image
            src="/brand/logo.png"
            alt="SkillIndia Connect"
            fill
            priority
            sizes="208px"
            className="object-cover object-center"
          />
        </Link>

        <div className="flex items-center gap-1 sm:gap-3">
          <div className="hidden sm:block">
            <LanguageSwitcher variant="light" />
          </div>

          <Link
            href={`/${locale}/login`}
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'md' }),
              'rounded-xl font-semibold text-primary-700 hover:bg-primary-50',
            )}
          >
            {t('login')}
          </Link>

          <Link
            href={`/${locale}/signup`}
            className={cn(
              buttonVariants({ variant: 'primary', size: 'md' }),
              'rounded-xl font-semibold shadow-sm transition-all hover:shadow-md',
            )}
          >
            {t('signUp')}
          </Link>
        </div>
      </div>
    </header>
  );
}
