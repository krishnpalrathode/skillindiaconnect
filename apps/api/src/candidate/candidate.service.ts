import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { DocumentType, Prisma, UserRole, WorkExperience } from '@prisma/client';
import { PrismaService } from '../core/prisma/prisma.service';
import { CompletionService } from './completion/completion.service';
import {
  DEFAULT_MIN_COMPLETION_FOR_APPLY,
  MVP_MANDATORY_DOC_TYPES,
  SETTING_KEY_MIN_COMPLETION_PCT,
} from './completion/completion.constants';
import { compute } from './completion/completion.service';
import { CANDIDATE_EVENTS, CandidateChangedPayload } from './events/candidate.events';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import {
  CandidateProfileWithRelations,
  toSelf,
  CandidateSelfDto,
} from './mappers/candidate-self.mapper';

/**
 * Human labels for the mandatory document types, used to build the contract's
 * human-readable `missingForApply` list (see getCompletion). Kept local because
 * this is the only place the API renders doc types as user-facing prose.
 */
const DOC_TYPE_LABELS: Record<(typeof MVP_MANDATORY_DOC_TYPES)[number], string> = {
  PASSPORT: 'Passport',
  EXPERIENCE_CERT: 'Experience certificate',
  EDUCATIONAL_CERT: 'Educational certificate',
};

