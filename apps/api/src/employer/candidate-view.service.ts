import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CompanyStatus } from '@prisma/client';
import { EmployerService } from './employer.service';
import { ProfileViewService } from './profile-view.service';
import { CandidateReadService } from '../candidate/candidate-read.service';
import { StorageService } from '../core/storage/storage.service';
import { toEmployerView, CandidateEmployerViewDto, EmployerViewSource } from './mappers/candidate-employer-view.mapper';
import { toBrowseCard, BrowseCardSource, CandidateBrowseCardDto } from './mappers/candidate-browse-card.mapper';
import { BrowseQueryDto } from './dto/browse-query.dto';

/**
 * Orchestrates employer → candidate visibility:
 * - fetch via CandidateReadService (boundary — never queries candidate tables directly)
 * - map through viewer-aware mappers
 * - record profile views (fire-and-forget)
 *
 * Employer module owns the WRITE side of profile_views (this service).
 * Candidate module owns the READ side for the candidate-facing summary.
 */
@Injectable()
export class CandidateViewService {
  private readonly logger = new Logger(CandidateViewService.name);

  constructor(
    private readonly employerService: EmployerService,
    private readonly candidateReadService: CandidateReadService,
    private readonly profileViewService: ProfileViewService,
    private readonly storage: StorageService,
  ) {}

  // ── GET /employers/candidates ─────────────────────────────────────────────

  async browse(
    userId: string,
    dto: BrowseQueryDto,
  ): Promise<{ data: CandidateBrowseCardDto[]; nextCursor: string | null }> {
    await this.getApprovedCompany(userId);

    const { data: sources, nextCursor } =
      await this.candidateReadService.browseVisibleCandidates({
        category: dto.category,
        minExperienceYears: dto.minExperienceYears,
        hasForeignExperience: dto.hasForeignExperience,
        availability: dto.availability,
        q: dto.q,
        cursor: dto.cursor,
        limit: dto.limit,
      });

    // Presign photo URLs in parallel — photo keys are employer-accessible (not candidate-private)
    const photoUrls = await Promise.all(
      sources.map((s) =>
        s.photoKey ? this.storage.presignGet(s.photoKey) : Promise.resolve(null),
      ),
    );

    const data = sources.map((s, i) =>
      toBrowseCard({ ...s, photoUrl: photoUrls[i] ?? null } satisfies BrowseCardSource),
    );

    return { data, nextCursor };
  }

  // ── GET /employers/candidates/:id ─────────────────────────────────────────

  async viewCandidate(
    userId: string,
    candidateId: string,
  ): Promise<CandidateEmployerViewDto> {
    const company = await this.getApprovedCompany(userId);

    // Anti-enumeration: null for invisible, PENDING_DELETION, OR nonexistent — identical 404.
    const candidate =
      await this.candidateReadService.findVisibleCandidateForEmployerView(candidateId);
    if (!candidate) {
      throw new NotFoundException({ code: 'CANDIDATE_NOT_FOUND' });
    }

    const photoUrl = candidate.photoKey
      ? await this.storage.presignGet(candidate.photoKey)
      : null;

    const dto = toEmployerView({ ...candidate, photoUrl } satisfies EmployerViewSource);

    // Fire-and-forget: view recording never blocks or fails the GET response
    this.fireAndForgetView(company.id, company.name, candidate.id, candidate.userId);

    return dto;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async getApprovedCompany(userId: string): Promise<{ id: string; name: string }> {
    const company = await this.employerService.getCompanyForEmployerUser(userId);
    if (company.status !== CompanyStatus.APPROVED) {
      throw new ForbiddenException({ code: 'EMPLOYER_NOT_APPROVED' });
    }
    return { id: company.id, name: company.name };
  }

  private fireAndForgetView(
    companyId: string,
    companyName: string,
    candidateId: string,
    candidateUserId: string,
  ): void {
    this.profileViewService
      .recordView(companyId, companyName, candidateId, candidateUserId)
      .catch((err: unknown) => {
        this.logger.warn(
          `recordView failed (fire-and-forget swallowed): ${err instanceof Error ? err.message : String(err)}`,
        );
      });
  }
}
