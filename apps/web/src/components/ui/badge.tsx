import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/* Semantic badge variants named by MEANING, not color.
   Foreground colors verified AA on their light backgrounds. */
const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
  {
    variants: {
      variant: {
        /* Status semantics (PDF: verified/selected = green, pending = amber,
           rejected/expired = red, informational = blue) */
        success: 'bg-success-bg text-success-fg' /* 4.5:1 ✓ */,
        warning: 'bg-warning-bg text-warning-fg' /* 5.7:1 ✓ */,
        error: 'bg-error-bg   text-error-fg' /* 5.9:1 ✓ */,
        info: 'bg-info-bg    text-info-fg' /* 4.6:1 ✓ */,
        neutral: 'bg-neutral-100 text-neutral-700' /* 10:1 ✓  */,
        /* Primary brand badges */
        primary: 'bg-primary-100 text-primary-700',
        accent: 'bg-accent-100  text-accent-700',
      },
    },
    defaultVariants: {
      variant: 'neutral',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
