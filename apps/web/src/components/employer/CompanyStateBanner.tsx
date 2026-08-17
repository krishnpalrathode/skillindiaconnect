'use client';

import React, { useEffect, useState } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle, Info, XCircle } from 'lucide-react';
import type { components } from '@skillindiaconnect/shared-types';
import { getVerificationCall, type VerificationCallRequest } from '@/lib/api/employer';
import { ScheduleVerificationCallDialog } from './ScheduleVerificationCallDialog';
import { cn } from '@/lib/utils';

type CompanyStatus = components['schemas']['CompanyStatus'];

interface CompanyStateBannerProps {
  status: CompanyStatus;
  rejectionReason?: string | null;
}

export function CompanyStateBanner({ status, rejectionReason }: CompanyStateBannerProps) {
  const t = useTranslations('employer');
  const tCall = useTranslations('employer.verificationCall');
  const format = useFormatter();
  const params = useParams<{ locale: string }>();
  const locale = params?.locale ?? 'en';

  const [call, setCall] = useState<VerificationCallRequest | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  /*
    Only fetched while PENDING.

    Every other state either cannot book a call (APPROVED needs nothing,
    SUSPENDED needs support) or is a different conversation (REJECTED needs a
    resubmission), so firing this request on those screens would be a round trip
    whose answer is never used.
  */
  useEffect(() => {
    if (status !== 'PENDING') return;
    let active = true;
    getVerificationCall()
      .then((c) => {
        if (active) setCall(c);
      })
      .catch(() => {
        // Non-fatal: the banner falls back to offering a fresh booking, which
        // is an upsert anyway — worst case the employer re-picks their time.
      });
    return () => {
      active = false;
    };
  }, [status]);

  if (status === 'APPROVED') return null;

  const configs = {
    PENDING: {
      role: 'status' as const,
      icon: <Info className="size-5 shrink-0" aria-hidden="true" />,
      className: 'bg-info-bg text-info-fg border-info',
      title: t('banner.pendingTitle'),
      // Once a call is booked the 24-hour line is no longer the story — the
      // slot is. Saying both would leave the employer unsure which applies.
      body: call
        ? tCall('bookedBanner', {
            when: format.dateTime(new Date(call.slotAt), {
              dateStyle: 'medium',
              timeStyle: 'short',
            }),
          })
        : t('banner.pendingBody'),
      action: (
        /*
          The fast path, offered right where the wait is announced.

          A button rather than a link: it opens the picker in place, so an
          employer who has just read "up to 24 hours" can act on that sentence
          without losing the page they are on.
        */
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="rounded font-semibold underline underline-offset-2 hover:no-underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70"
        >
          {call ? tCall('rescheduleAction') : tCall('action')}
        </button>
      ),
    },
    REJECTED: {
      role: 'alert' as const,
      icon: <AlertCircle className="size-5 shrink-0" aria-hidden="true" />,
      className: 'bg-warning-bg text-warning-fg border-warning',
      title: t('banner.rejectedTitle'),
      body: rejectionReason ?? t('banner.rejectedBodyFallback'),
      action: (
        <Link
          href={`/${locale}/employer/onboarding`}
          className="underline underline-offset-2 font-semibold hover:no-underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/70 rounded"
        >
          {t('banner.rejectedAction')}
        </Link>
      ),
    },
    SUSPENDED: {
      role: 'alert' as const,
      icon: <XCircle className="size-5 shrink-0" aria-hidden="true" />,
      className: 'bg-error-bg text-error-fg border-error',
      title: t('banner.suspendedTitle'),
      body: t('banner.suspendedBody'),
      action: null,
    },
  };

  const config = configs[status];
  if (!config) return null;

  return (
    <>
      <div
        role={config.role}
        aria-live={config.role === 'alert' ? 'assertive' : 'polite'}
        className={cn('flex items-start gap-3 px-4 py-3 border-b text-sm', config.className)}
      >
        {config.icon}
        <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
          <span className="font-semibold">{config.title}</span>
          <span>{config.body}</span>
          {config.action}
        </div>
      </div>

      {dialogOpen && (
        <ScheduleVerificationCallDialog
          existing={call}
          onScheduled={(booking) => {
            setCall(booking);
            setDialogOpen(false);
          }}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </>
  );
}