@Injectable()
export class CandidateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly completionService: CompletionService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ─── Profile access ────────────────────────────────────────────────────────

  async getProfileByUserId(userId: string): Promise<CandidateSelfDto> {
    const profile = await this.findOrCreateProfile(userId);
    return toSelf(profile);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<CandidateSelfDto> {
    const profile = await this.findOrCreateProfile(userId);

    if (dto.jobCategoryId !== undefined) {
      const cat = await this.prisma.jobCategory.findUnique({
        where: { id: dto.jobCategoryId },
        select: { isActive: true },
      });
      if (!cat || !cat.isActive) {
        throw new UnprocessableEntityException({ code: 'INVALID_JOB_CATEGORY' });
      }
    }

    await this.prisma.candidateProfile.update({
      where: { id: profile.id },
      data: {
        ...(dto.fullName !== undefined && { fullName: dto.fullName }),
        ...(dto.fatherName !== undefined && { fatherName: dto.fatherName }),
        ...(dto.dob !== undefined && { dob: new Date(dto.dob) }),
        ...(dto.maritalStatus !== undefined && { maritalStatus: dto.maritalStatus }),
        ...(dto.religion !== undefined && { religion: dto.religion }),
        ...(dto.languages !== undefined && { languages: dto.languages }),
        ...(dto.jobCategoryId !== undefined && { jobCategoryId: dto.jobCategoryId }),
        ...(dto.currentLocation !== undefined && { currentLocation: dto.currentLocation }),
        ...(dto.nationality !== undefined && { nationality: dto.nationality }),
        ...(dto.noticePeriod !== undefined && { noticePeriod: dto.noticePeriod }),
      },
    });

    await this.completionService.recomputeForCandidate(profile.id);

    this.eventEmitter.emit(CANDIDATE_EVENTS.PROFILE_UPDATED, {
      candidateId: profile.id,
    } satisfies CandidateChangedPayload);

    return this.getProfileByUserId(userId);
  }

  async updateSettings(userId: string, dto: UpdateSettingsDto): Promise<CandidateSelfDto> {
    const profile = await this.findOrCreateProfile(userId);

    await this.prisma.candidateProfile.update({
      where: { id: profile.id },
      data: {
        ...(dto.showPhone !== undefined && { showPhone: dto.showPhone }),
        ...(dto.showReligion !== undefined && { showReligion: dto.showReligion }),
        ...(dto.waNotifications !== undefined && { waNotifications: dto.waNotifications }),
        ...(dto.emailNotifs !== undefined && { emailNotifs: dto.emailNotifs }),
        ...(dto.profileVisible !== undefined && { profileVisible: dto.profileVisible }),
        ...(dto.isAvailable !== undefined && { isAvailable: dto.isAvailable }),
        ...(dto.salaryExpectationMin !== undefined && {
          salaryExpectationMin: dto.salaryExpectationMin,
        }),
        ...(dto.salaryExpectationMax !== undefined && {
          salaryExpectationMax: dto.salaryExpectationMax,
        }),
        ...(dto.salaryExpectationCurrency !== undefined && {
          salaryExpectationCurrency: dto.salaryExpectationCurrency,
        }),
      },
    });

    return this.getProfileByUserId(userId);
  }

  // ─── Completion endpoint payload ───────────────────────────────────────────

  async getCompletion(userId: string): Promise<{
    pct: number;
    sections: { key: string; label: string; pct: number; complete: boolean }[];
    canApply: boolean;
    missingForApply: string[];
  }> {
    const profile = await this.findOrCreateProfileWithDocs(userId);
    const mandatoryDocCount = await this.completionService.getMandatoryDocCount();
    const minPct = await this.getMinCompletionPct();

    const mandatoryDocTypesPresent = profile.documents
      .filter((d: { type: DocumentType; expiryDate: Date | null }) =>
        (MVP_MANDATORY_DOC_TYPES as readonly string[]).includes(d.type),
      )
      .map((d: { type: DocumentType; expiryDate: Date | null }) => d.type as string);

    const result = compute({
      profile: {
        photoKey: profile.photoKey,
        fullName: profile.fullName,
        fatherName: profile.fatherName,
        dob: profile.dob,
        phoneVerifiedAt: profile.phoneVerifiedAt,
        maritalStatus: profile.maritalStatus,
        languages: profile.languages,
        jobCategoryId: profile.jobCategoryId,
        currentLocation: profile.currentLocation,
        nationality: profile.nationality,
      },
      experiences: profile.experiences.map((e: WorkExperience) => ({
        type: e.type as string,
        country: e.country,
        companyName: e.companyName,
        role: e.role,
        years: e.years,
      })),
      skillCount: profile.skills.length,
      mandatoryDocTypesPresent,
      mandatoryDocCount,
    });

    // Per the OpenAPI contract, `missingForApply` is a HUMAN-READABLE list (the
    // web EligibilityPreview renders each entry verbatim, and derives the fix-link
    // target from the text via /passport|document/i). So these must be prose, not
    // machine tokens — and the doc/passport entries must contain "document" or
    // "passport" so the checklist deep-links to /profile#documents.
    const missingForApply: string[] = [];

    if (result.pct < minPct) {
      missingForApply.push(`Complete at least ${minPct}% of your profile`);
    }

    for (const docType of MVP_MANDATORY_DOC_TYPES) {
      if (!mandatoryDocTypesPresent.includes(docType)) {
        missingForApply.push(`${DOC_TYPE_LABELS[docType]} document required`);
      }
    }

    const passport = profile.documents.find(
      (d: { type: DocumentType; expiryDate: Date | null }) => d.type === 'PASSPORT',
    );
    if (!passport || (passport.expiryDate && passport.expiryDate < new Date())) {
      missingForApply.push('Valid (unexpired) passport required');
    }

    const canApply = missingForApply.length === 0;

    return { pct: result.pct, sections: result.sections, canApply, missingForApply };
  }

  // ─── candidateId lookup (for sub-services) ────────────────────────────────

  async getCandidateIdByUserId(userId: string): Promise<string> {
    const profile = await this.findOrCreateProfile(userId);
    return profile.id;
  }

  // ─── Document-changed event listener (S1-3 emits this) ───────────────────

  @OnEvent(CANDIDATE_EVENTS.DOCUMENT_CHANGED)
  async handleDocumentChanged(payload: CandidateChangedPayload): Promise<void> {
    await this.completionService.recomputeForCandidate(payload.candidateId);
  }

  // ─── Role guard (controller calls this) ──────────────────────────────────

  assertCandidateRole(role: UserRole): void {
    if (role !== UserRole.CANDIDATE) {
      throw new ForbiddenException({ code: 'FORBIDDEN_ROLE' });
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  // Concurrent first-load requests for the same brand-new user (e.g.
  // dashboard's Promise.all across /me and /me/completion) both see "no
  // profile" and race to create it. Prisma's upsert() is NOT atomic against
  // this — it still throws P2002 under true concurrency (verified directly:
  // no native ON CONFLICT here) — so the loser must catch that and re-fetch
  // the row the winner just created, instead of surfacing a 500.
  private async findOrCreateProfile(userId: string): Promise<CandidateProfileWithRelations> {
    const include = {
      experiences: { orderBy: { createdAt: 'desc' as const } },
      skills: { orderBy: { name: 'asc' as const } },
    };
    try {
      return await this.prisma.candidateProfile.upsert({
        where: { userId },
        create: { userId, fullName: '' },
        update: {},
        include,
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return this.prisma.candidateProfile.findUniqueOrThrow({ where: { userId }, include });
      }
      throw err;
    }
  }

  private async findOrCreateProfileWithDocs(userId: string) {
    const include = {
      experiences: { orderBy: { createdAt: 'desc' as const } },
      skills: { orderBy: { name: 'asc' as const } },
      documents: { select: { type: true, expiryDate: true } },
    };
    try {
      return await this.prisma.candidateProfile.upsert({
        where: { userId },
        create: { userId, fullName: '' },
        update: {},
        include,
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return this.prisma.candidateProfile.findUniqueOrThrow({ where: { userId }, include });
      }
      throw err;
    }
  }

  private async getMinCompletionPct(): Promise<number> {
    const setting = await this.prisma.setting.findUnique({
      where: { key: SETTING_KEY_MIN_COMPLETION_PCT },
    });
    if (!setting) return DEFAULT_MIN_COMPLETION_FOR_APPLY;
    const val = setting.value;
    return typeof val === 'number' && val > 0 ? val : DEFAULT_MIN_COMPLETION_FOR_APPLY;
  }

  /** Used by experience/skill controllers to resolve the candidateId. */
  async findProfileOrThrow(userId: string): Promise<{ id: string }> {
    const row = await this.prisma.candidateProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!row) throw new NotFoundException({ code: 'PROFILE_NOT_FOUND' });
    return row;
  }
}
