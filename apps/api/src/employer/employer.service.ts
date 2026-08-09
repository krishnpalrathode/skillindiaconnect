import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Company, CompanyStatus, CompanyType } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../core/prisma/prisma.service';
import { StorageService } from '../core/storage/storage.service';
import { RegisterCompanyDto } from './dto/register-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { PresignCertDto, CERT_MAX_BYTES } from './dto/presign-cert.dto';
import { ConfirmCertDto } from './dto/confirm-cert.dto';
import { buildOrderBy, resolveSort } from '../core/sorting';

const CERT_MIMES = ['application/pdf', 'image/jpeg', 'image/png'];

/** Sortable columns for the admin employer-approval queue (whitelisted). */
export const EMPLOYER_QUEUE_SORT = {
  name: 'name',
  status: 'status',
  created: 'createdAt',
} as const;

export const EMPLOYER_QUEUE_SORT_DEFAULT = 'created:desc';

/**
 * The wire Company (contract `Company`): the entity plus the DERIVED
 * `registrationCertKey` — certificates live in company_documents rows, but the
 * contract exposes the newest one's key on the company itself. The S2-F3
 * resubmit form PREFILLS its certificate state from this field; without it,
 * every rejected employer was forced to re-upload a certificate they already
 * had before the form would let them resubmit (caught by the S6 happy-path
 * pass, B5).
 */
export type CompanyResponse = Company & { registrationCertKey: string | null };

