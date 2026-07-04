import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../core/prisma/prisma.service';
import { PROFILE_VIEW_EVENTS, ProfileViewedPayload } from './profile-view.events';

const DEDUP_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Records employer profile-views with rolling-24h dedup per (company, candidate).
 *
 * Dedup also gates the PROFILE_VIEWED notification — a recruiter refreshing the
 * page does not spam the candidate's notification feed.
 *
 * Concurrency note: two simultaneous first-views from the same company may both
 * pass the dedup check before either inserts, resulting in a double-insert and
 * two PROFILE_VIEWED notifications. A DB unique constraint on
 * (candidateId, companyId, trunc_day) could prevent this but requires a migration
 * and changes the "rolling" semantics to "calendar day". For MVP we accept the
 * benign race — the harm is a single extra in-app notification.
 *
 * Split ownership: Employer module WRITES profile_views (the viewer acts).
 * Candidate module READS its own rows via ProfileViewsReadService.
 */
@Injectable()
export class ProfileViewService {
  private readonly logger = new Logger(ProfileViewService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async recordView(
    companyId: string,
    companyName: string,
    candidateId: string,
    candidateUserId: string,
  ): Promise<void> {
    const windowStart = new Date(Date.now() - DEDUP_WINDOW_MS);

    const existing = await this.prisma.profileView.findFirst({
      where: {
        candidateId,
        companyId,
        viewedAt: { gt: windowStart },
      },
      select: { id: true },
    });

    if (existing) {
      // Within the dedup window — no new row, no notification
      return;
    }

    await this.prisma.profileView.create({
      data: { candidateId, companyId },
    });

    const payload: ProfileViewedPayload = {
      candidateId,
      candidateUserId,
      companyId,
      companyName,
    };
    this.eventEmitter.emit(PROFILE_VIEW_EVENTS.VIEWED, payload);
    this.logger.log(`profile.viewed: candidate=${candidateId} company=${companyId}`);
  }
}
