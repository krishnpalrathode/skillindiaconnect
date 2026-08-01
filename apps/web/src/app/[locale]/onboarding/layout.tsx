import type { ReactNode } from 'react';
import Image from 'next/image';

export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-svh bg-[#F5F8FC]">
      {/* Branded top bar — object-cover crops the artwork band out of the logo's
          gray canvas (same treatment as the login screen and app sidebar). */}
      <header className="sticky top-0 z-10 border-b border-neutral-200/70 bg-white/95 shadow-sm backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-3xl items-center px-4">
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
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 sm:py-10">{children}</main>
    </div>
  );
}
