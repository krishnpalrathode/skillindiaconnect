import type { ReactNode } from 'react';

export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-svh bg-neutral-50">
      {/* Branded top bar */}
      <header className="sticky top-0 z-10 bg-white border-b border-neutral-200 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <span className="text-lg font-bold text-primary-700 tracking-tight">
            SkillIndiaConnect
          </span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8">{children}</main>
    </div>
  );
}
