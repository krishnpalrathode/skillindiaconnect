'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight, BadgeCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Slide sources live in /public/hero (Pexels licence — attribution logged in
 * public/hero/README.md). Each file is pre-cropped to 4:3 so it drops straight
 * into the fixed-ratio frame without a client-side resize.
 *
 * The ORDER is the pitch: the group shot first, then the six trades we actually
 * recruit for. Someone who only sees the first slide before scrolling should
 * already have seen a worker they recognise as themselves — which is the whole
 * reason this is a carousel and not one photograph.
 *
 * Hospitality is deliberately not in the rotation any more: at six slides the
 * strip already runs 30 seconds, and the trades below are the ones the job feed
 * is actually weighted towards. The file stays in /public/hero for reuse.
 */
const SLIDES = [
  /*
    The group shot leads.

    It is the only frame that shows the whole promise at once — five trades,
    together, looking straight at the reader — so it is what a visitor who never
    waits for slide two takes away. The single-trade slides behind it then do
    the specific work of "yes, yours too".

    Being first also makes it the LCP image (see `priority` below), which is why
    it is worth keeping at the same 900x675 as everything else rather than
    shipping the full-resolution original.
  */
  { src: '/hero/worker-team.jpg', categoryKey: 'team' },
  { src: '/hero/worker-electrical.jpg', categoryKey: 'electrical' },
  { src: '/hero/worker-welding.jpg', categoryKey: 'welding' },
  { src: '/hero/worker-technician.jpg', categoryKey: 'technician' },
  { src: '/hero/worker-healthcare.jpg', categoryKey: 'healthcare' },
  { src: '/hero/worker-driving.jpg', categoryKey: 'driving' },
  { src: '/hero/worker-construction.jpg', categoryKey: 'construction' },
] as const;

/** Trust lines rotate in step with the slides. Each is a product fact. */
const TRUST_KEYS = ['protection', 'free', 'verified'] as const;

const SLIDE_MS = 5000;

/**
 * Auto-advancing worker imagery beside the hero copy.
 *
 * Guarantees:
 * - CLS 0 — the frame is a fixed `aspect-[4/3]` box, so slides never resize it.
 * - Only `opacity`/`transform` animate, so everything stays on the compositor.
 * - Auto-advance pauses on hover, on keyboard focus, and when the tab is
 *   hidden; `prefers-reduced-motion` disables auto-advance and the Ken Burns
 *   drift entirely while leaving the arrows fully usable.
 * - RTL: the arrows swap sides with the flex row, their glyphs mirror, and the
 *   *reading-forward* arrow always advances (so "next" means next in both
 *   directions).
 */
