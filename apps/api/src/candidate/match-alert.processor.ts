import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job as BullJob } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { ExperienceType, NotificationType, UserStatus } from '@prisma/client';
import { PrismaService } from '../core/prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import { WA_TEMPLATE_VARS_KEY } from '../notifications/notification.types';
import { JobsMatchReadService, type JobForMatching } from '../jobs/jobs-match-read.service';
import { MatchService } from '../applications/match/match.service';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';
import { RESPONSIVE_WORKER_OPTS } from '../queue/worker-tuning';
import { CompletionService } from './completion/completion.service';
import { MATCH_ALERT_JOB_COUNT } from './completion/completion.constants';

export interface MatchAlertJobData {
  candidateId: string;
}

/** Outcome of one alert attempt — returned for the job result and the logs. */
export interface MatchAlertResult {
  sent: boolean;
  reason?: 'already-sent' | 'below-threshold' | 'no-profile' | 'inactive-user' | 'no-matches';
  jobCount?: number;
}

/** A scored job, ready to render into the alert. */
interface ScoredJob {
  job: JobForMatching;
  score: number;
}

@Injectable()
// RESPONSIVE tier: this is user-triggered (a profile save crossed the
// threshold), not a nightly sweep — the candidate should hear back promptly.
@Processor(QUEUE_NAMES.MATCH_ALERT, RESPONSIVE_WORKER_OPTS)
export class MatchAlertProcessor extends WorkerHost {
  private readonly logger = new Logger(MatchAlertProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly jobsRead: JobsMatchReadService,
    private readonly matchService: MatchService,
    private readonly completionService: CompletionService,
    private readonly config: ConfigService,
  ) {
    super();
  }

  async process(job: BullJob<MatchAlertJobData>): Promise<MatchAlertResult> {
    if (job.name !== JOB_NAMES.SEND_MATCH_ALERT) {
      this.logger.warn(`Unexpected job name "${job.name}" — skipping`);
      return { sent: false };
    }

    const { candidateId } = job.data;

    const profile = await this.prisma.candidateProfile.findUnique({
      where: { id: candidateId },
      select: {
        id: true,
        userId: true,
        fullName: true,
        completionPct: true,
        matchAlertSentAt: true,
        jobCategoryId: true,
        experiences: { select: { type: true, years: true, months: true } },
        documents: { select: { type: true } },
        jobCategory: { select: { slug: true } },
        user: { select: { status: true } },
      },
    });

    if (!profile) return { sent: false, reason: 'no-profile' };

    // Re-check the guard HERE, not just at enqueue: the enqueue-side check and
    // this one are separated by queue latency, and a deterministic jobId only
    // dedupes while the job still exists in Redis. This DB read is the real
    // fire-once guarantee (same shape as `selectedNotifiedAt`).
    if (profile.matchAlertSentAt !== null) return { sent: false, reason: 'already-sent' };

    // A suspended or pending-deletion candidate must not be messaged.
    if (profile.user.status !== UserStatus.ACTIVE) {
      return { sent: false, reason: 'inactive-user' };
    }

    // Re-read the threshold rather than trusting the enqueue-time decision: an
    // admin may have raised it while this job sat in the queue.
    const threshold = await this.completionService.getMatchAlertMinPct();
    if (profile.completionPct < threshold) return { sent: false, reason: 'below-threshold' };

    const top = await this.topMatches(profile);
    if (top.length === 0) {
      // Deliberately does NOT set the guard: there is nothing to tell them yet,
      // and when jobs in their trade do appear, the next profile recompute
      // should still be able to alert them. The cost is a cheap no-op job.
      this.logger.log(`match-alert: no matching jobs for candidate ${candidateId} — not sending`);
      return { sent: false, reason: 'no-matches' };
    }

    await this.send(profile.userId, profile.fullName, top, profile.jobCategory?.slug ?? null);

    await this.prisma.candidateProfile.update({
      where: { id: candidateId },
      data: { matchAlertSentAt: new Date() },
    });

    this.logger.log(`match-alert sent to candidate ${candidateId} (${top.length} jobs)`);
    return { sent: true, jobCount: top.length };
  }

