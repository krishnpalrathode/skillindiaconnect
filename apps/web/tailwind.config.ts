import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}', './components.json'],
  theme: {
    extend: {
      /* ── Colors — sourced from CSS custom properties in tokens.css ── */
      colors: {
        /* Brand ramps (hex; no opacity modifier support — use explicit stops) */
        primary: {
          '50': 'var(--color-primary-50)',
          '100': 'var(--color-primary-100)',
          '200': 'var(--color-primary-200)',
          '300': 'var(--color-primary-300)',
          '400': 'var(--color-primary-400)',
          '500': 'var(--color-primary-500)',
          '600': 'var(--color-primary-600)',
          '700': 'var(--color-primary-700)',
          '800': 'var(--color-primary-800)',
          '900': 'var(--color-primary-900)',
          DEFAULT: 'var(--color-primary-600)',
        },
        accent: {
          '50': 'var(--color-accent-50)',
          '100': 'var(--color-accent-100)',
          '200': 'var(--color-accent-200)',
          '300': 'var(--color-accent-300)',
          '400': 'var(--color-accent-400)',
          '500': 'var(--color-accent-500)',
          '600': 'var(--color-accent-600)',
          '700': 'var(--color-accent-700)',
          '800': 'var(--color-accent-800)',
          '900': 'var(--color-accent-900)',
          DEFAULT: 'var(--color-accent-500)',
        },
        neutral: {
          '50': 'var(--color-neutral-50)',
          '100': 'var(--color-neutral-100)',
          '200': 'var(--color-neutral-200)',
          '300': 'var(--color-neutral-300)',
          '400': 'var(--color-neutral-400)',
          '500': 'var(--color-neutral-500)',
          '600': 'var(--color-neutral-600)',
          '700': 'var(--color-neutral-700)',
          '800': 'var(--color-neutral-800)',
          '900': 'var(--color-neutral-900)',
        },
        /* Semantic aliases */
        success: {
          DEFAULT: 'var(--color-success)',
          bg: 'var(--color-success-bg)',
          fg: 'var(--color-success-fg)',
        },
        warning: {
          DEFAULT: 'var(--color-warning)',
          bg: 'var(--color-warning-bg)',
          fg: 'var(--color-warning-fg)',
        },
        error: {
          DEFAULT: 'var(--color-error)',
          bg: 'var(--color-error-bg)',
          fg: 'var(--color-error-fg)',
        },
        info: {
          DEFAULT: 'var(--color-info)',
          bg: 'var(--color-info-bg)',
          fg: 'var(--color-info-fg)',
        },
        /* shadcn role tokens — RGB triplets → opacity modifiers work */
        background: 'rgb(var(--background) / <alpha-value>)',
        foreground: 'rgb(var(--foreground) / <alpha-value>)',
        card: {
          DEFAULT: 'rgb(var(--card) / <alpha-value>)',
          foreground: 'rgb(var(--card-foreground) / <alpha-value>)',
        },
        popover: {
          DEFAULT: 'rgb(var(--popover) / <alpha-value>)',
          foreground: 'rgb(var(--popover-foreground) / <alpha-value>)',
        },
        /* "primary" role (blue): keep DEFAULT pointing at role var so
           bg-primary resolves to primary-600 via the role token */
        secondary: {
          DEFAULT: 'rgb(var(--secondary) / <alpha-value>)',
          foreground: 'rgb(var(--secondary-foreground) / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'rgb(var(--muted) / <alpha-value>)',
          foreground: 'rgb(var(--muted-foreground) / <alpha-value>)',
        },
        destructive: {
          DEFAULT: 'rgb(var(--destructive) / <alpha-value>)',
          foreground: 'rgb(var(--destructive-foreground) / <alpha-value>)',
        },
        border: 'rgb(var(--border) / <alpha-value>)',
        input: 'rgb(var(--input) / <alpha-value>)',
        ring: 'rgb(var(--ring) / <alpha-value>)',
      },

      /* ── Typography ── */
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        arabic: ['var(--font-arabic)', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        xs: ['0.75rem', { lineHeight: '1rem' }],
        sm: ['0.875rem', { lineHeight: '1.375rem' }],
        base: ['1rem', { lineHeight: '1.6rem' }] /* 16px min, 1.6 lh */,
        lg: ['1.125rem', { lineHeight: '1.75rem' }],
        xl: ['1.25rem', { lineHeight: '1.875rem' }],
        '2xl': ['1.5rem', { lineHeight: '2rem' }],
        '3xl': ['1.875rem', { lineHeight: '2.375rem' }],
        '4xl': ['2.25rem', { lineHeight: '2.75rem' }],
      },
      fontWeight: {
        normal: '400',
        medium: '500',
        semibold: '600',
        bold: '700',
        /* 300/ultralight intentionally absent — vanishes on low-end panels */
      },

      /* ── Spacing — default 4px scale retained; semantics added ── */
      spacing: {
        /* Touch target helper: ensure 44px minimum */
        touch: '2.75rem' /* 44px */,
      },

      /* ── Border radius ── */
      borderRadius: {
        sm: 'var(--radius-sm)' /* 6px  */,
        md: 'var(--radius-md)' /* 8px  */,
        lg: 'var(--radius-lg)' /* 12px */,
        DEFAULT: 'var(--radius-md)',
        /* Keep shadcn --radius alias */
        base: 'var(--radius)',
      },

      /* ── Ring widths (v3 doesn't ship ring-3; add it) ── */
      ringWidth: {
        '3': '3px',
      },

      /* ── Shadows ── */
      boxShadow: {
        sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
        md: '0 4px 6px -1px rgb(0 0 0 / 0.08), 0 2px 4px -2px rgb(0 0 0 / 0.04)',
        lg: '0 10px 15px -3px rgb(0 0 0 / 0.08), 0 4px 6px -4px rgb(0 0 0 / 0.04)',
      },

      /* ── Animation ──
         Skeleton + spinner, plus the landing hero's entrance and ambient
         motion. Every hero keyframe animates ONLY transform and opacity so the
         compositor can run them off the main thread — nothing here can trigger
         layout, so hero motion cannot contribute to CLS. All of it is disabled
         under prefers-reduced-motion (see globals.css). */
      keyframes: {
        'spin-smooth': {
          to: { transform: 'rotate(360deg)' },
        },

        /* Entrance — runs once on load. */
        'hero-rise': {
          from: { opacity: '0', transform: 'translate3d(0, 20px, 0)' },
          to: { opacity: '1', transform: 'translate3d(0, 0, 0)' },
        },
        'hero-rise-scale': {
          from: { opacity: '0', transform: 'translate3d(0, 20px, 0) scale(0.97)' },
          to: { opacity: '1', transform: 'translate3d(0, 0, 0) scale(1)' },
        },
        /* Signature moment: the accent underline draws in. Direction is set by
           transform-origin, which flips for RTL in globals.css. */
        'hero-underline': {
          from: { transform: 'scaleX(0)' },
          to: { transform: 'scaleX(1)' },
        },

        /* Ambient — slow, looping, low-contrast. */
        'hero-glow-drift': {
          '0%, 100%': { transform: 'translate3d(0, 0, 0) scale(1)' },
          '50%': { transform: 'translate3d(6%, -4%, 0) scale(1.12)' },
        },
        'hero-float-a': {
          '0%, 100%': { transform: 'translate3d(0, 0, 0) rotate(0deg)' },
          '50%': { transform: 'translate3d(0, -18px, 0) rotate(6deg)' },
        },
        'hero-float-b': {
          '0%, 100%': { transform: 'translate3d(0, 0, 0) rotate(0deg)' },
          '50%': { transform: 'translate3d(10px, 14px, 0) rotate(-8deg)' },
        },
        'hero-float-c': {
          '0%, 100%': { transform: 'translate3d(0, 0, 0) scale(1)' },
          '50%': { transform: 'translate3d(-12px, -10px, 0) scale(1.08)' },
        },

        /* Carousel: slow Ken Burns drift while a slide is displayed. */
        'hero-kenburns': {
          from: { transform: 'scale(1)' },
          to: { transform: 'scale(1.04)' },
        },

        /* Branded loader. Three layered motions, all slow and low-amplitude:
           the mark breathes, a ring sweeps behind it, and the ground shadow
           tightens as the mark rises — that shadow link is what reads as depth
           rather than a sticker sliding around. */
        'brand-float': {
          '0%, 100%': { transform: 'translate3d(0, 0, 0) scale(1)' },
          '50%': { transform: 'translate3d(0, -6px, 0) scale(1.015)' },
        },
        'brand-sweep': {
          to: { transform: 'rotate(360deg)' },
        },
        'brand-shadow': {
          '0%, 100%': { transform: 'scaleX(1)', opacity: '0.28' },
          '50%': { transform: 'scaleX(0.82)', opacity: '0.16' },
        },

        /* Toast: slides in from the inline-end edge. Uses a logical custom
           property so RTL enters from the opposite side (set in globals.css). */
        'toast-in': {
          from: { opacity: '0', transform: 'translate3d(var(--toast-enter-x, 16px), 0, 0)' },
          to: { opacity: '1', transform: 'translate3d(0, 0, 0)' },
        },
        /* Countdown bar draining to zero over the toast's own lifetime. */
        'toast-progress': {
          from: { transform: 'scaleX(1)' },
          to: { transform: 'scaleX(0)' },
        },
      },
      animation: {
        'spin-smooth': 'spin-smooth 0.8s linear infinite',

        /* `both` fill-mode holds the from-state during the stagger delay.
           Critically, opacity:0 lives in the KEYFRAME, never in a base class —
           so if CSS fails to load the content still paints. */
        'hero-rise': 'hero-rise 600ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'hero-rise-scale': 'hero-rise-scale 600ms cubic-bezier(0.16, 1, 0.3, 1) both',
        /* 1240ms = entrance settles (~840ms) + the 400ms beat before the draw. */
        'hero-underline': 'hero-underline 500ms cubic-bezier(0.16, 1, 0.3, 1) 1240ms both',

        'hero-glow-drift': 'hero-glow-drift 15s ease-in-out infinite',
        'hero-float-a': 'hero-float-a 9s ease-in-out infinite',
        'hero-float-b': 'hero-float-b 11s ease-in-out infinite',
        'hero-float-c': 'hero-float-c 8s ease-in-out infinite',

        /* Runs across the full 5s dwell + the 700ms crossfade into the next. */
        'hero-kenburns': 'hero-kenburns 5700ms ease-out both',

        /* Shared 2.8s period keeps the float and its shadow in lockstep. */
        'brand-float': 'brand-float 2800ms ease-in-out infinite',
        'brand-shadow': 'brand-shadow 2800ms ease-in-out infinite',
        'brand-sweep': 'brand-sweep 2400ms linear infinite',

        'toast-in': 'toast-in 220ms cubic-bezier(0.16, 1, 0.3, 1) both',
        /* Duration is set inline per toast so the bar matches its real lifetime. */
        'toast-progress': 'toast-progress linear both',
      },
    },
  },
  plugins: [],
};

export default config;
