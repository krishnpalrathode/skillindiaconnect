import { Injectable } from '@nestjs/common';
import { JobMarket, JobStatus } from '@prisma/client';
import { PrismaService } from '../core/prisma/prisma.service';

/**
 * ACTIVE job as the match-alert engine sees it: the scoring inputs plus the
 * display fields the alert renders. No employer PII, no internal fields.
 */
export interface JobForMatching {
  id: string;
  title: string;
  market: JobMarket;
  categoryId: string;
  experienceRequiredYears: number | null;
  location: string;
  companyName: string;
}

/**
 * Jobs-module read seam for the candidate match alert.
 *
 * A SEPARATE service from JobsService on purpose. The Candidate module must not
 * query the jobs table itself (module-boundaries.md Rule 4), but the consumer
 * here is the WORKER process — and JobsService pulls in EmployerService,
 * SettingsService, PublishGuardService and ApplicationsAggregateService. Making
 * the worker construct that graph to run one SELECT would drag half the API's
 * wiring into a process that must stay small. This depends on PrismaService and
 * nothing else, so the worker can provide it directly — the same precedent as
 * JobLifecycleService in JobsWorkerModule.
 */
@Injectable()
export class JobsMatchReadService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * ACTIVE jobs to score a candidate against, newest first.
   *
   * `categoryId` narrows at the DB rather than scoring the whole corpus: a
   * candidate is only ever matched within their own trade, so scoring across
   * categories burns work to produce zeroes. When the candidate has no category
   * we scan unfiltered — reaching the completion threshold without one is rare,
   * and returning nothing would be a silent dead end.
   *
   * `limit` bounds the scan because scoring happens in memory. It is deliberately
   * not the full table: the alert only ever shows the top few.
   */
  async getActiveJobsForMatching(
    categoryId: string | null,
    limit = 200,
  ): Promise<JobForMatching[]> {
    const rows = await this.prisma.job.findMany({
      where: {
        status: JobStatus.ACTIVE,
        ...(categoryId ? { categoryId } : {}),
      },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select: {
        id: true,
        title: true,
        market: true,
        categoryId: true,
        experienceRequiredYears: true,
        location: true,
        company: { select: { name: true } },
      },
    });

    return rows.map((j) => ({
      id: j.id,
      title: j.title,
      market: j.market,
      categoryId: j.categoryId,
      experienceRequiredYears: j.experienceRequiredYears,
      location: j.location,
      companyName: j.company.name,
    }));
  }
}
