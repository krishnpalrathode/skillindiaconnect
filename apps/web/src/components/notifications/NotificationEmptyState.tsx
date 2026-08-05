'use client';

import React from 'react';
import Link from 'next/link';
import { BellOff, Inbox, CheckCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

type EmptyKind = 'all' | 'filter' | 'unread';

const KIND_ICON: Record<EmptyKind, typeof Inbox> = {
  // Genuinely nothing yet vs. nothing matching a filter vs. nothing left unread
  // are three different situations, and the icon should say which.
  all: Inbox,
  filter: BellOff,
  unread: CheckCheck,
};

interface NotificationEmptyStateProps {
  kind: EmptyKind;
  title: string;
  body: string;
  action?: { label: string; href: string } | { label: string; onClick: () => void };
}

/**
 * An empty feed is the FIRST thing most candidates see here, so it explains what
 * will land in this space and offers the next step — rather than being a dead
 * end that only states the absence.
 */
export function NotificationEmptyState({ kind, title, body, action }: NotificationEmptyStateProps) {
  const Icon = KIND_ICON[kind];

  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-neutral-200 bg-white px-6 py-14 text-center">
      <span
        className={cn(
          'flex size-14 items-center justify-center rounded-full',
          kind === 'unread' ? 'bg-success-bg' : 'bg-primary-50',
        )}
      >
        <Icon
          className={cn('size-7', kind === 'unread' ? 'text-success-fg' : 'text-primary-600')}
          aria-hidden="true"
        />
      </span>

      <div className="flex flex-col gap-1.5">
        <h2 className="text-base font-bold text-neutral-900">{title}</h2>
        <p className="mx-auto max-w-sm text-sm leading-relaxed text-neutral-600">{body}</p>
      </div>

      {action &&
        ('href' in action ? (
          <Link
            href={action.href}
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-primary-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
          >
            {action.label}
          </Link>
        ) : (
          <button
            type="button"
            onClick={action.onClick}
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-neutral-300 px-5 text-sm font-semibold text-neutral-800 transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
          >
            {action.label}
          </button>
        ))}
    </div>
  );
}
