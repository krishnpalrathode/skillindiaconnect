import { Injectable } from '@nestjs/common';
import { NotificationService } from './notification.service';

// Stub imports — uncomment when the corresponding sprint lands:
// import { OnEvent } from '@nestjs/event-emitter';
// import { NotificationType } from '@prisma/client';

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

  // ── Stubs for future sprint events ─────────────────────────────────────────
  // Uncomment + implement when the emitting module lands.
  // Each stub names the sprint that will emit the event.

  // S2-B4 EmployerService — emits when admin approves/rejects/suspends a company:
  // @OnEvent('employer.approved')
  // async onEmployerApproved(payload: { userId: string; companyName: string }): Promise<void> {
  //   await this.notificationService.notify(payload.userId, NotificationType.EMPLOYER_APPROVED, {
  //     title: 'Company Approved',
  //     body: `${payload.companyName} has been approved.`,
  //     data: payload,
  //   });
  // }

  // @OnEvent('employer.rejected')
  // async onEmployerRejected(payload: { userId: string; reason: string }): Promise<void> { }

  // @OnEvent('employer.suspended')
  // async onEmployerSuspended(payload: { userId: string }): Promise<void> { }

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
