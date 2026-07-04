import { Injectable } from '@nestjs/common';
import { PrismaService } from '../core/prisma/prisma.service';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const RECENT_VIEW_LIMIT = 10;

export interface ProfileViewsSummary {
  total: number;
  last30Days: number;
  recent: { companyName: string; viewedAt: string }[];
}

/**
 * Candidate-facing read service for profile-view analytics.
 *
 * Split ownership of profile_views:
 * - WRITES: Employer module (ProfileViewService) — the viewer records the view.
 * - READS:  Candidate module (this service) — the subject reads their own view stats.
 *
 * Company name is public info; no contact data is exposed.
 */
@Injectable()
export class ProfileViewsReadService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(candidateId: string): Promise<ProfileViewsSummary> {
    const thirtyDaysAgo = new Date(Date.now() - THIRTY_DAYS_MS);

    const [total, last30Days, recent] = await Promise.all([
      this.prisma.profileView.count({ where: { candidateId } }),
      this.prisma.profileView.count({
        where: { candidateId, viewedAt: { gte: thirtyDaysAgo } },
      }),
      this.prisma.profileView.findMany({
        where: { candidateId },
        orderBy: { viewedAt: 'desc' },
        take: RECENT_VIEW_LIMIT,
        include: { company: { select: { name: true } } },
      }),
    ]);

    return {
      total,
      last30Days,
      recent: recent.map((v) => ({
        companyName: v.company.name,
        viewedAt: v.viewedAt.toISOString(),
      })),
    };
  }
}
