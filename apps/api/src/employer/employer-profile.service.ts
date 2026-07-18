import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Company, ContactPerson, HiringPreference } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../core/prisma/prisma.service';
import { StorageService } from '../core/storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_MODULES, AuditStatus } from '../audit/audit.types';
import { EmployerService } from './employer.service';
import { UpsertHiringPreferencesDto } from './dto/upsert-hiring-preferences.dto';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { PresignLogoDto, LOGO_MAX_BYTES, LOGO_ALLOWED_MIMES } from './dto/presign-logo.dto';
import { ConfirmLogoDto } from './dto/confirm-logo.dto';

// ── Shape types (matched to S3-0 frozen spec) ──────────────────────────────

export interface ProfileChecklist {
  hasLogo: boolean;
  hasHiringPreferences: boolean;
  hasSecondContact: boolean;
  hasDescription: boolean;
  hint: string | null;
}

export interface HiringPreferencesShape {
  preferredCategories?: string[];
  preferredNationalities?: string[];
  minExperience?: number;
}

export interface ContactPersonShape {
  id: string;
  name: string;
  role: string;
  phone?: string;
  email?: string;
  isPrimary: boolean;
  createdAt: string;
}

export interface EmployerProfileShape {
  company: Company;
  hiringPreferences?: HiringPreferencesShape;
  contacts: ContactPersonShape[];
  logoUrl: string | null;
  profileChecklist: ProfileChecklist;
}

// ── Pure utility — exported so EmployerDashboardService can reuse it ───────

/**
 * Computes the employer profile completeness checklist.
 * Pure function — no DB calls, no side effects.
 * Never stored (decision 3 — computed per-request only).
 */
export function computeChecklist(
  company: Company,
  prefs: HiringPreference | null,
  contacts: ContactPerson[],
): ProfileChecklist {
  const hasLogo = !!company.logoKey;
  const hasDescription = !!(company.description?.trim());
  const hasHiringPreferences = !!prefs;
  const hasSecondContact = contacts.length >= 2;

  let hint: string | null = null;
  if (!hasLogo) {
    hint = 'Add a company logo to build candidate trust';
  } else if (!hasDescription) {
    hint = 'Add a company description to attract top candidates';
  } else if (!hasHiringPreferences) {
    hint = 'Set your hiring preferences to get better candidate matches';
  } else if (!hasSecondContact) {
    hint = 'Add a second contact person for better reachability';
  }

  return { hasLogo, hasDescription, hasHiringPreferences, hasSecondContact, hint };
}

// ── Mappers ─────────────────────────────────────────────────────────────────

function toHiringPrefsShape(prefs: HiringPreference): HiringPreferencesShape {
  return {
    preferredCategories: prefs.categories.length ? prefs.categories : undefined,
    preferredNationalities: prefs.countriesHiredFrom.length
      ? prefs.countriesHiredFrom
      : undefined,
    minExperience:
      prefs.preferredExp != null ? parseInt(prefs.preferredExp, 10) : undefined,
  };
}

function toContactShape(contact: ContactPerson): ContactPersonShape {
  return {
    id: contact.id,
    name: contact.name,
    role: contact.designation ?? '',
    ...(contact.phone != null && { phone: contact.phone }),
    ...(contact.email != null && { email: contact.email }),
    isPrimary: contact.isPrimary,
    createdAt: contact.createdAt.toISOString(),
  };
}

// ── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class EmployerProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly employerService: EmployerService,
  ) {}

  // ── GET /employers/me/profile ────────────────────────────────────────────

  async getProfile(userId: string): Promise<EmployerProfileShape> {
    const company = await this.employerService.getCompanyForEmployerUser(userId);

    const [prefs, contacts] = await Promise.all([
      this.prisma.hiringPreference.findUnique({ where: { companyId: company.id } }),
      this.prisma.contactPerson.findMany({
        where: { companyId: company.id },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      }),
    ]);

    const logoUrl = company.logoKey ? await this.storage.presignGet(company.logoKey) : null;

    return {
      company,
      hiringPreferences: prefs ? toHiringPrefsShape(prefs) : undefined,
      contacts: contacts.map(toContactShape),
      logoUrl,
      profileChecklist: computeChecklist(company, prefs, contacts),
    };
  }

  // ── PATCH /employers/me/profile/hiring-preferences ──────────────────────

  async upsertHiringPreferences(
    userId: string,
    dto: UpsertHiringPreferencesDto,
  ): Promise<HiringPreferencesShape> {
    const company = await this.employerService.getCompanyForEmployerUser(userId);

    if (dto.preferredCategories?.length) {
      const found = await this.prisma.jobCategory.findMany({
        where: { id: { in: dto.preferredCategories } },
        select: { id: true },
      });
      if (found.length !== dto.preferredCategories.length) {
        const foundIds = new Set(found.map((c) => c.id));
        const invalid = dto.preferredCategories.filter((id) => !foundIds.has(id));
        throw new UnprocessableEntityException({
          code: 'INVALID_CATEGORY_IDS',
          meta: { invalid },
        });
      }
    }

    const prefs = await this.prisma.hiringPreference.upsert({
      where: { companyId: company.id },
      create: {
        companyId: company.id,
        categories: dto.preferredCategories ?? [],
        countriesHiredFrom: dto.preferredNationalities ?? [],
        preferredExp: dto.minExperience != null ? String(dto.minExperience) : null,
      },
      update: {
        ...(dto.preferredCategories !== undefined && { categories: dto.preferredCategories }),
        ...(dto.preferredNationalities !== undefined && {
          countriesHiredFrom: dto.preferredNationalities,
        }),
        ...(dto.minExperience !== undefined && { preferredExp: String(dto.minExperience) }),
      },
    });

    await this.audit.log({
      actorUserId: userId,
      action: AUDIT_ACTIONS.EMPLOYER_PROFILE_UPDATED,
      module: AUDIT_MODULES.EMPLOYER,
      targetType: 'HiringPreference',
      targetId: prefs.id,
      status: AuditStatus.SUCCESS,
      meta: { companyId: company.id, section: 'hiringPreferences' },
    });

    return toHiringPrefsShape(prefs);
  }

  // ── POST /employers/me/profile/contacts ──────────────────────────────────

  async createContact(userId: string, dto: CreateContactDto): Promise<ContactPersonShape> {
    const company = await this.employerService.getCompanyForEmployerUser(userId);

    // Single-primary rule: demote any existing primary in the same transaction.
    // At no point do two primaries coexist — partial failure rolls back both operations.
    const contact = await this.prisma.$transaction(async (tx) => {
      if (dto.isPrimary) {
        await tx.contactPerson.updateMany({
          where: { companyId: company.id, isPrimary: true },
          data: { isPrimary: false },
        });
      }
      return tx.contactPerson.create({
        data: {
          companyId: company.id,
          name: dto.name,
          designation: dto.role,
          phone: dto.phone ?? null,
          email: dto.email ?? null,
          isPrimary: dto.isPrimary,
        },
      });
    });

    await this.audit.log({
      actorUserId: userId,
      action: AUDIT_ACTIONS.EMPLOYER_CONTACT_CREATED,
      module: AUDIT_MODULES.EMPLOYER,
      targetType: 'ContactPerson',
      targetId: contact.id,
      status: AuditStatus.SUCCESS,
      meta: { companyId: company.id, isPrimary: contact.isPrimary },
    });

    return toContactShape(contact);
  }

  // ── PATCH /employers/me/profile/contacts/:id ─────────────────────────────

  async updateContact(
    userId: string,
    contactId: string,
    dto: UpdateContactDto,
  ): Promise<ContactPersonShape> {
    const company = await this.employerService.getCompanyForEmployerUser(userId);
    await this.assertContactOwnership(contactId, company.id);

    const contact = await this.prisma.$transaction(async (tx) => {
      if (dto.isPrimary === true) {
        await tx.contactPerson.updateMany({
          where: { companyId: company.id, isPrimary: true, id: { not: contactId } },
          data: { isPrimary: false },
        });
      }
      return tx.contactPerson.update({
        where: { id: contactId },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.role !== undefined && { designation: dto.role }),
          ...(dto.phone !== undefined && { phone: dto.phone }),
          ...(dto.email !== undefined && { email: dto.email }),
          ...(dto.isPrimary !== undefined && { isPrimary: dto.isPrimary }),
        },
      });
    });

    await this.audit.log({
      actorUserId: userId,
      action: AUDIT_ACTIONS.EMPLOYER_CONTACT_UPDATED,
      module: AUDIT_MODULES.EMPLOYER,
      targetType: 'ContactPerson',
      targetId: contactId,
      status: AuditStatus.SUCCESS,
      meta: { companyId: company.id },
    });

    return toContactShape(contact);
  }

  // ── DELETE /employers/me/profile/contacts/:id ────────────────────────────

  async deleteContact(userId: string, contactId: string): Promise<void> {
    const company = await this.employerService.getCompanyForEmployerUser(userId);
    await this.assertContactOwnership(contactId, company.id);

    await this.prisma.contactPerson.delete({ where: { id: contactId } });

    await this.audit.log({
      actorUserId: userId,
      action: AUDIT_ACTIONS.EMPLOYER_CONTACT_DELETED,
      module: AUDIT_MODULES.EMPLOYER,
      targetType: 'ContactPerson',
      targetId: contactId,
      status: AuditStatus.SUCCESS,
      meta: { companyId: company.id },
    });
  }

  // ── POST /employers/me/profile/logo/presign ──────────────────────────────

  async presignLogo(
    userId: string,
    dto: PresignLogoDto,
  ): Promise<{ uploadUrl: string; key: string; expiresInSeconds: number }> {
    const company = await this.employerService.getCompanyForEmployerUser(userId);

    if (!LOGO_ALLOWED_MIMES.includes(dto.mimeType as (typeof LOGO_ALLOWED_MIMES)[number])) {
      throw new UnprocessableEntityException({ code: 'INVALID_FILE_TYPE' });
    }
    if (dto.sizeBytes > LOGO_MAX_BYTES) {
      throw new UnprocessableEntityException({ code: 'FILE_TOO_LARGE' });
    }

    const ext = dto.mimeType === 'image/png' ? 'png' : 'jpg';
    const key = `companies/${company.id}/logo/${uuidv4()}.${ext}`;
    const { url, expiresInSeconds } = await this.storage.presignPut({
      key,
      contentType: dto.mimeType,
      maxBytes: LOGO_MAX_BYTES,
    });

    return { uploadUrl: url, key, expiresInSeconds };
  }

  // ── POST /employers/me/profile/logo/confirm ──────────────────────────────

  /**
   * Contract: returns the UPDATED EmployerProfile (fresh logoUrl + recomputed
   * checklist) — the web swaps its whole profile state with this response.
   */
  async confirmLogo(userId: string, dto: ConfirmLogoDto): Promise<EmployerProfileShape> {
    const company = await this.employerService.getCompanyForEmployerUser(userId);

    const expectedPrefix = `companies/${company.id}/logo/`;
    if (!dto.key.startsWith(expectedPrefix)) {
      throw new ForbiddenException({ code: 'KEY_NOT_OWNED' });
    }

    const head = await this.storage.headObject(dto.key);
    if (!head) {
      throw new UnprocessableEntityException({ code: 'UPLOAD_NOT_FOUND' });
    }
    if (head.sizeBytes > LOGO_MAX_BYTES) {
      throw new UnprocessableEntityException({ code: 'FILE_TOO_LARGE' });
    }
    if (!LOGO_ALLOWED_MIMES.includes(head.contentType as (typeof LOGO_ALLOWED_MIMES)[number])) {
      throw new UnprocessableEntityException({ code: 'INVALID_FILE_TYPE' });
    }

    await this.prisma.company.update({
      where: { id: company.id },
      data: { logoKey: dto.key },
    });

    await this.audit.log({
      actorUserId: userId,
      action: AUDIT_ACTIONS.EMPLOYER_LOGO_CONFIRMED,
      module: AUDIT_MODULES.EMPLOYER,
      targetType: 'Company',
      targetId: company.id,
      status: AuditStatus.SUCCESS,
      // logoKey is NOT in audit meta — it's a storage key (PII_DENYLIST: storageKey pattern)
      meta: { companyId: company.id, mimeType: head.contentType, sizeBytes: head.sizeBytes },
    });

    return this.getProfile(userId);
  }

  // ── Internal helpers ─────────────────────────────────────────────────────

  /**
   * Throws 404 (not 403) when the contact belongs to a different company —
   * indistinguishable from nonexistent, prevents existence probing.
   */
  private async assertContactOwnership(
    contactId: string,
    companyId: string,
  ): Promise<void> {
    const contact = await this.prisma.contactPerson.findUnique({ where: { id: contactId } });
    if (!contact || contact.companyId !== companyId) {
      throw new NotFoundException({ code: 'CONTACT_NOT_FOUND' });
    }
  }
}
