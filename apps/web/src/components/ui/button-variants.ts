import { cva } from 'class-variance-authority';

export const buttonVariants = cva(
  [
    'inline-flex shrink-0 items-center justify-center gap-2',
    'rounded-md font-medium whitespace-nowrap transition-colors',
    'select-none cursor-pointer',
    'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70',
    'disabled:pointer-events-none disabled:opacity-50',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:size-4',
  ].join(' '),
  {
    variants: {
      variant: {
        primary: 'bg-accent-500 text-neutral-900 hover:bg-accent-600 active:bg-accent-700',
        secondary: 'bg-primary-600 text-white hover:bg-primary-700 active:bg-primary-800',
        /**
         * The brand-navy gradient CTA — Next, Save, Download PDF, Publish.
         *
         * It exists as a variant because it kept being hand-rolled: seven call
         * sites pasted `bg-gradient-to-r from-[#0F3D91] to-[#2E67B1]` onto
         * `variant="primary"`, which repainted the background blue but LEFT the
         * primary variant's `text-neutral-900` in place — near-black text on dark
         * navy. Background and foreground are one decision, so they live in one
         * place and cannot be half-overridden again.
         *
         * Carries colour only. Padding, radius and shadow stay at the call site,
         * where they legitimately differ.
         */
        brand: 'bg-gradient-to-r from-[#0F3D91] to-[#2E67B1] text-white',
        outline:
          'border border-border bg-background text-foreground hover:bg-neutral-100 active:bg-neutral-200',
        ghost: 'bg-transparent text-foreground hover:bg-neutral-100 active:bg-neutral-200',
        destructive: 'bg-error text-white hover:bg-error-fg active:opacity-90',
        link: 'text-primary-600 underline-offset-4 hover:underline p-0 h-auto',
      },
      size: {
        sm: 'h-9 px-3 text-sm',
        md: 'h-11 px-4 text-base',
        lg: 'h-12 px-6 text-lg',
        icon: 'h-11 w-11',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);
