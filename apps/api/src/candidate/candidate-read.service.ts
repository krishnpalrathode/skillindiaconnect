import { Injectable } from '@nestjs/common';
import { Currency, DocumentType, ExperienceType, Prisma, UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '../core/prisma/prisma.service';
import { resolvePaging } from '../core/pagination';

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

  // ── S4-B1: Apply-input read ──────────────────────────────────────────────

  /**
   * Narrow read for the apply gate + match engine (S4-B1). Returns everything the
   * Applications module needs to gate and score an application — and NOTHING more.
   * Keyed by the applicant's userId (a candidate applies as themselves).
   *
   * - `completionPct` is the STORED value (the single source the ring shows) — the
   *   gate uses it as-is; it is never recomputed here.
   * - `totalExperienceYears` sums years + months/12 (same basis as browse).
   * - `documents` carries type + expiryDate ONLY (no r2Key/URLs) — enough for the
   *   mandatory-docs and passport-expiry gates.
   *
   * Returns null when the userId has no candidate profile.
   */
  async getApplyInputs(userId: string): Promise<CandidateApplyInputs | null> {
    const profile = await this.prisma.candidateProfile.findUnique({
      where: { userId },
      select: {
        id: true,
        completionPct: true,
        jobCategoryId: true,
        experiences: { select: { type: true, years: true, months: true } },
        documents: { select: { type: true, expiryDate: true } },
      },
    });

    if (!profile) return null;

    return {
      candidateId: profile.id,
      completionPct: profile.completionPct,
      categoryId: profile.jobCategoryId,
      totalExperienceYears: profile.experiences.reduce(
        (sum, e) => sum + e.years + e.months / 12,
        0,
      ),
      hasForeignExperience: profile.experiences.some(
        (e) => e.type === ExperienceType.FOREIGN,
      ),
      documents: profile.documents,
    };
  }

  /**
   * Resolve the User id that owns a candidate profile (S4-B2). Applications uses
   * this to address status-change notifications to the candidate WITHOUT querying
   * candidate_profiles directly. Returns null if the candidate no longer exists
   * (e.g. tombstoned) — the caller then skips the notification.
   */
  async getUserIdForCandidate(candidateId: string): Promise<string | null> {
    const profile = await this.prisma.candidateProfile.findUnique({
      where: { id: candidateId },
      select: { userId: true },
    });
    return profile?.userId ?? null;
  }

  /**
   * S6b-B2 (manual WhatsApp resend): the candidate's notification target —
   * owning userId plus WhatsApp capability, so the caller can report HONESTLY
   * whether a WhatsApp will be attempted or the S2-B3 fallback (email) will
   * run. Returns null for a nonexistent/tombstoned candidate.
   */
  async getNotificationTarget(
    candidateId: string,
  ): Promise<{ userId: string; whatsappCapable: boolean } | null> {
    const profile = await this.prisma.candidateProfile.findUnique({
      where: { id: candidateId },
      select: { userId: true, whatsappCapable: true },
    });
    return profile;
  }

  /** Resolve a candidate profile id from its owning userId (S4-B3 candidate reads). */
  async getCandidateIdForUser(userId: string): Promise<string | null> {
    const profile = await this.prisma.candidateProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    return profile?.id ?? null;
  }

  /**
   * BATCHED employer-context candidate views by id (S4-B3 applicant cards).
   *
   * UNLIKE browse (findVisibleCandidateForEmployerView), this does NOT apply the
   * `profileVisible` gate: an applicant is visible to the employer who owns the job
   * they applied to, regardless of whether they appear in the public browse pool.
   * The privacy OMISSION semantics (phone/religion toggles, no dob, docs status-only)
   * still flow through `toEmployerView` — this read just supplies the raw source.
   * Same field selection as the single-candidate employer view. One query for the page.
   */
  async getEmployerViewsByIds(
    ids: string[],
  ): Promise<Map<string, CandidateForEmployerView>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.candidateProfile.findMany({
      where: { id: { in: ids } },
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
        skills: { select: { id: true, name: true }, orderBy: { name: 'asc' } },
        documents: { select: { type: true, expiryDate: true } },
      },
    });
    return new Map(rows.map((r) => [r.id, r as CandidateForEmployerView]));
  }

  /** Candidate ids whose fullName matches the admin search term (S4-B3 admin list). */
  async searchCandidateIdsByName(q: string): Promise<string[]> {
    const rows = await this.prisma.candidateProfile.findMany({
      where: { fullName: { contains: q, mode: 'insensitive' } },
      select: { id: true },
      take: 200,
    });
    return rows.map((r) => r.id);
  }

  /**
   * S6a-B1 (admin dashboard): platform-wide candidate counts. Two grouped
   * queries at most — never a per-row walk. `total` counts NON-PURGED profiles
   * (the contract's dashboard figure — a purged tombstone is a record, not a
   * person on the platform); `active` further excludes SUSPENDED and
   * PENDING_DELETION users (on their way out, shouldn't inflate the headline).
   */
  async countCandidates(): Promise<{ total: number; active: number }> {
    const [total, active] = await Promise.all([
      this.prisma.candidateProfile.count({ where: { user: { purgedAt: null } } }),
      this.prisma.candidateProfile.count({
        where: { user: { status: UserStatus.ACTIVE } },
      }),
    ]);
    return { total, active };
  }

  // ── S7-B1: the resume-render source (worker-side) ─────────────────────────

  /**
   * Everything the resume-view mapper needs, in ONE read — the Rule-4 seam
   * the resume module renders through (it owns candidate_resumes /
   * resume_generations, never candidate_profiles). Selected here, not shaped:
   * the SHAPING (settings-driven omission) is the resume-view mapper's job.
   * `documentNumber` is selected ONLY here — no employer-context select ever
   * includes it.
   */
  async getResumeSource(candidateId: string): Promise<ResumeSource | null> {
    const row = await this.prisma.candidateProfile.findUnique({
      where: { id: candidateId },
      select: {
        id: true,
        fullName: true,
        fatherName: true,
        dob: true,
        phone: true,
        maritalStatus: true,
        religion: true,
        languages: true,
        currentLocation: true,
        nationality: true,
        photoKey: true,
        videoR2Key: true,
        jobCategory: { select: { nameEn: true } },
        user: { select: { email: true } },
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
        skills: { select: { id: true, name: true }, orderBy: { name: 'asc' } },
        documents: { select: { type: true, expiryDate: true, documentNumber: true } },
      },
    });
    return row as ResumeSource | null;
  }

  // ── S6b-B1: Admin-context reads (Screen 25's data) ───────────────────────

  /**
   * Offset-paginated admin candidate list. The admin card is FULLER than the
   * employer view — contact details and deletion state included (admins are the
   * DPDP data controllers) — but NO r2Key/fileName/URL is ever selected here:
   * document CONTENT flows only through the per-issuance-audited signed-URL
   * grant (S6a-B1). Purged candidates appear as tombstones (the anonymized
   * values are simply what the rows now hold) — not hidden, so the trail stays
   * navigable.
   */
  async adminListCandidates(query: {
    page: number;
    pageSize: number;
    search?: string;
    status?: UserStatus;
    visibility?: boolean;
  }): Promise<{ rows: AdminCandidateSource[]; total: number }> {
    const where: Prisma.CandidateProfileWhereInput = {
      user: {
        role: UserRole.CANDIDATE,
        ...(query.status && { status: query.status }),
      },
      ...(query.visibility !== undefined && { profileVisible: query.visibility }),
      ...(query.search && {
        OR: [
          { fullName: { contains: query.search, mode: 'insensitive' } },
          { phone: { contains: query.search } },
          { user: { email: { contains: query.search, mode: 'insensitive' } } },
        ],
      }),
    };

    const [rows, total] = await Promise.all([
      this.prisma.candidateProfile.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: ADMIN_CANDIDATE_SELECT,
      }),
      this.prisma.candidateProfile.count({ where }),
    ]);
    return { rows: rows as AdminCandidateSource[], total };
  }

  /**
   * Single-candidate admin view (detail screen): the card source plus
   * experiences and skills. Admins are NOT subject to profileVisible, and
   * purged tombstones ARE returned. Document STATUS only — no keys.
   */
  async getAdminCandidateView(candidateId: string): Promise<AdminCandidateDetailSource | null> {
    const row = await this.prisma.candidateProfile.findUnique({
      where: { id: candidateId },
      select: {
        ...ADMIN_CANDIDATE_SELECT,
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
        skills: { select: { id: true, name: true }, orderBy: { name: 'asc' } },
      },
    });
    return row as AdminCandidateDetailSource | null;
  }

  /** Batched candidate display names by id (S4-B3 summaries + admin list). */
  async getNamesByIds(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.candidateProfile.findMany({
      where: { id: { in: ids } },
      select: { id: true, fullName: true },
    });
    return new Map(rows.map((r) => [r.id, r.fullName]));
  }

  // ── S3-B2: Employer-context reads ────────────────────────────────────────

  /**
   * Returns a candidate's full profile for the employer viewer, or null if the
   * candidate is invisible (profileVisible=false), not ACTIVE (suspended,
   * pending deletion, purged), or nonexistent.
   *
   * Anti-enumeration: null is returned for ALL cases — the caller maps this
   * to a 404 that is byte-identical for invisible vs nonexistent candidates.
   *
   * S6b-B1: the account-state gate tightened from `not: PENDING_DELETION` to
   * `status: ACTIVE` — a SUSPENDED candidate was previously still visible in
   * employer surfaces, which made suspension cosmetic. ACTIVE-only covers
   * suspended, pending-deletion and purged in one rule.
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
        user: { status: UserStatus.ACTIVE },
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
   * S5-B3 document gate: resolve the r2Key for ONE document of a VISIBLE
   * candidate. Returns null for ALL of: nonexistent candidate,
   * profileVisible = false, PENDING_DELETION, or the document type not
   * uploaded — one null, so the caller maps every cause to a single
   * indistinguishable 404 (the S3-B2 anti-enumeration discipline).
   *
   * This is the ONLY employer-context read that surfaces a document key.
   * The Pro-plan gate runs in the caller BEFORE this read — a Free employer
   * never reaches it.
   */
  async findVisibleDocumentKeyForEmployer(
    candidateId: string,
    type: DocumentType,
  ): Promise<{ r2Key: string } | null> {
    return this.prisma.candidateDocument.findFirst({
      where: {
        candidateId,
        type,
        candidate: {
          profileVisible: true,
          // S6b-B1: ACTIVE-only (was `not: PENDING_DELETION`) — a suspended
          // candidate's passport must not be reachable by employers.
          user: { status: UserStatus.ACTIVE },
        },
      },
      select: { r2Key: true },
    });
  }

  /**
   * S6a-B1 (admin document grant): resolve the r2Key for ONE document of ANY
   * candidate — visible or not.
   *
   * THE DELIBERATE PRIVACY RELAXATION. The employer path
   * (findVisibleDocumentKeyForEmployer) gates on `profileVisible: true`; this one
   * does NOT, and that difference is the entire point of the separate
   * `candidates.view_documents` permission. Fraud review, dispute resolution and
   * DPDP data-subject requests routinely concern candidates who have hidden
   * themselves — an admin who cannot see them cannot investigate them.
   *
   * This is only defensible because EVERY grant is audited (`document.viewed`
   * with the actor). The relaxation and the audit are one control, not two:
   * implement both or neither.
   *
   * PENDING_DELETION candidates ARE still reachable — a pending deletion is
   * exactly when a dispute is most likely to be live, and their documents still
   * exist. Once the purge worker runs, the R2 object and the row are gone, so
   * this returns null and the caller 404s naturally. No special case needed.
   *
   * Returns null for: unknown candidate, or that document type not uploaded.
   */
  async findDocumentKeyForAdmin(
    candidateId: string,
    type: DocumentType,
  ): Promise<{ r2Key: string } | null> {
    return this.prisma.candidateDocument.findFirst({
      where: { candidateId, type },
      select: { r2Key: true },
    });
  }

  /**
   * Browse visible candidates for the employer feed.
   *
   * - Only profileVisible=true candidates of ACTIVE users appear (S6b-B1:
   *   tightened from `not: PENDING_DELETION` — suspension now hides too).
   * - Filters: category (jobCategoryId), hasForeignExperience, availability, text q.
   * - minExperienceYears is applied in-memory (Prisma cannot SUM related years in WHERE).
   *   Offset pagination needs an honest `total`, so when that filter is active we
   *   materialize the DB-matching set, filter it, then slice. That replaces the
   *   old `limit * 5` over-fetch heuristic, which could both under-fill a page and
   *   end pagination early. The unfiltered path stays a plain skip/take + COUNT.
   * - Stable total ordering: updatedAt DESC, id DESC.
   */
  async browseVisibleCandidates(
    filters: BrowseFilter,
  ): Promise<{ data: CandidateBrowseSource[]; total: number }> {
    const { skip, take } = resolvePaging(filters.page, filters.pageSize, 50);

    const where: Prisma.CandidateProfileWhereInput = {
      profileVisible: true,
      user: { status: UserStatus.ACTIVE },
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
    };

    const orderBy: Prisma.CandidateProfileOrderByWithRelationInput[] = [
      { updatedAt: 'desc' },
      { id: 'desc' },
    ];
    const select = {
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
        orderBy: { name: 'asc' as const },
        take: 3,
      },
    };

    const enrich = <
      T extends { experiences: { type: ExperienceType; years: number; months: number }[] },
    >(
      row: T,
    ) => ({
      ...row,
      totalExperienceYears: row.experiences.reduce((sum, e) => sum + e.years + e.months / 12, 0),
      hasForeignExperience: row.experiences.some((e) => e.type === ExperienceType.FOREIGN),
    });

    // Fast path — every filter is expressible in SQL, so the DB does the paging.
    if (filters.minExperienceYears == null) {
      const [rows, total] = await Promise.all([
        this.prisma.candidateProfile.findMany({ where, orderBy, skip, take, select }),
        this.prisma.candidateProfile.count({ where }),
      ]);
      return { data: rows.map(enrich), total };
    }

    // Slow path — minExperienceYears sums a relation, which Prisma cannot express
    // in WHERE. Paging must happen after the filter, so the filtered length IS the
    // total; anything cheaper would report a page count the user can't navigate to.
    const min = filters.minExperienceYears;
    const all = await this.prisma.candidateProfile.findMany({ where, orderBy, select });
    const filtered = all.map(enrich).filter((r) => r.totalExperienceYears >= min);

    return { data: filtered.slice(skip, skip + take), total: filtered.length };
  }
}

