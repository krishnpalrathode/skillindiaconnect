'use client';

import * as React from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';

/*
  The loading system has three tiers, and picking the right one matters more
  than the animation does:

    page / route wait  → <BrandLoader size="lg"> (or BrandLoaderPage)
    section or panel   → <BrandLoader size="md">
    a single button    → <Button loading> — a 16px logo is illegible, so the
                         button keeps its small inline spinner, plus the
                         disabled + aria-busy pair that blocks double submits.

  There is deliberately no full-viewport overlay variant. Nothing in the app
  needs to veil the whole screen for an in-place action, and adding one invites
  exactly the "everything is blocked for a 200ms PATCH" pattern we don't want.
*/
type BrandLoaderSize = 'sm' | 'md' | 'lg';

interface BrandLoaderProps {
  /**
   * Accessible status text, announced but not painted — same contract as the
   * Spinner this replaces. Screens that already show their own "Loading…" copy
   * would otherwise render it twice.
   */
  label?: string;
  size?: BrandLoaderSize;
  className?: string;
}

/**
 * Sizes are fixed rather than free-form so the mark, the ring around it and the
 * ground shadow always scale together — a loose numeric size lets those three
 * drift apart and the depth illusion collapses.
 */
const SIZES: Record<BrandLoaderSize, { box: string; mark: number; ring: string; shadow: string }> =
  {
    sm: { box: 'size-10', mark: 40, ring: 'size-[3.25rem]', shadow: 'h-1 w-8' },
    md: { box: 'size-16', mark: 64, ring: 'size-[5rem]', shadow: 'h-1.5 w-12' },
    lg: { box: 'size-24', mark: 96, ring: 'size-[7.5rem]', shadow: 'h-2 w-16' },
  };

/**
 * The SkillIndiaConnect loading mark.
 *
 * The brand logo is the centrepiece, undistorted — it only floats and scales
 * very slightly. Depth comes from three cheap, CSS-only layers: a drop shadow
 * under the mark, a ground shadow that tightens as the mark rises, and a single
 * navy→saffron arc sweeping behind it. No neon, no gradient on the logo itself,
 * nothing that competes with the artwork.
 *
 * Motion is decorative: the whole visual is aria-hidden and the status is
 * announced once, as text, via role="status".
 *
 * prefers-reduced-motion is handled in globals.css (`.brand-loader-anim`),
 * which stops the animations and leaves a composed, static mark — the label
 * still tells the user something is happening.
 */
export function BrandLoader({ label, size = 'md', className }: BrandLoaderProps) {
  const s = SIZES[size];

  return (
    <div role="status" aria-live="polite" className={cn('flex flex-col items-center', className)}>
      <div className="relative flex items-center justify-center" aria-hidden="true">
        {/* Sweeping arc — a conic slice masked to a ring, so it reads as one
            highlight travelling around the mark rather than a spinner. */}
        <span
          className={cn(
            'brand-loader-anim absolute animate-brand-sweep rounded-full',
            'bg-[conic-gradient(from_0deg,transparent_0deg,transparent_250deg,#0F3D91_320deg,#F57C20_360deg)]',
            '[mask:radial-gradient(farthest-side,transparent_calc(100%-3px),#000_calc(100%-3px))]',
            '[-webkit-mask:radial-gradient(farthest-side,transparent_calc(100%-3px),#000_calc(100%-3px))]',
            s.ring,
          )}
        />

        <span
          className={cn(
            'brand-loader-anim relative animate-brand-float rounded-full',
            'shadow-[0_10px_24px_-8px_rgba(15,61,145,0.45)]',
            s.box,
          )}
        >
          <Image
            src="/brand/SIC_mark.png"
            alt=""
            width={s.mark}
            height={s.mark}
            priority
            className="size-full rounded-full object-contain"
          />
        </span>
      </div>

      {/* Ground shadow — the cue that ties the float to a surface. */}
      <span
        aria-hidden="true"
        className={cn(
          'brand-loader-anim mt-3 animate-brand-shadow rounded-[50%] bg-[#0F3D91] blur-[3px]',
          s.shadow,
        )}
      />

      <span className="sr-only">{label ?? 'Loading…'}</span>
    </div>
  );
}

/**
 * Full-screen-ish wrapper for route/page level waits. Deliberately a tall
 * centred block rather than a fixed overlay: blocking the whole viewport for a
 * page that is already navigating adds nothing and traps focus behind a veil.
 */
export function BrandLoaderPage({ label, className }: { label?: string; className?: string }) {
  return (
    <div className={cn('flex min-h-[60vh] items-center justify-center', className)}>
      <BrandLoader size="lg" label={label} />
    </div>
  );
}
