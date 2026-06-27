import * as React from 'react';
import { cn } from '@/lib/utils';

interface SpinnerProps extends React.SVGAttributes<SVGElement> {
  size?: number;
  label?: string;
}

/* Accessible indeterminate loading indicator.
   Use for actions (button loading, async waits).
   Use Skeleton for content-shaped placeholders. */
function Spinner({ size = 20, label = 'Loading…', className, ...props }: SpinnerProps) {
  return (
    <svg
      role="status"
      aria-label={label}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      className={cn('animate-spin', className)}
      {...props}
    >
      <circle cx={12} cy={12} r={10} strokeOpacity={0.25} />
      <path d="M12 2a10 10 0 0 1 10 10" />
    </svg>
  );
}

export { Spinner };
