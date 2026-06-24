import { Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CandidateSkill, Prisma } from '@prisma/client';
import { PrismaService } from '../core/prisma/prisma.service';
import { CompletionService } from './completion/completion.service';
import { CANDIDATE_EVENTS, CandidateChangedPayload } from './events/candidate.events';
import { CreateSkillDto } from './dto/create-skill.dto';

@Injectable()
export class SkillService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly completionService: CompletionService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Idempotent create: if the (candidateId, name) pair already exists,
   * return the existing row (200) rather than throwing 409. Simpler for the FE.
   */
  async create(candidateId: string, dto: CreateSkillDto): Promise<CandidateSkill> {
    let skill: CandidateSkill;

    try {
      skill = await this.prisma.candidateSkill.create({
        data: { candidateId, name: dto.name },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // Unique constraint on (candidateId, name) — return the existing row.
        const existing = await this.prisma.candidateSkill.findUnique({
          where: { candidateId_name: { candidateId, name: dto.name } },
        });
        if (!existing) throw err;
        return existing;
      }
      throw err;
    }

    await this.completionService.recomputeForCandidate(candidateId);
    this.eventEmitter.emit(CANDIDATE_EVENTS.SKILL_CHANGED, {
      candidateId,
    } satisfies CandidateChangedPayload);

    return skill;
  }

  async remove(candidateId: string, skillId: string): Promise<void> {
    await this.assertOwnership(candidateId, skillId);
    await this.prisma.candidateSkill.delete({ where: { id: skillId } });
    await this.completionService.recomputeForCandidate(candidateId);
    this.eventEmitter.emit(CANDIDATE_EVENTS.SKILL_CHANGED, {
      candidateId,
    } satisfies CandidateChangedPayload);
  }

  /** Returns 404 whether the row is missing OR belongs to another candidate. */
  private async assertOwnership(candidateId: string, skillId: string): Promise<void> {
    const skill = await this.prisma.candidateSkill.findUnique({
      where: { id: skillId },
      select: { candidateId: true },
    });
    if (!skill || skill.candidateId !== candidateId) {
      throw new NotFoundException({ code: 'SKILL_NOT_FOUND' });
    }
  }
}
