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
          /*
            w-28 below `sm`, not w-40.

            At 360px the row did not fit: 160px of logo plus the Login and
            Sign-Up buttons pushed the document to 397px, so the whole public
            landing page scrolled sideways on the narrowest phones — every page
            using this header, not just the home page. Narrowing the logo on
            phone is the smallest fix that keeps BOTH buttons reachable, which
            matters because Login is the only route a returning candidate has
            from here. `object-cover` crops less at this ratio than at the old
            one, so the mark reads no worse.
          */
          className="relative block h-11 w-28 shrink-0 overflow-hidden rounded-md focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 sm:h-16 sm:w-52"
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

          {/*
            Sign Up is DESKTOP-ONLY in this header.

            At 360px the row does not fit — and Arabic is the case that proves
            it, because "إنشاء حساب مجاني" sets ~25% wider than "Sign Up Free"
            and pushed the document to 441px. Shrinking the logo alone was not
            enough for that locale, and a public landing page that scrolls
            sideways on the narrowest phones is a real defect, not a cosmetic
            one.

            Sign Up is the right thing to drop rather than Login, because it is
            the one that is offered elsewhere on every page: the hero carries
            two prominent CTAs, and the footer carries both /signup and
            /signup?role=employer. LOGIN is the only route a returning
            candidate has from this chrome, so it stays at every width.
          */}
          <Link
            href={`/${locale}/signup`}
            className={cn(
              buttonVariants({ variant: 'primary', size: 'md' }),
              'hidden rounded-xl font-semibold shadow-sm transition-all hover:shadow-md sm:inline-flex',
            )}
          >
            {t('signUp')}
          </Link>
        </div>
      </div>
    </header>
  );
}
