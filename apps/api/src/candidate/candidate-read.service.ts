import { Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../core/prisma/prisma.service';

/**
 * Narrow read-only API for other modules that need candidate data without
 * owning the candidate tables. Export from CandidateModule so callers inject
 * this service rather than querying candidate_profiles directly.
 *
 * S1-1's OTP login will swap its cross-table read for this method in a
 * separate PR (keeps the Auth diff isolated per CODEOWNERS rules).
 */
@Injectable()
export class CandidateReadService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns the userId + candidateId for a CANDIDATE whose phone is verified,
   * or null if no such candidate exists (unverified phone, employer, or unknown).
   */
  async findCandidateUserByVerifiedPhone(
    phone: string,
  ): Promise<{ userId: string; candidateId: string } | null> {
    const profile = await this.prisma.candidateProfile.findFirst({
      where: {
        phone,
        phoneVerifiedAt: { not: null },
        user: { role: UserRole.CANDIDATE },
      },
      select: { id: true, userId: true },
    });

    if (!profile) return null;
    return { userId: profile.userId, candidateId: profile.id };
  }
}
