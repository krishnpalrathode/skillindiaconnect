'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
}

const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, children, required, ...props }, ref) => {
    return (
      <label
        ref={ref}
        className={cn(
          'text-sm font-medium leading-none text-foreground select-none',
          'peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
          className,
        )}
        {...props}
      >
        {children}
        {required && (
          <span className="ms-0.5 text-error" aria-hidden="true">
            *
          </span>
        )}
      </label>
    );
  },
);
Label.displayName = 'Label';

export { Label };
