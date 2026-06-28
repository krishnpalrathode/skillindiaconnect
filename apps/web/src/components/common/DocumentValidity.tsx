'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface DocumentValidityProps {
  expiryDate: string | null | undefined;
  className?: string;
}

/**
 * Shows a validity badge for documents with an expiry date.
 * Green "Valid until {date}" when not expired; red "Expired {date}" when past.
 * Validity is checked client-side against the stored expiryDate field.
 */
export function DocumentValidity({ expiryDate, className }: DocumentValidityProps) {
  const t = useTranslations('profile.documents');

  if (!expiryDate) return null;

  const expiry = new Date(expiryDate);
  const isExpired = expiry < new Date();
  const formatted = expiry.toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  if (isExpired) {
    return (
      <Badge variant="error" className={cn('gap-1', className)}>
        <AlertCircle className="size-3 shrink-0" aria-hidden="true" />
        <span>{t('expiredOn', { date: formatted })}</span>
      </Badge>
    );
  }

  return (
    <Badge variant="success" className={cn('gap-1', className)}>
      <CheckCircle2 className="size-3 shrink-0" aria-hidden="true" />
      <span>{t('validUntil', { date: formatted })}</span>
    </Badge>
  );
}
