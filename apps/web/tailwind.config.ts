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

      /* ── Animation (basic keyframes for skeleton + spinner) ── */
      keyframes: {
        'spin-smooth': {
          to: { transform: 'rotate(360deg)' },
        },
      },
      animation: {
        'spin-smooth': 'spin-smooth 0.8s linear infinite',
      },
    },
  },
  plugins: [],
};

export default config;
