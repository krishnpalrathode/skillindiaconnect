import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../core/prisma/prisma.service';
import { StorageService } from '../core/storage/storage.service';
import { CandidateReadService } from '../candidate/candidate-read.service';
import { EmployerService } from './employer.service';
import { QUEUE_NAMES, JOB_NAMES } from '../queue/queue.constants';
import { pageMeta, resolvePaging, type Paginated } from '../core/pagination';
import { toBrowseCard, type CandidateBrowseCardDto } from './mappers/candidate-browse-card.mapper';
import type { ListInterestDto } from './dto/list-interest.dto';

/** An interested-candidate row: the same public card, plus the outreach state. */
export interface InterestedCandidateDto extends CandidateBrowseCardDto {
  interestedAt: string;
  notifiedAt: string | null;
}

/**
 * Employer → candidate interest ("shortlist"), and the outreach it enables.
 *
 * Deliberately NOT part of CandidateViewService: that one is the read/privacy
 * seam for browsing, this one WRITES employer intent and triggers a paid
 * message. Keeping them apart means the privacy mapper has exactly one owner.
 */
@Injectable()
export class CandidateInterestService {
  private readonly logger = new Logger(CandidateInterestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly employerService: EmployerService,
    private readonly candidateRead: CandidateReadService,
    private readonly storage: StorageService,
    @InjectQueue(QUEUE_NAMES.INTEREST_NOTIFY) private readonly notifyQueue: Queue,
  ) {}

  /**
   * Mark interest. Idempotent — the (companyId, candidateId) unique makes a
   * double-tap a no-op rather than a second row, which is also what keeps
   * `notifiedAt` a meaningful once-per-employer guard.
   *
   * Marking does NOT notify. The employer decides when to reach out (and each
   * send costs a paid WhatsApp conversation), so the two are separate actions.
   */
  async markInterest(userId: string, candidateId: string): Promise<{ interestedAt: string }> {
    const company = await this.employerService.getCompanyForEmployerUser(userId);
    await this.assertVisibleCandidate(candidateId);

    const row = await this.prisma.candidateInterest.upsert({
      where: { companyId_candidateId: { companyId: company.id, candidateId } },
      create: { companyId: company.id, candidateId },
      // Re-marking must NOT reset notifiedAt — that would let an employer
      // un-mark and re-mark to message the same candidate repeatedly.
      update: {},
    });

    return { interestedAt: row.createdAt.toISOString() };
  }

  /**
   * Un-mark. The row is deleted, which also drops `notifiedAt` — see
   * markInterest: re-marking creates a fresh row whose guard is null again.
   *
   * That is accepted deliberately rather than overlooked: an employer who
   * un-marks has withdrawn interest, and a later genuine re-mark is a new
   * outreach. The abuse ceiling is the per-employer rate limit on notify, not
   * this row.
   */
  async removeInterest(userId: string, candidateId: string): Promise<void> {
    const company = await this.employerService.getCompanyForEmployerUser(userId);
    await this.prisma.candidateInterest.deleteMany({
      where: { companyId: company.id, candidateId },
    });
  }

  /** The employer's interested list, newest first. */
  async list(userId: string, dto: ListInterestDto): Promise<Paginated<InterestedCandidateDto>> {
    const company = await this.employerService.getCompanyForEmployerUser(userId);
    const { page, pageSize, skip, take } = resolvePaging(dto.page, dto.pageSize, 50);

    const where = {
      companyId: company.id,
      ...(dto.notified === true ? { notifiedAt: { not: null } } : {}),
      ...(dto.notified === false ? { notifiedAt: null } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.candidateInterest.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.prisma.candidateInterest.count({ where }),
    ]);

    if (rows.length === 0) return { data: [], meta: pageMeta(page, pageSize, total) };

    // Cards come from the SAME browse mapper the list view uses, so a candidate
    // who has since hidden their profile cannot leak extra fields here.
    const sources = await this.candidateRead.getBrowseCardsByIds(rows.map((r) => r.candidateId));

    const data: InterestedCandidateDto[] = [];
    for (const row of rows) {
      const src = sources.get(row.candidateId);
      // A candidate who went invisible or was purged simply drops out of the
      // list rather than rendering a hole.
      if (!src) continue;
      const photoUrl = src.photoKey ? await this.storage.presignGet(src.photoKey) : null;
      data.push({
        ...toBrowseCard({ ...src, photoUrl }),
        interestedAt: row.createdAt.toISOString(),
        notifiedAt: row.notifiedAt?.toISOString() ?? null,
      });
    }

    return { data, meta: pageMeta(page, pageSize, total) };
  }

  /**
   * Queue the outreach for the given candidates.
   *
   * The API only ENQUEUES (worker-and-external-sends.md) — the WhatsApp/email
   * send happens in the worker. Candidates already notified by this company are
   * filtered out here so the employer gets an honest count back rather than
   * discovering silently-skipped sends later.
   */
  async notify(
    userId: string,
    candidateIds: string[],
  ): Promise<{ queued: number; skipped: number }> {
    const company = await this.employerService.getCompanyForEmployerUser(userId);

    const rows = await this.prisma.candidateInterest.findMany({
      where: { companyId: company.id, candidateId: { in: candidateIds }, notifiedAt: null },
      select: { candidateId: true },
    });

    for (const row of rows) {
      await this.notifyQueue.add(
        JOB_NAMES.SEND_INTEREST_NOTICE,
        { companyId: company.id, candidateId: row.candidateId },
        // Hyphen, not colon — BullMQ rejects ':' in a custom jobId.
        { jobId: `interest-${company.id}-${row.candidateId}` },
      );
    }

    this.logger.log(
      `interest-notify queued=${rows.length} skipped=${candidateIds.length - rows.length} company=${company.id}`,
    );
    return { queued: rows.length, skipped: candidateIds.length - rows.length };
  }

  /**
   * This company's shortlist state for one candidate, for the detail view.
   *
   * Returns booleans rather than the row: the caller renders a toggle and a
   * "already contacted" hint, and has no business with the timestamps.
   */
  async getInterestState(
    companyId: string,
    candidateId: string,
  ): Promise<{ isInterested: boolean; interestNotified: boolean }> {
    const row = await this.prisma.candidateInterest.findUnique({
      where: { companyId_candidateId: { companyId, candidateId } },
      select: { notifiedAt: true },
    });
    return { isInterested: row !== null, interestNotified: row?.notifiedAt != null };
  }

  /**
   * Marking interest in a candidate the employer could not have seen would be an
   * enumeration oracle — the same reason viewCandidate 404s uniformly.
   */
  private async assertVisibleCandidate(candidateId: string): Promise<void> {
    const candidate = await this.candidateRead.findVisibleCandidateForEmployerView(candidateId);
    if (!candidate) throw new NotFoundException({ code: 'CANDIDATE_NOT_FOUND' });
  }
}
