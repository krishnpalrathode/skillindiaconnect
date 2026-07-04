import { Injectable } from '@nestjs/common';
import { Currency, DocumentType, ExperienceType, Prisma, UserRole, UserStatus } from '@prisma/client';
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

  // ── S3-B2: Employer-context reads ────────────────────────────────────────

  /**
   * Returns a candidate's full profile for the employer viewer, or null if the
   * candidate is invisible (profileVisible=false), pending deletion, or nonexistent.
   *
   * Anti-enumeration: null is returned for ALL three cases — the caller maps this
   * to a 404 that is byte-identical for invisible vs nonexistent candidates.
   *
   * Only documents' type + expiryDate are selected — NO r2Key, NO fileName, NO URLs.
   * The employer context exposes document STATUS only (S3-0 decision 2).
   */
  async findVisibleCandidateForEmployerView(
    id: string,
  ): Promise<CandidateForEmployerView | null> {
    const profile = await this.prisma.candidateProfile.findFirst({
      where: {
        id,
        profileVisible: true,
        user: { status: { not: UserStatus.PENDING_DELETION } },
      },
      select: {
        id: true,
        userId: true,
        fullName: true,
        dob: true,
        phone: true,
        religion: true,
        languages: true,
        jobCategoryId: true,
        photoKey: true,
        currentLocation: true,
        nationality: true,
        noticePeriod: true,
        salaryExpectationMin: true,
        salaryExpectationMax: true,
        salaryExpectationCurrency: true,
        isAvailable: true,
        completionPct: true,
        showPhone: true,
        showReligion: true,
        createdAt: true,
        experiences: {
          select: {
            id: true,
            type: true,
            country: true,
            companyName: true,
            role: true,
            years: true,
            months: true,
            startDate: true,
            endDate: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        skills: {
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        },
        documents: {
          // EMPLOYER CONTEXT: type + expiryDate ONLY — no r2Key, fileName, or mimeType.
          // Document content is Pro-gated (S5); the employer sees upload status only.
          select: { type: true, expiryDate: true },
        },
      },
    });

    return profile as CandidateForEmployerView | null;
  }

  /**
   * Browse visible candidates for the employer feed.
   *
   * - Only profileVisible=true, non-PENDING_DELETION candidates appear.
   * - Filters: category (jobCategoryId), hasForeignExperience, availability, text q.
   * - minExperienceYears is applied in-memory (Prisma cannot SUM related years in WHERE).
   *   We fetch limit*5 records from DB before in-memory filtering; this works well
   *   in practice but is a known MVP simplification — pagination may return fewer than
   *   limit items when this filter is active.
   * - Stable keyset: updatedAt DESC, id DESC.
   * - Cursor encodes {updatedAt: ISO, id} as base64-JSON.
   */
  async browseVisibleCandidates(
    filters: BrowseFilter,
  ): Promise<{ data: CandidateBrowseSource[]; nextCursor: string | null }> {
    const limit = Math.min(filters.limit ?? 20, 50);

    // Decode cursor
    let cursorUpdatedAt: Date | undefined;
    let cursorId: string | undefined;
    if (filters.cursor) {
      try {
        const decoded = JSON.parse(
          Buffer.from(filters.cursor, 'base64url').toString('utf8'),
        ) as { updatedAt: string; id: string };
        cursorUpdatedAt = new Date(decoded.updatedAt);
        cursorId = decoded.id;
      } catch {
        // Invalid cursor — start from beginning
      }
    }

    const where: Prisma.CandidateProfileWhereInput = {
      profileVisible: true,
      user: { status: { not: UserStatus.PENDING_DELETION } },
      ...(filters.category && { jobCategoryId: filters.category }),
      ...(filters.availability !== undefined && { isAvailable: filters.availability }),
      ...(filters.hasForeignExperience === true && {
        experiences: { some: { type: ExperienceType.FOREIGN } },
      }),
      ...(filters.hasForeignExperience === false && {
        NOT: { experiences: { some: { type: ExperienceType.FOREIGN } } },
      }),
      ...(filters.q && {
        OR: [
          { fullName: { contains: filters.q, mode: 'insensitive' } },
          { skills: { some: { name: { contains: filters.q, mode: 'insensitive' } } } },
        ],
      }),
      // Keyset pagination: rows before the cursor position in DESC order
      ...(cursorUpdatedAt &&
        cursorId && {
          OR: [
            { updatedAt: { lt: cursorUpdatedAt } },
            { updatedAt: cursorUpdatedAt, id: { lt: cursorId } },
          ],
        }),
    };

    // When minExperienceYears is active, fetch extra rows for in-memory filter
    const fetchLimit = filters.minExperienceYears != null ? limit * 5 : limit + 1;

    const rows = await this.prisma.candidateProfile.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: fetchLimit,
      select: {
        id: true,
        fullName: true,
        photoKey: true,
        jobCategoryId: true,
        currentLocation: true,
        isAvailable: true,
        completionPct: true,
        updatedAt: true,
        experiences: {
          select: { type: true, years: true, months: true },
        },
        skills: {
          select: { name: true },
          orderBy: { name: 'asc' },
          take: 3,
        },
      },
    });

    // Enrich with derived fields
    let results: CandidateBrowseSource[] = rows.map((row) => ({
      ...row,
      totalExperienceYears:
        row.experiences.reduce((sum, e) => sum + e.years + e.months / 12, 0),
      hasForeignExperience: row.experiences.some((e) => e.type === ExperienceType.FOREIGN),
    }));

    // In-memory minExperienceYears filter
    if (filters.minExperienceYears != null) {
      const min = filters.minExperienceYears;
      results = results.filter((r) => r.totalExperienceYears >= min);
    }

    const hasMore = results.length > limit;
    const data = hasMore ? results.slice(0, limit) : results;

    let nextCursor: string | null = null;
    if (hasMore && data.length > 0) {
      const last = data[data.length - 1]!;
      nextCursor = Buffer.from(
        JSON.stringify({ updatedAt: last.updatedAt.toISOString(), id: last.id }),
      ).toString('base64url');
    }

    return { data, nextCursor };
  }
}

// ── Return-type interfaces (exported for Employer module mappers) ────────────

export interface CandidateForEmployerView {
  id: string;
  userId: string;
  fullName: string;
  dob: Date | null;
  phone: string | null;
  religion: string | null;
  languages: string[];
  jobCategoryId: string | null;
  photoKey: string | null;
  currentLocation: string | null;
  nationality: string | null;
  noticePeriod: number | null;
  salaryExpectationMin: number | null;
  salaryExpectationMax: number | null;
  salaryExpectationCurrency: Currency | null;
  isAvailable: boolean;
  completionPct: number;
  showPhone: boolean;
  showReligion: boolean;
  createdAt: Date;
  experiences: {
    id: string;
    type: ExperienceType;
    country: string;
    companyName: string;
    role: string;
    years: number;
    months: number;
    startDate: Date | null;
    endDate: Date | null;
  }[];
  skills: { id: string; name: string }[];
  documents: { type: DocumentType; expiryDate: Date | null }[];
}

export interface CandidateBrowseSource {
  id: string;
  fullName: string;
  photoKey: string | null;
  jobCategoryId: string | null;
  currentLocation: string | null;
  isAvailable: boolean;
  completionPct: number;
  updatedAt: Date;
  totalExperienceYears: number;
  hasForeignExperience: boolean;
  skills: { name: string }[];
}

export interface BrowseFilter {
  category?: string;
  minExperienceYears?: number;
  hasForeignExperience?: boolean;
  availability?: boolean;
  q?: string;
  cursor?: string;
  limit?: number;
}