@Injectable()
export class EmployerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Attach the newest certificate key — one indexed lookup, never a join fan-out. */
  private async withCertKey(company: Company): Promise<CompanyResponse> {
    const latest = await this.prisma.companyDocument.findFirst({
      where: { companyId: company.id },
      orderBy: { uploadedAt: 'desc' },
      select: { r2Key: true },
    });
    return { ...company, registrationCertKey: latest?.r2Key ?? null };
  }

  // ── Registration ───────────────────────────────────────────────────────────

  async register(userId: string, dto: RegisterCompanyDto): Promise<Company> {
    const existing = await this.prisma.employerUser.findUnique({ where: { userId } });
    if (existing) {
      throw new ConflictException({ code: 'COMPANY_EXISTS' });
    }

    // Screen 14 initial mode uploads the certificate BEFORE the company row
    // exists (presign→PUT, then the key arrives here). Validate ownership
    // (the pre-registration prefix is user-scoped) and HEAD the object
    // before opening the transaction.
    let certHead: { sizeBytes: number; contentType: string } | null = null;
    if (dto.registrationCertKey) {
      certHead = await this.assertOwnedUploadedCert(
        `employer-reg/${userId}/cert/`,
        dto.registrationCertKey,
      );
    }

    const company = await this.prisma.$transaction(async (tx) => {
      const c = await tx.company.create({
        data: {
          name: dto.name,
          type: dto.type,
          registrationNumber: dto.registrationNumber,
          industryType: dto.industryType,
          phoneCode: dto.phoneCode,
          phone: dto.phone,
          country: dto.country,
          location: dto.location,
          website: dto.website,
          employeeRange: dto.employeeRange,
          // Contract: single locale string (default 'en'); column is String[].
          languagePref: dto.languagePref ? [dto.languagePref] : ['en'],
          description: dto.description,
          status: CompanyStatus.PENDING,
        },
      });
      await tx.employerUser.create({
        data: { userId, companyId: c.id, isPrimary: true },
      });
      if (dto.registrationCertKey && certHead) {
        await tx.companyDocument.create({
          data: {
            companyId: c.id,
            r2Key: dto.registrationCertKey,
            fileName: dto.registrationCertKey.split('/').pop() ?? dto.registrationCertKey,
            mimeType: certHead.contentType,
            sizeBytes: certHead.sizeBytes,
          },
        });
      }
      return c;
    });

    return company;
  }

  // ── Company reads ──────────────────────────────────────────────────────────

  async getCompanyForEmployerUser(userId: string): Promise<CompanyResponse> {
    const link = await this.prisma.employerUser.findUnique({
      where: { userId },
      include: { company: true },
    });
    if (!link) {
      throw new NotFoundException({ code: 'COMPANY_NOT_FOUND' });
    }
    return this.withCertKey(link.company);
  }

  async getCompanyById(companyId: string): Promise<CompanyResponse> {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) {
      throw new NotFoundException({ code: 'COMPANY_NOT_FOUND' });
    }
    return this.withCertKey(company);
  }

  // ── Company update ─────────────────────────────────────────────────────────

  async updateCompany(userId: string, dto: UpdateCompanyDto): Promise<CompanyResponse> {
    const company = await this.getCompanyForEmployerUser(userId);

    const updated = await this.prisma.company.update({
      where: { id: company.id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.registrationNumber !== undefined && {
          registrationNumber: dto.registrationNumber,
        }),
        ...(dto.industryType !== undefined && { industryType: dto.industryType }),
        ...(dto.phoneCode !== undefined && { phoneCode: dto.phoneCode }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.country !== undefined && { country: dto.country }),
        ...(dto.location !== undefined && { location: dto.location }),
        ...(dto.website !== undefined && { website: dto.website }),
        ...(dto.employeeRange !== undefined && { employeeRange: dto.employeeRange }),
        ...(dto.languagePref !== undefined && { languagePref: dto.languagePref }),
        ...(dto.description !== undefined && { description: dto.description }),
      },
    });

    // REJECTED → PENDING re-submission when the employer edits their company.
    if (company.status === CompanyStatus.REJECTED) {
      const resubmitted = await this.prisma.company.update({
        where: { id: company.id },
        data: { status: CompanyStatus.PENDING, rejectionReason: null },
      });
      return this.withCertKey(resubmitted);
    }

    return this.withCertKey(updated);
  }

  // ── Certificate upload (presign → PUT → confirm) ──────────────────────────

  async presignCert(
    userId: string,
    dto: PresignCertDto,
  ): Promise<{ uploadUrl: string; key: string; expiresInSeconds: number }> {
    // Initial registration (Screen 14) presigns BEFORE the company exists —
    // the contract documents no 404 here. Pre-registration uploads are
    // user-scoped; once a company exists (resubmit), keys are company-scoped.
    const link = await this.prisma.employerUser.findUnique({
      where: { userId },
      select: { companyId: true },
    });
    const safeFileName = dto.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = link
      ? `companies/${link.companyId}/cert/${uuidv4()}-${safeFileName}`
      : `employer-reg/${userId}/cert/${uuidv4()}-${safeFileName}`;
    const { url, expiresInSeconds } = await this.storage.presignPut({
      key,
      contentType: dto.mimeType,
      maxBytes: CERT_MAX_BYTES,
    });
    return { uploadUrl: url, key, expiresInSeconds };
  }

  async confirmCert(userId: string, dto: ConfirmCertDto): Promise<{ id: string; r2Key: string }> {
    const company = await this.getCompanyForEmployerUser(userId);

    const head = await this.assertOwnedUploadedCert(`companies/${company.id}/cert/`, dto.key);

    const fileName = dto.key.split('/').pop() ?? dto.key;

    const doc = await this.prisma.companyDocument.create({
      data: {
        companyId: company.id,
        r2Key: dto.key,
        fileName,
        mimeType: head.contentType,
        sizeBytes: head.sizeBytes,
      },
    });

    return { id: doc.id, r2Key: doc.r2Key };
  }

  /**
   * Shared gate for both cert paths (confirm + register-with-key): the key
   * must sit under the caller's own prefix, and the object must exist in R2
   * within the type/size limits.
   */
  private async assertOwnedUploadedCert(
    expectedPrefix: string,
    key: string,
  ): Promise<{ sizeBytes: number; contentType: string }> {
    if (!key.startsWith(expectedPrefix)) {
      throw new ForbiddenException({ code: 'KEY_NOT_OWNED' });
    }
    const head = await this.storage.headObject(key);
    if (!head) {
      throw new UnprocessableEntityException({ code: 'UPLOAD_NOT_FOUND' });
    }
    if (head.sizeBytes > CERT_MAX_BYTES) {
      throw new UnprocessableEntityException({ code: 'FILE_TOO_LARGE' });
    }
    if (!CERT_MIMES.includes(head.contentType)) {
      throw new UnprocessableEntityException({ code: 'INVALID_FILE_TYPE' });
    }
    return head;
  }

  // ── Cross-module seam (for S2-B5 Jobs) ────────────────────────────────────

  /**
   * Throws 403 EMPLOYER_NOT_APPROVED if the company isn't APPROVED.
   * Called by Jobs module at publish time — never queries employer tables directly.
   */
  async assertApproved(companyId: string): Promise<void> {
    const company = await this.getCompanyById(companyId);
    if (company.status !== CompanyStatus.APPROVED) {
      throw new ForbiddenException({ code: 'EMPLOYER_NOT_APPROVED' });
    }
  }

  /**
   * Returns LOCAL or FOREIGN. Used by Jobs/Payments for routing logic.
   */
  async getCompanyType(companyId: string): Promise<CompanyType> {
    const company = await this.getCompanyById(companyId);
    return company.type;
  }

  // ── Cross-module seam (S6a-B1 admin read surfaces) ────────────────────────

  /**
   * S6a-B1 (admin dashboard): company counts keyed by CompanyStatus. ONE grouped
   * query — never a count-per-status loop.
   */
  async countByStatus(): Promise<Record<string, number>> {
    const grouped = await this.prisma.company.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    // Zero-filled: the dashboard renders a fixed tile set and must not silently
    // drop one just because nothing is currently in that state.
    const counts: Record<string, number> = {
      PENDING: 0,
      APPROVED: 0,
      REJECTED: 0,
      SUSPENDED: 0,
    };
    for (const row of grouped) {
      counts[row.status] = row._count._all;
    }
    return counts;
  }

  /**
   * S6a-B1 (admin certificate grant): the r2Key of the company's most recent
   * registration certificate, or null if none was ever uploaded.
   *
   * The Admin module never touches company_documents itself (Rule 4) — it asks
   * here. Returns the KEY; the caller presigns it and audits the issuance.
   */
  async getRegistrationCertKey(companyId: string): Promise<string | null> {
    const doc = await this.prisma.companyDocument.findFirst({
      where: { companyId },
      orderBy: { uploadedAt: 'desc' },
      select: { r2Key: true },
    });
    return doc?.r2Key ?? null;
  }

  /**
   * Narrow read for S4-B1: resolve a company's primary employer userId so the
   * Applications module can send the "new applicant" in-app notification WITHOUT
   * querying employer_users directly (module-boundaries.md Rule 4).
   *
   * Falls back to any linked employer user if no primary is flagged; returns null
   * if the company has no linked user (defensive — the caller then skips the
   * employer notification rather than failing the apply).
   */
  async getPrimaryUserIdForCompany(companyId: string): Promise<string | null> {
    const link = await this.prisma.employerUser.findFirst({
      where: { companyId },
      orderBy: { isPrimary: 'desc' },
      select: { userId: true },
    });
    return link?.userId ?? null;
  }

  // ── Admin list ─────────────────────────────────────────────────────────────

  async adminList(opts: {
    status?: CompanyStatus;
    type?: CompanyType;
    search?: string;
    page: number;
    pageSize: number;
    sort: string;
  }): Promise<{
    data: Company[];
    meta: { page: number; pageSize: number; total: number; totalPages: number; sort: string };
  }> {
    // Shared resolver, so this table gains the `id` tiebreaker the local
    // implementation lacked: ordering by `status` or `name` alone is not a total
    // order, and offset pages over a non-total order can repeat or skip rows.
    const sort = resolveSort(opts.sort, EMPLOYER_QUEUE_SORT, EMPLOYER_QUEUE_SORT_DEFAULT);

    const where = {
      ...(opts.status && { status: opts.status }),
      ...(opts.type && { type: opts.type }),
      ...(opts.search && {
        name: { contains: opts.search, mode: 'insensitive' as const },
      }),
    };

    const [data, total] = await Promise.all([
      this.prisma.company.findMany({
        where,
        include: { documents: { orderBy: { uploadedAt: 'desc' }, take: 1 } },
        orderBy: buildOrderBy(sort, EMPLOYER_QUEUE_SORT),
        skip: (opts.page - 1) * opts.pageSize,
        take: opts.pageSize,
      }),
      this.prisma.company.count({ where }),
    ]);

    return {
      data,
      meta: {
        page: opts.page,
        pageSize: opts.pageSize,
        total,
        totalPages: Math.ceil(total / opts.pageSize),
        sort: sort.applied,
      },
    };
  }
}
