'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { LanguageSwitcher } from '@/components/auth/LanguageSwitcher';
import { SignupHero } from '@/components/auth/SignupHero';
import { LoginHero } from '@/components/auth/LoginHero';

// Split-panel auth layout: gradient hero on the left, form on the right.
// RTL: logical CSS flips the columns automatically when dir="rtl".
//
// The sign-up and login routes render their own approved hero designs
// (SignupHero / LoginHero) in a shared split shell; every other auth page
// (callback) keeps the original shell untouched. The pathname check is purely
// presentational — no routing or auth behavior.
export default function AuthLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isSignup = /\/signup\/?$/.test(pathname ?? '');
  const isLogin = /\/login\/?$/.test(pathname ?? '');

  if (isSignup || isLogin) {
    return (
      <div className="min-h-svh flex flex-col lg:flex-row bg-white">
        {/* Hero — left on desktop, stacked above the form on mobile */}
        {isSignup ? <SignupHero /> : <LoginHero />}

        {/* Form panel */}
        <div className="flex flex-1 flex-col lg:w-1/2">
          <div className="flex justify-end px-4 pt-4 sm:px-8 sm:pt-6">
            <LanguageSwitcher variant="light" />
          </div>
          <div className="flex flex-1 items-start justify-center px-4 pb-12 pt-4 sm:px-8 lg:items-center lg:pt-0">
            <div className="w-full max-w-[560px]">{children}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-svh flex">
      {/* Hero panel (hidden on mobile) */}
      <div className="hidden lg:flex flex-col justify-between w-1/2 bg-gradient-to-br from-primary-700 via-primary-600 to-secondary-500 p-10 text-white">
        <div>
          <span className="text-2xl font-bold tracking-tight">SkillIndiaConnect</span>
        </div>

        <blockquote className="space-y-2 max-w-sm">
          <p className="text-xl font-medium leading-relaxed">
            &ldquo;Connecting skilled workers with trusted employers across India and the
            Gulf.&rdquo;
          </p>
          <footer className="text-sm text-white/70">SkillIndiaConnect platform</footer>
        </blockquote>

        <LanguageSwitcher />
      </div>

      {/* Form panel */}
      <div className="flex flex-1 flex-col">
        {/* Mobile header — logo + switcher */}
        <div className="lg:hidden flex items-center justify-between px-6 pt-6 pb-4 bg-primary-600 text-white">
          <span className="font-bold text-lg">SkillIndiaConnect</span>
          <LanguageSwitcher />
        </div>

        <div className="flex flex-1 items-center justify-center px-6 py-10">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </div>
    </div>
  );
}
