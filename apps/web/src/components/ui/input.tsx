import * as React from 'react';
import { cn } from '@/lib/utils';

/* ≥44px height (h-11), logical padding (ps-/pe-), error state via aria-invalid */
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  hasError?: boolean;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, hasError, ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        aria-invalid={hasError || undefined}
        className={cn(
          'flex h-11 w-full rounded-md border border-input bg-background px-3 py-2',
          'text-base text-foreground placeholder:text-neutral-400',
          'transition-colors outline-none',
          'focus-visible:ring-[3px] focus-visible:ring-ring/70 focus-visible:border-primary-600',
          'disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-neutral-100',
          'aria-[invalid=true]:border-error aria-[invalid=true]:ring-[3px] aria-[invalid=true]:ring-error/25',
          /* Logical padding so layout flips correctly in RTL */
          'ps-3 pe-3',
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';

export { Input };
