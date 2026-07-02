/**
 * SavedJobsService — candidate save / unsave for public job listings.
 *
 * Ownership note: saved_jobs table is owned by this module (jobs-search / B6),
 * per the comment in jobs.module.ts. The save/unsave endpoints are the ONLY
 * authenticated, mutating endpoints in this otherwise-public module.
 *
 * candidateId in saved_jobs refers to CandidateProfile.id (not User.id).
 * We do a lightweight lookup of the profile id here to map from the JWT userId.
 */
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { JobStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../core/prisma/prisma.service';

@Injectable()
export class SavedJobsService {
  constructor(private readonly prisma: PrismaService) {}

  async save(userId: string, role: UserRole, jobId: string): Promise<void> {
    if (role !== UserRole.CANDIDATE) {
      throw new ForbiddenException({ code: 'CANDIDATE_ONLY' });
    }

    const [job, profile] = await Promise.all([
      this.prisma.job.findFirst({
        where: { id: jobId, status: JobStatus.ACTIVE },
        select: { id: true },
      }),
      this.prisma.candidateProfile.findUnique({
        where: { userId },
        select: { id: true },
      }),
    ]);

    if (!job) throw new NotFoundException({ code: 'JOB_NOT_FOUND' });
    if (!profile) throw new NotFoundException({ code: 'CANDIDATE_NOT_FOUND' });

    await this.prisma.savedJob.upsert({
      where: { candidateId_jobId: { candidateId: profile.id, jobId } },
      create: { candidateId: profile.id, jobId },
      update: {},
    });
  }

  async unsave(userId: string, role: UserRole, jobId: string): Promise<void> {
    if (role !== UserRole.CANDIDATE) {
      throw new ForbiddenException({ code: 'CANDIDATE_ONLY' });
    }

    const profile = await this.prisma.candidateProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!profile) return; // Nothing to unsave if no profile

    await this.prisma.savedJob.deleteMany({
      where: { candidateId: profile.id, jobId },
    });
  }
}
