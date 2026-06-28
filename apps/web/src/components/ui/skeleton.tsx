import * as React from 'react';
import { cn } from '@/lib/utils';

/* Content-shaped loading placeholder. Use Skeleton for known-shape placeholders;
   use Spinner for indeterminate action loading. */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-neutral-200', className)} {...props} />;
}

export { Skeleton };