export function HeroCarousel() {
  const t = useTranslations('landing.carousel');

  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const touchStartX = useRef<number | null>(null);

  // Respect the OS motion preference, and keep respecting it if it changes.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReducedMotion(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  // A background tab should not burn cycles advancing images nobody sees.
  useEffect(() => {
    const onVisibility = () => setPaused(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const go = useCallback((dir: 1 | -1) => {
    setIndex((i) => (i + dir + SLIDES.length) % SLIDES.length);
  }, []);

  // Auto-advance. Disabled outright under reduced motion.
  useEffect(() => {
    if (paused || reducedMotion) return;
    const id = window.setInterval(() => go(1), SLIDE_MS);
    return () => window.clearInterval(id);
  }, [paused, reducedMotion, go]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Arrow keys follow the visual direction the user sees.
    const rtl = typeof document !== 'undefined' && document.dir === 'rtl';
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      go(rtl ? -1 : 1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      go(rtl ? 1 : -1);
    }
  };

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStartX.current;
    const end = e.changedTouches[0]?.clientX;
    touchStartX.current = null;
    if (start == null || end == null) return;
    const dx = end - start;
    if (Math.abs(dx) < 40) return; // ignore taps and micro-drags
    const rtl = typeof document !== 'undefined' && document.dir === 'rtl';
    // Swiping against the reading direction advances.
    const forward = rtl ? dx > 0 : dx < 0;
    go(forward ? 1 : -1);
  };

  return (
    <div
      className="hero-anim animate-hero-rise-scale flex flex-col gap-3"
      style={{ animationDelay: '260ms' }}
    >
      {/* ── Carousel frame ─────────────────────────────────────────────── */}
      <div
        role="group"
        aria-roledescription="carousel"
        aria-label={t('label')}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={() => setPaused(false)}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        className={cn(
          'group relative aspect-[4/3] w-full overflow-hidden rounded-2xl',
          'border border-white/15 bg-primary-900 shadow-2xl shadow-black/40',
          'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-400',
        )}
      >
        {SLIDES.map((slide, i) => {
          const active = i === index;
          return (
            <div
              key={slide.src}
              role="group"
              aria-roledescription="slide"
              aria-label={t('slideLabel', { n: i + 1, total: SLIDES.length })}
              aria-hidden={!active}
              className={cn(
                'absolute inset-0 transition-opacity duration-700 ease-out',
                active ? 'opacity-100' : 'opacity-0',
              )}
            >
              <Image
                src={slide.src}
                /* Intentionally empty: the slide wrapper is labelled "Image N
                   of M" and the visible category chip names the trade, so a
                   descriptive alt here would just repeat it. */
                alt=""
                fill
                // First slide is LCP-critical; the rest must not compete for
                // bandwidth on a slow connection.
                priority={i === 0}
                loading={i === 0 ? undefined : 'lazy'}
                sizes="(max-width: 1024px) 100vw, 45vw"
                className={cn('object-cover', active && !reducedMotion && 'animate-hero-kenburns')}
              />
              {/* Legibility scrim. Deliberately light — the trust card and
                  category chip carry their own backgrounds, so this only needs
                  to take the edge off, not hide the photograph behind it. */}
              <div
                aria-hidden="true"
                className="absolute inset-0 bg-gradient-to-t from-primary-900/70 via-transparent to-primary-900/15"
              />

              {/* Category chip — top end corner */}
              <span className="absolute end-3 top-3 rounded-full border border-white/15 bg-primary-900/70 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-sm sm:end-4 sm:top-4">
                {t(`categories.${slide.categoryKey}`)}
              </span>
            </div>
          );
        })}

        {/* ── Floating trust card — bottom start corner ─────────────────── */}
        <div className="absolute bottom-3 start-3 end-3 sm:bottom-4 sm:start-4 sm:end-auto sm:max-w-[78%]">
          <p
            key={index}
            className="flex items-start gap-2.5 rounded-xl border border-white/15 bg-primary-900/80 px-3.5 py-3 text-sm font-semibold leading-snug text-white shadow-lg backdrop-blur-md"
          >
            <BadgeCheck className="mt-0.5 size-5 shrink-0 text-accent-400" aria-hidden="true" />
            {t(`trust.${TRUST_KEYS[index % TRUST_KEYS.length]}`)}
          </p>
        </div>

        {/* ── Arrows ───────────────────────────────────────────────────── */}
        <button
          type="button"
          onClick={() => go(-1)}
          aria-label={t('prev')}
          className={cn(
            'absolute start-2 top-1/2 -translate-y-1/2 sm:start-3',
            'flex size-10 items-center justify-center rounded-full',
            'border border-white/15 bg-primary-900/60 text-white backdrop-blur-sm',
            'transition-[transform,background-color] duration-150',
            'hover:scale-105 hover:bg-primary-900/85 active:scale-95',
            'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-400',
          )}
        >
          <ChevronLeft className="size-5 rtl:rotate-180" aria-hidden="true" />
        </button>

        <button
          type="button"
          onClick={() => go(1)}
          aria-label={t('next')}
          className={cn(
            'absolute end-2 top-1/2 -translate-y-1/2 sm:end-3',
            'flex size-10 items-center justify-center rounded-full',
            'border border-white/15 bg-primary-900/60 text-white backdrop-blur-sm',
            'transition-[transform,background-color] duration-150',
            'hover:scale-105 hover:bg-primary-900/85 active:scale-95',
            'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent-400',
          )}
        >
          <ChevronRight className="size-5 rtl:rotate-180" aria-hidden="true" />
        </button>
      </div>

      {/* ── Verified strip + indicator pills ──────────────────────────── */}
      <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/15 bg-white/5 px-4 py-3 backdrop-blur-sm">
        <span className="flex items-center gap-2.5 text-sm font-semibold text-white">
          <span aria-hidden="true" className="flex -space-x-2 rtl:space-x-reverse">
            <span className="size-6 rounded-full border-2 border-primary-900 bg-primary-400" />
            <span className="size-6 rounded-full border-2 border-primary-900 bg-accent-500" />
            <span className="size-6 rounded-full border-2 border-primary-900 bg-success" />
            <span className="size-6 rounded-full border-2 border-primary-900 bg-primary-200" />
          </span>
          {t('verifiedStrip')}
        </span>

        <div className="flex shrink-0 items-center gap-1.5">
          {SLIDES.map((slide, i) => (
            <button
              key={slide.src}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={t('goTo', { n: i + 1 })}
              aria-current={i === index}
              className={cn(
                'h-2 rounded-full transition-all duration-300',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400',
                i === index ? 'w-6 bg-accent-500' : 'w-2 bg-white/30 hover:bg-white/50',
              )}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
