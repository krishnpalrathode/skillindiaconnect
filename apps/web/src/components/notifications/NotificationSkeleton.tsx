'use client';

import React from 'react';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Mirrors the real row geometry (avatar circle, two text lines, timestamp) so
 * the feed does not jump when data lands — a centred "Loading…" string collapses
 * to nothing and shifts everything below it.
 */
export function NotificationSkeleton({ rows = 5, label }: { rows?: number; label: string }) {
  return (
    <div className="flex flex-col gap-6" role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>

      <div>
        <Skeleton className="mb-2 ms-1 h-3 w-16" />
        <div className="divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200 bg-white">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex items-start gap-3 px-4 py-3">
              <Skeleton className="mt-0.5 size-9 flex-none rounded-full" />
              <div className="min-w-0 flex-1">
                {/* Staggered widths read as text rather than as blocks. */}
                <Skeleton className={i % 2 === 0 ? 'h-4 w-2/5' : 'h-4 w-1/2'} />
                <Skeleton className={i % 2 === 0 ? 'mt-2 h-3 w-4/5' : 'mt-2 h-3 w-3/5'} />
                <Skeleton className="mt-2 h-3 w-14" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
