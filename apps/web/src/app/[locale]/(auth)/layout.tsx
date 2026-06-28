import type { ReactNode } from 'react';
import { LanguageSwitcher } from '@/components/auth/LanguageSwitcher';

// Split-panel auth layout: gradient hero on the left, form on the right.
// RTL: logical CSS flips the columns automatically when dir="rtl".
export default function AuthLayout({ children }: { children: ReactNode }) {
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
