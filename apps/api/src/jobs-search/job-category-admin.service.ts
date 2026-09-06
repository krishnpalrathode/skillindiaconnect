import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../core/prisma/prisma.service';
import { CreateJobCategoryDto } from './dto/create-job-category.dto';
import { UpdateJobCategoryDto } from './dto/update-job-category.dto';

/** The one slug the employer form branches on; it must always exist. */
const PROTECTED_SLUG = 'other';

export interface AdminJobCategory {
  id: string;
  slug: string;
  nameEn: string;
  nameHi: string | null;
  nameAr: string | null;
  isActive: boolean;
  jobCount: number;
}

/**
 * Admin CRUD over the job-category taxonomy. Lives in JobsSearchModule because
 * that module already owns `job_categories` (the public GET reads it), so all
 * access to the table stays in one module (Rule 4).
 *
 * The public picker (JobsSearchService.listCategories) returns only `isActive`
 * rows, so deactivating a category is the soft, reversible way to retire a trade
 * without orphaning the jobs already filed under it. Hard delete is reserved for
 * categories nothing references.
 */
@Injectable()
export class JobCategoryAdminService {
  constructor(private readonly prisma: PrismaService) {}

  /** All categories, active first-class citizens and inactive alike, with the
   *  count of jobs filed under each so the UI can warn before a delete. */
  async listAll(): Promise<AdminJobCategory[]> {
    const rows = await this.prisma.jobCategory.findMany({
      select: {
        id: true,
        slug: true,
        nameEn: true,
        nameHi: true,
        nameAr: true,
        isActive: true,
        _count: { select: { jobs: true } },
      },
      orderBy: { nameEn: 'asc' },
    });
    return rows.map(({ _count, ...c }) => ({ ...c, jobCount: _count.jobs }));
  }

  async create(dto: CreateJobCategoryDto): Promise<AdminJobCategory> {
    try {
      const created = await this.prisma.jobCategory.create({
        data: {
          slug: dto.slug,
          nameEn: dto.nameEn.trim(),
          nameHi: normalize(dto.nameHi),
          nameAr: normalize(dto.nameAr),
          isActive: dto.isActive ?? true,
        },
      });
      return { ...created, jobCount: 0 };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({ code: 'CATEGORY_SLUG_TAKEN' });
      }
      throw err;
    }
  }

  async update(id: string, dto: UpdateJobCategoryDto): Promise<AdminJobCategory> {
    await this.getOrThrow(id);
    const updated = await this.prisma.jobCategory.update({
      where: { id },
      data: {
        ...(dto.nameEn !== undefined ? { nameEn: dto.nameEn.trim() } : {}),
        ...(dto.nameHi !== undefined ? { nameHi: normalize(dto.nameHi) } : {}),
        ...(dto.nameAr !== undefined ? { nameAr: normalize(dto.nameAr) } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
      select: {
        id: true,
        slug: true,
        nameEn: true,
        nameHi: true,
        nameAr: true,
        isActive: true,
        _count: { select: { jobs: true } },
      },
    });
    const { _count, ...c } = updated;
    return { ...c, jobCount: _count.jobs };
  }

  /**
   * Hard-delete — allowed ONLY when nothing depends on the row. `jobs.categoryId`
   * is onDelete: Restrict, so a category with jobs cannot be deleted (the UI
   * steers such a case to deactivate instead). Candidate references are
   * onDelete: SetNull, so they do not block. The `other` row is never deletable.
   */
  async remove(id: string): Promise<void> {
    const category = await this.getOrThrow(id);
    if (category.slug === PROTECTED_SLUG) {
      throw new ConflictException({ code: 'CATEGORY_PROTECTED' });
    }
    const jobCount = await this.prisma.job.count({ where: { categoryId: id } });
    if (jobCount > 0) {
      throw new ConflictException({ code: 'CATEGORY_IN_USE' });
    }
    await this.prisma.jobCategory.delete({ where: { id } });
  }

  private async getOrThrow(id: string) {
    const category = await this.prisma.jobCategory.findUnique({
      where: { id },
      select: { id: true, slug: true },
    });
    if (!category) throw new NotFoundException({ code: 'CATEGORY_NOT_FOUND' });
    return category;
  }
}

/** Blank translations are stored as NULL, not '' — the UI falls back to EN on null. */
function normalize(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
