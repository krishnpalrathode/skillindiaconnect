import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job as BullJob } from 'bullmq';
import { CompanyStatus, NotificationType, UserStatus } from '@prisma/client';
import { PrismaService } from '../core/prisma/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import { WA_TEMPLATE_VARS_KEY } from '../notifications/notification.types';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';
import { RESPONSIVE_WORKER_OPTS } from '../queue/worker-tuning';

export interface InterestNotifyJobData {
  companyId: string;
  candidateId: string;
}

export interface InterestNotifyResult {
  sent: boolean;
  reason?:
    | 'no-interest-row'
    | 'already-notified'
    | 'company-not-approved'
    | 'candidate-unavailable';
}

@Injectable()
// RESPONSIVE tier: an employer clicked "notify" and is watching the result.
@Processor(QUEUE_NAMES.INTEREST_NOTIFY, RESPONSIVE_WORKER_OPTS)
export class InterestNotifyProcessor extends WorkerHost {
  private readonly logger = new Logger(InterestNotifyProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {
    super();
  }

  async process(job: BullJob<InterestNotifyJobData>): Promise<InterestNotifyResult> {
    if (job.name !== JOB_NAMES.SEND_INTEREST_NOTICE) {
      this.logger.warn(`Unexpected job name "${job.name}" — skipping`);
      return { sent: false };
    }

    const { companyId, candidateId } = job.data;

    const interest = await this.prisma.candidateInterest.findUnique({
      where: { companyId_candidateId: { companyId, candidateId } },
      select: {
        notifiedAt: true,
        company: { select: { name: true, status: true } },
        candidate: {
          select: {
            userId: true,
            fullName: true,
            profileVisible: true,
            user: { select: { status: true } },
          },
        },
      },
    });

    // Un-marked between enqueue and here — the employer withdrew, so say nothing.
    if (!interest) return { sent: false, reason: 'no-interest-row' };

    // Re-checked HERE, not only at enqueue: the enqueue filter and this read are
    // separated by queue latency, and BullMQ's jobId dedupe only holds while the
    // job exists in Redis. This DB read is the real once-per-employer guarantee.
    if (interest.notifiedAt !== null) return { sent: false, reason: 'already-notified' };

    // An employer suspended after queuing must not still reach the candidate.
    if (interest.company.status !== CompanyStatus.APPROVED) {
      return { sent: false, reason: 'company-not-approved' };
    }

    // Hidden or non-ACTIVE candidates are unreachable, same rule as browse.
    if (
      !interest.candidate.profileVisible ||
      interest.candidate.user.status !== UserStatus.ACTIVE
    ) {
      return { sent: false, reason: 'candidate-unavailable' };
    }

    const companyName = interest.company.name;
    const firstName =
      interest.candidate.fullName.trim().split(/\s+/)[0] || interest.candidate.fullName;

    await this.notificationService.notify(
      interest.candidate.userId,
      NotificationType.EMPLOYER_INTERESTED,
      {
        title: 'An employer is interested in you',
        body: `${companyName} is interested in your profile. Open the app to see their jobs and respond.`,
        data: {
          companyId,
          companyName,
          // Ordered to the template's {{1}}..{{2}} — see META_TEMPLATES.
          [WA_TEMPLATE_VARS_KEY]: [firstName, companyName],
        },
      },
    );

    await this.prisma.candidateInterest.update({
      where: { companyId_candidateId: { companyId, candidateId } },
      data: { notifiedAt: new Date() },
    });

    this.logger.log(`interest-notice sent company=${companyId} candidate=${candidateId}`);
    return { sent: true };
  }
}