  /**
   * Score every ACTIVE job in the candidate's trade and return the best N.
   *
   * Reuses the SAME pure engine that scores an application at apply time, so the
   * number a candidate sees in this alert cannot drift from the one an employer
   * sees on their application. Note this score is NOT persisted — apply-time
   * scoring still snapshots its own `matchBreakdown`, which stays the immutable
   * record.
   */
  private async topMatches(profile: {
    jobCategoryId: string | null;
    experiences: { type: ExperienceType; years: number; months: number }[];
    documents: { type: string }[];
  }): Promise<ScoredJob[]> {
    const jobs = await this.jobsRead.getActiveJobsForMatching(profile.jobCategoryId);
    if (jobs.length === 0) return [];

    const totalExperienceYears = profile.experiences.reduce(
      (sum, e) => sum + e.years + e.months / 12,
      0,
    );
    const hasForeignExperience = profile.experiences.some(
      (e) => e.type === ExperienceType.FOREIGN,
    );
    const docsRequiredCount = await this.completionService.getMandatoryDocCount();
    const docsPresentCount = profile.documents.length;

    const scored: ScoredJob[] = jobs.map((job) => ({
      job,
      score: this.matchService.compute({
        candidateCategoryId: profile.jobCategoryId,
        totalExperienceYears,
        hasForeignExperience,
        job: {
          categoryId: job.categoryId,
          market: job.market,
          experienceRequiredYears: job.experienceRequiredYears,
        },
        docsPresentCount,
        docsRequiredCount,
      }).score,
    }));

    // `id` breaks ties so the chosen three are stable across runs rather than
    // depending on the order Postgres happened to return.
    scored.sort((a, b) => b.score - a.score || a.job.id.localeCompare(b.job.id));
    return scored.slice(0, MATCH_ALERT_JOB_COUNT);
  }

  /**
   * Raise the notification.
   *
   * `templateVars` is supplied here even though NEW_JOB_MATCH is currently
   * `whatsapp: false` (notification.types.ts explains why the RAISING module
   * owns them). That is on purpose: once the Meta template is approved, turning
   * WhatsApp on is a one-line matrix change with no work needed at this call
   * site — which is exactly the trap that guard was written to catch.
   */
  private async send(
    userId: string,
    fullName: string,
    top: ScoredJob[],
    categorySlug: string | null,
  ): Promise<void> {
    const link = this.matchesLink(categorySlug);
    const summary = top.map((s) => `${s.job.title} — ${s.job.location}`).join(', ');
    const firstName = fullName.trim().split(/\s+/)[0] || fullName;

    await this.notificationService.notify(userId, NotificationType.NEW_JOB_MATCH, {
      title: `${top.length} jobs match your profile`,
      body: `Your profile is ready. Top matches: ${summary}. Tap to see all matching jobs.`,
      data: {
        link,
        jobIds: top.map((s) => s.job.id),
        // Ordered to the template's {{1}}..{{3}} — see META_TEMPLATES.
        [WA_TEMPLATE_VARS_KEY]: [firstName, summary, link],
      },
    });
  }

  /**
   * Deep link to the candidate's matching jobs.
   *
   * Points at the SEARCH page filtered to their trade rather than a bespoke
   * "your matches" route: the filtered list is the same set this alert scored,
   * it already paginates, and it stays correct as jobs come and go — a frozen
   * list of three ids would rot the moment one is filled.
   */
  private matchesLink(categorySlug: string | null): string {
    const base = this.config.get<string>('WEB_APP_URL') ?? '';
    const path = '/jobs';
    return categorySlug ? `${base}${path}?category=${encodeURIComponent(categorySlug)}` : `${base}${path}`;
  }
}
