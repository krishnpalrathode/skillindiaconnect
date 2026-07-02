import React from 'react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import type { JobStatus } from '@/lib/api/jobs-employer';

interface JobStatusBadgeProps {
  status: JobStatus;
}

const STATUS_VARIANTS: Record<
  JobStatus,
  'success' | 'info' | 'primary' | 'accent' | 'warning' | 'neutral'
> = {
  ACTIVE: 'success',
  DRAFT: 'info',
  PAUSED: 'warning',
  ARCHIVED: 'neutral',
};

export function JobStatusBadge({ status }: JobStatusBadgeProps) {
  const t = useTranslations('myjobs.status');

  const labels: Record<JobStatus, string> = {
    ACTIVE: t('active'),
    DRAFT: t('draft'),
    PAUSED: t('paused'),
    ARCHIVED: t('archived'),
  };

  return (
    <Badge variant={STATUS_VARIANTS[status] ?? 'info'} aria-label={`Status: ${labels[status]}`}>
      {labels[status]}
    </Badge>
  );
}
