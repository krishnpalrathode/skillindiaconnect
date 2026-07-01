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

const CERT_MIMES = ['application/pdf', 'image/jpeg', 'image/png'];

@Injectable()
export class EmployerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  // ── Registration ───────────────────────────────────────────────────────────

  async register(userId: string, dto: RegisterCompanyDto): Promise<Company> {
    const existing = await this.prisma.employerUser.findUnique({ where: { userId } });
    if (existing) {
      throw new ConflictException({ code: 'COMPANY_EXISTS' });
    }

    const company = await this.prisma.$transaction(async (tx) => {
      const c = await tx.company.create({
        data: {
          name: dto.name,
          type: dto.type,
          registrationNumber: dto.registrationNumber,
          industryType: dto.industryType,
          phone: dto.phone,
          location: dto.location,
          website: dto.website,
          employeeRange: dto.employeeRange,
          languagePref: dto.languagePref,
          description: dto.description,
          status: CompanyStatus.PENDING,
        },
      });
      await tx.employerUser.create({
        data: { userId, companyId: c.id, isPrimary: true },
      });
      return c;
    });

    return company;
  }

  // ── Company reads ──────────────────────────────────────────────────────────

  async getCompanyForEmployerUser(userId: string): Promise<Company> {
    const link = await this.prisma.employerUser.findUnique({
      where: { userId },
      include: { company: true },
    });
    if (!link) {
      throw new NotFoundException({ code: 'COMPANY_NOT_FOUND' });
    }
    return link.company;
  }

  async getCompanyById(companyId: string): Promise<Company> {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) {
      throw new NotFoundException({ code: 'COMPANY_NOT_FOUND' });
    }
    return company;
  }

  // ── Company update ─────────────────────────────────────────────────────────

  async updateCompany(userId: string, dto: UpdateCompanyDto): Promise<Company> {
    const company = await this.getCompanyForEmployerUser(userId);

    const updated = await this.prisma.company.update({
      where: { id: company.id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.registrationNumber !== undefined && {
          registrationNumber: dto.registrationNumber,
        }),
        ...(dto.industryType !== undefined && { industryType: dto.industryType }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(dto.location !== undefined && { location: dto.location }),
        ...(dto.website !== undefined && { website: dto.website }),
        ...(dto.employeeRange !== undefined && { employeeRange: dto.employeeRange }),
        ...(dto.languagePref !== undefined && { languagePref: dto.languagePref }),
        ...(dto.description !== undefined && { description: dto.description }),
      },
    });

    // REJECTED → PENDING re-submission when the employer edits their company.
    if (company.status === CompanyStatus.REJECTED) {
      return this.prisma.company.update({
        where: { id: company.id },
        data: { status: CompanyStatus.PENDING, rejectionReason: null },
      });
    }

    return updated;
  }

  // ── Certificate upload (presign → PUT → confirm) ──────────────────────────

  async presignCert(
    userId: string,
    dto: PresignCertDto,
  ): Promise<{ uploadUrl: string; key: string; expiresInSeconds: number }> {
    const company = await this.getCompanyForEmployerUser(userId);
    const safeFileName = dto.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `companies/${company.id}/cert/${uuidv4()}-${safeFileName}`;
    const { url, expiresInSeconds } = await this.storage.presignPut({
      key,
      contentType: dto.mimeType,
      maxBytes: CERT_MAX_BYTES,
    });
    return { uploadUrl: url, key, expiresInSeconds };
  }

  async confirmCert(userId: string, dto: ConfirmCertDto): Promise<{ id: string; r2Key: string }> {
    const company = await this.getCompanyForEmployerUser(userId);

    const expectedPrefix = `companies/${company.id}/cert/`;
    if (!dto.key.startsWith(expectedPrefix)) {
      throw new ForbiddenException({ code: 'KEY_NOT_OWNED' });
    }

    const head = await this.storage.headObject(dto.key);
    if (!head) {
      throw new UnprocessableEntityException({ code: 'UPLOAD_NOT_FOUND' });
    }
    if (head.sizeBytes > CERT_MAX_BYTES) {
      throw new UnprocessableEntityException({ code: 'FILE_TOO_LARGE' });
    }
    if (!CERT_MIMES.includes(head.contentType)) {
      throw new UnprocessableEntityException({ code: 'INVALID_FILE_TYPE' });
    }

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

  // ── Dashboard (S2 minimal placeholder) ────────────────────────────────────

  async getDashboard(userId: string): Promise<{
    company: Company;
    kpis: { activeJobs: number; totalApplications: number; shortlisted: number };
    recentJobs: unknown[];
    recentApplicants: unknown[];
  }> {
    const company = await this.getCompanyForEmployerUser(userId);
    // S2: jobs + applications modules don't exist yet.
    // Returns real company + empty/zero placeholders; S3 fills real KPIs.
    return {
      company,
      kpis: { activeJobs: 0, totalApplications: 0, shortlisted: 0 },
      recentJobs: [],
      recentApplicants: [],
    };
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

  // ── Admin list ─────────────────────────────────────────────────────────────

  async adminList(opts: {
    status?: CompanyStatus;
    type?: CompanyType;
    search?: string;
    page: number;
    pageSize: number;
    sort: string;
  }): Promise<{ data: Company[]; meta: { page: number; pageSize: number; total: number; totalPages: number } }> {
    const [field, dir] = opts.sort.split(':');
    const safeField = ['createdAt', 'name', 'status'].includes(field ?? '') ? field! : 'createdAt';
    const safeDir = dir === 'asc' ? 'asc' : 'desc';

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
        orderBy: { [safeField]: safeDir },
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
      },
    };
  }
}
