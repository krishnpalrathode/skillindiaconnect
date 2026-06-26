import { ConflictException, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { UserStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { PrismaService } from '../core/prisma/prisma.service';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';

const DELETION_GRACE_DAYS = 30;

@Injectable()
export class AccountService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NAMES.ACCOUNT_PURGE) private readonly purgeQueue: Queue,
  ) {}

  /**
   * Transition the user to PENDING_DELETION, schedule deletionDueAt (+30 days),
   * and enqueue a deterministic-jobId purge job.
   *
   * The purge WORKER (R2 deletion, application tombstone, message-PII scrub per
   * the DPDP checklist) is a separate unit — this method only sets state and
   * enqueues; no purge side-effects occur here.
   */
  async requestDeletion(userId: string): Promise<{ deletionDueAt: Date }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.status === UserStatus.PENDING_DELETION) {
      throw new ConflictException({ code: 'DELETION_ALREADY_REQUESTED' });
    }
    const deletionDueAt = new Date(Date.now() + DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000);
    await this.prisma.user.update({
      where: { id: userId },
      data: { status: UserStatus.PENDING_DELETION, deletionDueAt },
    });
    // Deterministic jobId prevents duplicate jobs on repeated requests.
    // BullMQ 5.x forbids ':' in custom jobIds — use '-' as separator.
    await this.purgeQueue.add(JOB_NAMES.PURGE_CANDIDATE, { userId }, { jobId: `purge-${userId}` });
    return { deletionDueAt };
  }
}
