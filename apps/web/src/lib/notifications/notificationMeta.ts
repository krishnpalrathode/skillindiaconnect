import {
  Award,
  Briefcase,
  CalendarClock,
  CheckCircle2,
  CreditCard,
  Eye,
  FileWarning,
  Info,
  Send,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  XCircle,
} from 'lucide-react';
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

const toApplication = (id?: string | null, type?: 'job' | 'application' | null) =>
  type === 'application' && id ? `/applications/${id}` : '/applications';
const toJob = (id?: string | null, type?: 'job' | 'application' | null) =>
  type === 'job' && id ? `/jobs/${id}` : '/jobs';
const toProfile = () => '/profile';

// Covers every value of the Prisma/contract NotificationType enum. Grouped to
// mirror the backend FILTER_BUCKETS (applications | jobs | profile | system).
export const notificationMeta: Record<NotificationType, NotificationMeta> = {
  // ── Applications ──────────────────────────────────────────────────────────
  APPLICATION_SELECTED: {
    Icon: Award,
    colorClass: 'text-success-fg',
    bgClass: 'bg-success-bg',
    routeFn: toApplication,
  },
  APPLICATION_SHORTLISTED: {
    Icon: CheckCircle2,
    colorClass: 'text-primary-600',
    bgClass: 'bg-primary-50',
    routeFn: toApplication,
  },
  APPLICATION_REJECTED: {
    Icon: XCircle,
    colorClass: 'text-error-fg',
    bgClass: 'bg-error-bg',
    routeFn: toApplication,
  },
  // ── Jobs ──────────────────────────────────────────────────────────────────
  NEW_JOB_MATCH: {
    Icon: Briefcase,
    colorClass: 'text-accent-600',
    bgClass: 'bg-orange-50',
    routeFn: toJob,
  },
  JOB_CLOSING_SOON: {
    Icon: CalendarClock,
    colorClass: 'text-warning-fg',
    bgClass: 'bg-warning-bg',
    routeFn: toJob,
  },
  CANDIDATE_MATCHES: {
    Icon: Briefcase,
    colorClass: 'text-accent-600',
    bgClass: 'bg-orange-50',
    routeFn: toJob,
  },
  RESUME_SENT: {
    Icon: Send,
    colorClass: 'text-primary-600',
    bgClass: 'bg-primary-50',
    routeFn: toApplication,
  },
  // S7-0: the async render finished — action → the profile's resume section
  // (Step 4), where the download lives.
  RESUME_READY: {
    Icon: Send,
    colorClass: 'text-success-fg',
    bgClass: 'bg-success-bg',
    routeFn: toProfile,
  },
  // ── Profile ───────────────────────────────────────────────────────────────
  PROFILE_REMINDER: {
    Icon: UserCheck,
    colorClass: 'text-success-fg',
    bgClass: 'bg-success-bg',
    routeFn: toProfile,
  },
  // Info-tier (S3). Action → the recent-viewers surface on the dashboard.
  // In-app only by the notification matrix, so no delivery-receipt ever attaches.
  PROFILE_VIEWED: {
    Icon: Eye,
    colorClass: 'text-info-fg',
    bgClass: 'bg-info-bg',
    routeFn: () => '/dashboard#recent-views',
  },
  // Warning-tier (S3). Action → the profile Documents section (the re-upload remedy).
  // Copy (expiring vs expired) comes from the server-rendered title/body.
  PASSPORT_EXPIRY: {
    Icon: FileWarning,
    colorClass: 'text-warning-fg',
    bgClass: 'bg-warning-bg',
    routeFn: () => '/profile#documents',
  },
  // ── System (employer / subscription) ──────────────────────────────────────
  EMPLOYER_APPROVED: {
    Icon: ShieldCheck,
    colorClass: 'text-success-fg',
    bgClass: 'bg-success-bg',
  },
  EMPLOYER_REJECTED: {
    Icon: ShieldAlert,
    colorClass: 'text-error-fg',
    bgClass: 'bg-error-bg',
  },
  EMPLOYER_SUSPENDED: {
    Icon: ShieldAlert,
    colorClass: 'text-error-fg',
    bgClass: 'bg-error-bg',
  },
  SUBSCRIPTION_PURCHASED: {
    Icon: CreditCard,
    colorClass: 'text-success-fg',
    bgClass: 'bg-success-bg',
  },
  SUBSCRIPTION_EXPIRING: {
    Icon: CreditCard,
    colorClass: 'text-warning-fg',
    bgClass: 'bg-warning-bg',
  },
  SUBSCRIPTION_EXPIRED: {
    Icon: CreditCard,
    colorClass: 'text-error-fg',
    bgClass: 'bg-error-bg',
  },
  // S6b-B2: job moderation outcomes + on-behalf posting (employer-facing).
  JOB_APPROVED: {
    Icon: CheckCircle2,
    colorClass: 'text-success-fg',
    bgClass: 'bg-success-bg',
    routeFn: toJob,
  },
  JOB_REJECTED: {
    Icon: XCircle,
    colorClass: 'text-error-fg',
    bgClass: 'bg-error-bg',
    routeFn: toJob,
  },
  JOB_POSTED_ONBEHALF: {
    Icon: Briefcase,
    colorClass: 'text-info-fg',
    bgClass: 'bg-info-bg',
    routeFn: toJob,
  },
  /*
    The one ADMIN-directed type. It reaches this map because staff read their
    notifications through the same feed component everyone else does, so it
    still needs an icon and a destination.

    It routes into the admin console rather than to any candidate-facing page —
    the recipient is an approver who needs the employer queue, and the default
    `/notifications` landing would leave them to find it themselves.
  */
  /*
    The "are you still looking?" check-in. Its in-app row exists for the moment
    they DO come back — by definition the email is what reached them — so it
    routes to jobs, which is the reason to have come back at all.
  */
  CANDIDATE_INACTIVE_CHECK_IN: {
    Icon: CalendarClock,
    colorClass: 'text-warning-fg',
    bgClass: 'bg-warning-bg',
    routeFn: toJob,
  },
  VERIFICATION_CALL_REQUESTED: {
    Icon: CalendarClock,
    colorClass: 'text-accent-700',
    bgClass: 'bg-accent-50',
    routeFn: () => '/admin/employers',
  },
};

/** Fallback for any type not in the map (defensive against future enum additions). */
export const fallbackNotificationMeta: NotificationMeta = {
  Icon: Info,
  // eslint-disable-next-line no-restricted-syntax -- ICON colour, not text: WCAG 1.4.11 needs 3:1 and neutral-500 is 3.52:1.
  colorClass: 'text-neutral-500',
  bgClass: 'bg-neutral-100',
};
