'use client';

import { cn } from '@/lib/utils';

interface LinkedinButtonProps {
  label: string;
  className?: string;
}

/**
 * Triggers a top-level redirect to the LinkedIn OAuth endpoint.
 *
 * Must be a full navigation (window.location), NOT a fetch — the OAuth flow ends
 * in a cross-origin redirect to LinkedIn's consent screen, which XHR cannot
 * follow, and the API sets an HttpOnly cookie on the way back that only a real
 * navigation will carry.
 *
 * Deliberately a SIBLING of GoogleButton rather than a shared <OAuthButton
 * provider="…">. The two differ in exactly one line of behaviour and everything
 * else is brand presentation — a wordmark colour, an official icon, and a
 * required brand-conformant label. Folding them together would mean a props
 * matrix carrying each provider's brand rules, which is more moving parts than
 * the duplication it removes.
 */
export function LinkedinButton({ label, className }: LinkedinButtonProps) {
  function handleClick() {
    const base =
      process.env.NEXT_PUBLIC_API_MOCKING === 'enabled'
        ? ''
        : (process.env['NEXT_PUBLIC_API_URL'] ?? '');
    window.location.href = `${base}/api/v1/auth/linkedin`;
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        'flex w-full items-center justify-center gap-3',
        'h-11 rounded-md border border-border bg-background',
        'text-sm font-medium text-foreground',
        'hover:bg-neutral-50 active:bg-neutral-100',
        'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70',
        'transition-colors',
        className,
      )}
    >
      {/*
        The LinkedIn "in" glyph, inline SVG — no external asset and no network
        request, matching GoogleButton. #0A66C2 is LinkedIn's specified brand
        blue; their brand guidelines require the mark be shown in that colour or
        in solid white/black, never recoloured to match a host theme.
      */}
      <svg
        aria-hidden="true"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="#0A66C2"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.03-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zm1.78 13.02H3.55V9h3.57v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0z" />
      </svg>
      {label}
    </button>
  );
}
