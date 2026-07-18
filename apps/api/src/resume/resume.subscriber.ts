import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationType } from '@prisma/client';
import { CandidateReadService } from '../candidate/candidate-read.service';
import { NotificationService } from '../notifications/notification.service';
import { RESUME_EVENTS, ResumeGeneratedPayload } from './resume.events';

/**
 * "Your resume is ready" (S7-B2).
 *
 * ⚠️ THIS LIVES IN THE WORKER PROCESS, deliberately. EventEmitter2 is
 * per-process: `resume.generated` is emitted by the render processor, which
 * only ever runs in the worker, so an API-side subscriber would never fire —
 * a class of silently-dead listener this codebase has already been bitten by.
 * ResumeWorkerModule registers it next to the processor that emits it.
 *
 * RESUME_READY is IN-APP ONLY (matrix). The candidate polling the screen sees
 * the flip immediately; this row is for the one who navigated away and comes
 * back — so the render is never a thing that quietly happened to no one.
 */
@Injectable()
export class ResumeSubscriber {
  private readonly logger = new Logger(ResumeSubscriber.name);

  constructor(
    private readonly candidateRead: CandidateReadService,
    private readonly notifications: NotificationService,
  ) {}

  @OnEvent(RESUME_EVENTS.GENERATED)
  async onResumeGenerated(payload: ResumeGeneratedPayload): Promise<void> {
    try {
      const userId = await this.candidateRead.getUserIdForCandidate(payload.candidateId);
      if (!userId) return; // purged mid-render — nobody left to notify

      await this.notifications.notify(userId, NotificationType.RESUME_READY, {
        title: 'Your resume is ready',
        body: 'Your resume PDF has been generated and is ready to download.',
        data: { generationId: payload.generationId },
      });
    } catch (err) {
      // A notification failure must not fail the render that already succeeded.
      this.logger.error(
        `RESUME_READY notification failed for generation ${payload.generationId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