// ── S6b-B1: admin-read select + source shapes ────────────────────────────────

/**
 * The admin card's field set — deliberately a single shared constant so the
 * list and the detail can never drift. NOTE what is ABSENT: r2Key, fileName,
 * mimeType, photoKey, videoR2Key — the admin table carries document STATUS
 * only; content is the audited signed-URL grant.
 */
const ADMIN_CANDIDATE_SELECT = {
  id: true,
  userId: true,
  fullName: true,
  phone: true,
  profileVisible: true,
  completionPct: true,
  createdAt: true,
  user: { select: { email: true, status: true, deletionDueAt: true, purgedAt: true } },
  documents: { select: { type: true, expiryDate: true } },
} as const;

export interface AdminCandidateSource {
  id: string;
  userId: string;
  fullName: string;
  phone: string | null;
  profileVisible: boolean;
  completionPct: number;
  createdAt: Date;
  user: {
    email: string;
    status: UserStatus;
    deletionDueAt: Date | null;
    purgedAt: Date | null;
  };
  documents: { type: DocumentType; expiryDate: Date | null }[];
}

export interface AdminCandidateDetailSource extends AdminCandidateSource {
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
}

/** S7-B1: the raw material the resume-view mapper shapes (worker-side read). */
export interface ResumeSource {
  id: string;
  fullName: string;
  fatherName: string | null;
  dob: Date | null;
  phone: string | null;
  maritalStatus: string | null;
  religion: string | null;
  languages: string[];
  currentLocation: string | null;
  nationality: string | null;
  photoKey: string | null;
  videoR2Key: string | null;
  jobCategory: { nameEn: string } | null;
  user: { email: string };
  experiences: {
    id: string;
    type: string;
    country: string;
    companyName: string;
    role: string;
    years: number;
    months: number;
    startDate: Date | null;
    endDate: Date | null;
  }[];
  skills: { id: string; name: string }[];
  documents: { type: DocumentType; expiryDate: Date | null; documentNumber: string | null }[];
}

// ── Return-type interfaces (exported for Employer module mappers) ────────────

export interface CandidateApplyInputs {
  candidateId: string;
  completionPct: number;
  categoryId: string | null;
  totalExperienceYears: number;
  hasForeignExperience: boolean;
  documents: { type: DocumentType; expiryDate: Date | null }[];
}

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
  page?: number;
  pageSize?: number;
}
