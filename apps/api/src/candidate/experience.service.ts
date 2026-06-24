import { Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WorkExperience } from '@prisma/client';
import { PrismaService } from '../core/prisma/prisma.service';
import { CompletionService } from './completion/completion.service';
import { CANDIDATE_EVENTS, CandidateChangedPayload } from './events/candidate.events';
import { CreateExperienceDto } from './dto/create-experience.dto';
import { UpdateExperienceDto } from './dto/update-experience.dto';

@Injectable()
export class ExperienceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly completionService: CompletionService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(candidateId: string, dto: CreateExperienceDto): Promise<WorkExperience> {
    const experience = await this.prisma.workExperience.create({
      data: {
        candidateId,
        type: dto.type,
        country: dto.country,
        companyName: dto.companyName,
        role: dto.role,
        years: dto.years,
        months: dto.months ?? 0,
        startDate: dto.startDate ? new Date(dto.startDate) : null,
        endDate: dto.endDate ? new Date(dto.endDate) : null,
      },
    });

    await this.completionService.recomputeForCandidate(candidateId);
    this.eventEmitter.emit(CANDIDATE_EVENTS.EXPERIENCE_CHANGED, {
      candidateId,
    } satisfies CandidateChangedPayload);

    return experience;
  }

  async update(
    candidateId: string,
    experienceId: string,
    dto: UpdateExperienceDto,
  ): Promise<WorkExperience> {
    await this.assertOwnership(candidateId, experienceId);

    const experience = await this.prisma.workExperience.update({
      where: { id: experienceId },
      data: {
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.country !== undefined && { country: dto.country }),
        ...(dto.companyName !== undefined && { companyName: dto.companyName }),
        ...(dto.role !== undefined && { role: dto.role }),
        ...(dto.years !== undefined && { years: dto.years }),
        ...(dto.months !== undefined && { months: dto.months }),
        ...(dto.startDate !== undefined && {
          startDate: dto.startDate ? new Date(dto.startDate) : null,
        }),
        ...(dto.endDate !== undefined && { endDate: dto.endDate ? new Date(dto.endDate) : null }),
      },
    });

    await this.completionService.recomputeForCandidate(candidateId);
    this.eventEmitter.emit(CANDIDATE_EVENTS.EXPERIENCE_CHANGED, {
      candidateId,
    } satisfies CandidateChangedPayload);

    return experience;
  }

  async remove(candidateId: string, experienceId: string): Promise<void> {
    await this.assertOwnership(candidateId, experienceId);
    await this.prisma.workExperience.delete({ where: { id: experienceId } });
    await this.completionService.recomputeForCandidate(candidateId);
    this.eventEmitter.emit(CANDIDATE_EVENTS.EXPERIENCE_CHANGED, {
      candidateId,
    } satisfies CandidateChangedPayload);
  }

  /** Returns 404 whether the row is missing OR belongs to another candidate. */
  private async assertOwnership(candidateId: string, experienceId: string): Promise<void> {
    const exp = await this.prisma.workExperience.findUnique({
      where: { id: experienceId },
      select: { candidateId: true },
    });
    if (!exp || exp.candidateId !== candidateId) {
      throw new NotFoundException({ code: 'EXPERIENCE_NOT_FOUND' });
    }
  }
}
