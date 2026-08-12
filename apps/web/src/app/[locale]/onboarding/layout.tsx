import type { ReactNode } from 'react';
import Image from 'next/image';
import { OnboardingHeaderActions } from '@/components/onboarding/OnboardingHeaderActions';

export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-svh bg-gradient-to-b from-[#EEF3FB] via-[#F5F8FC] to-white">
      {/* Soft brand glow behind the content — purely decorative. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[radial-gradient(60%_100%_at_50%_0%,rgba(15,61,145,0.10),transparent)]"
      />

      {/* Full-width branded header. Logo is pinned to the top-left; object-cover
          crops the artwork band out of the logo's gray canvas (same treatment as
          the login screen and app sidebar).

          Three columns rather than `justify-between`, so the title sits in the
          TRUE centre of the header instead of drifting with the width of the
          logo and the sign-out button beside it. The outer columns are equal
          `1fr` for that reason; the middle one is only as wide as its text. */}
      <header className="sticky top-0 z-20 border-b border-neutral-200/70 bg-white/90 shadow-sm backdrop-blur-md">
        <div className="grid h-16 w-full grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 sm:px-6 lg:px-8">
          <div className="relative h-11 w-36 overflow-hidden rounded-md">
            <Image
              src="/brand/logo.png"
              alt="SkillIndia Connect"
              fill
              priority
              sizes="144px"
              className="object-cover object-center"
            />
          </div>

          <span className="text-center text-sm font-medium text-neutral-600">
            Candidate onboarding
          </span>

          {/* Sign-out — the only way out of onboarding before it is finished. */}
          <div className="flex justify-end">
            <OnboardingHeaderActions />
          </div>
        </div>
      </header>

      {/*
        Shell width. max-w-3xl (768px) read as a phone-sized card marooned on a
        desktop screen. 1024px lets the field grid below run two comfortable
        ~460px columns instead of one over-long line, which is what actually
        removes the dead space — widening alone would just stretch the inputs.
      */}
      <main className="relative mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8 lg:py-12">
        {children}
      </main>
    </div>
  );
}
