import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationType } from '@prisma/client';
import { NotificationService } from './notification.service';
import {
  EMPLOYER_EVENTS,
  EmployerApprovedPayload,
  EmployerRejectedPayload,
  EmployerSuspendedPayload,
} from '../employer/employer.events';

/**
 * Passive subscriber: turns domain events into notify() calls.
 *
 * This is the "subscribers don't have to remember to call notify()" layer.
 * Feature modules can also call NotificationService.notify() directly for
 * intentional/imperative notification sends.
 *
 * Active events (exist in codebase now) are wired below.
 * Future events have stub comments naming the emitting sprint.
 */
@Injectable()
export class NotificationSubscriber {
  constructor(private readonly notificationService: NotificationService) {}

  // ── S2-B4 Employer events ───────────────────────────────────────────────────

  @OnEvent(EMPLOYER_EVENTS.APPROVED)
  async onEmployerApproved(payload: EmployerApprovedPayload): Promise<void> {
    await this.notificationService.notify(payload.userId, NotificationType.EMPLOYER_APPROVED, {
      title: 'Company Approved',
      body: `Your company "${payload.companyName}" has been approved. You can now post jobs.`,
      data: { companyId: payload.companyId },
    });
  }

  @OnEvent(EMPLOYER_EVENTS.REJECTED)
  async onEmployerRejected(payload: EmployerRejectedPayload): Promise<void> {
    await this.notificationService.notify(payload.userId, NotificationType.EMPLOYER_REJECTED, {
      title: 'Company Registration Rejected',
      body: `Your company "${payload.companyName}" registration was rejected. Reason: ${payload.reason}`,
      data: { companyId: payload.companyId, reason: payload.reason },
    });
  }

  @OnEvent(EMPLOYER_EVENTS.SUSPENDED)
  async onEmployerSuspended(payload: EmployerSuspendedPayload): Promise<void> {
    await this.notificationService.notify(payload.userId, NotificationType.EMPLOYER_SUSPENDED, {
      title: 'Company Suspended',
      body: `Your company "${payload.companyName}" has been suspended. Please contact support.`,
      data: { companyId: payload.companyId },
    });
  }

  // ── Stubs for future sprint events ─────────────────────────────────────────

  // S3 CandidateReadService — emits when an employer views a candidate profile:
  // @OnEvent('profile.viewed')
  // async onProfileViewed(payload: { candidateUserId: string }): Promise<void> {
  //   await this.notificationService.notify(
  //     payload.candidateUserId,
  //     NotificationType.PROFILE_VIEWED,
  //     { title: 'Profile Viewed', body: 'An employer viewed your profile.', data: payload },
  //   );
  // }

  // S4 ApplicationsService — emits on application status transitions:
  // @OnEvent('application.status.changed')
  // async onApplicationStatusChanged(payload: {
  //   candidateUserId: string;
  //   toStatus: ApplicationStatus;
  //   applicationId: string;
  // }): Promise<void> {
  //   const typeMap = {
  //     SHORTLISTED: NotificationType.APPLICATION_SHORTLISTED,
  //     SELECTED: NotificationType.APPLICATION_SELECTED,
  //     REJECTED: NotificationType.APPLICATION_REJECTED,
  //   };
  //   const type = typeMap[payload.toStatus];
  //   if (!type) return;
  //   await this.notificationService.notify(payload.candidateUserId, type, { ... });
  // }

  // S5 PaymentsService — emits on subscription purchase:
  // @OnEvent('payment.captured')
  // async onPaymentCaptured(payload: { companyUserId: string; planName: string }): Promise<void> { }

  // S2-B5 JobsService — emits when a job matches a candidate (cron-driven):
  // @OnEvent('job.matched')
  // async onJobMatched(payload: { candidateUserId: string; jobId: string }): Promise<void> { }
}
