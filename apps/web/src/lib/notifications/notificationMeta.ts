import { Briefcase, FileText, Info, UserCheck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { components } from '@skillindiaconnect/shared-types';

type NotificationType = components['schemas']['NotificationType'];

export interface NotificationMeta {
  Icon: LucideIcon;
  colorClass: string;
  bgClass: string;
  routeFn?: (
    relatedEntityId?: string | null,
    relatedEntityType?: 'job' | 'application' | null,
  ) => string | undefined;
}

export const notificationMeta: Record<NotificationType, NotificationMeta> = {
  APPLICATION_UPDATE: {
    Icon: FileText,
    colorClass: 'text-primary-600',
    bgClass: 'bg-primary-50',
    routeFn: (id, type) => (type === 'application' && id ? `/applications/${id}` : undefined),
  },
  JOB_MATCH: {
    Icon: Briefcase,
    colorClass: 'text-accent-600',
    bgClass: 'bg-orange-50',
    routeFn: (id, type) => (type === 'job' && id ? `/jobs/${id}` : undefined),
  },
  PROFILE_REMINDER: {
    Icon: UserCheck,
    colorClass: 'text-success-fg',
    bgClass: 'bg-success-bg',
    routeFn: () => '/profile',
  },
  DOCUMENT_STATUS: {
    Icon: FileText,
    colorClass: 'text-warning-fg',
    bgClass: 'bg-warning-bg',
    routeFn: () => '/profile',
  },
  SYSTEM: {
    Icon: Info,
    colorClass: 'text-neutral-500',
    bgClass: 'bg-neutral-100',
  },
};
