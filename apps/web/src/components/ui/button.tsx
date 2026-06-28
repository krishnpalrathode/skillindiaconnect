'use client';

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/* CTA = accent/orange (dark text for AA). Structural = primary/blue (white text).
   Touch targets: md and lg are ≥44px (h-11 = 44px). */
const buttonVariants = cva(
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
        /* CTA — orange; dark text (8.2:1 on accent-500) ✓ AA */
        primary: 'bg-accent-500 text-neutral-900 hover:bg-accent-600 active:bg-accent-700',
        /* Structural — blue; white text (7.2:1 on primary-600) ✓ AA */
        secondary: 'bg-primary-600 text-white hover:bg-primary-700 active:bg-primary-800',
        outline:
          'border border-border bg-background text-foreground hover:bg-neutral-100 active:bg-neutral-200',
        ghost: 'bg-transparent text-foreground hover:bg-neutral-100 active:bg-neutral-200',
        destructive: 'bg-error text-white hover:bg-error-fg active:opacity-90',
        link: 'text-primary-600 underline-offset-4 hover:underline p-0 h-auto',
      },
      size: {
        sm: 'h-9 px-3 text-sm' /* 36px — acceptable for secondary actions */,
        md: 'h-11 px-4 text-base' /* 44px touch target ✓ */,
        lg: 'h-12 px-6 text-lg' /* 48px touch target ✓ */,
        icon: 'h-11 w-11' /* 44px square icon button */,
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  loading?: boolean;
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, disabled, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(buttonVariants({ variant, size, className }))}
        disabled={disabled || loading}
        aria-busy={loading}
        {...props}
      >
        {loading && <Loader2 className="animate-spin size-4" aria-hidden="true" />}
        {children}
      </button>
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
