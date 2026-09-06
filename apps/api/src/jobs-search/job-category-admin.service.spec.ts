import { Test, TestingModule } from '@nestjs/testing';
import { HttpException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { JobCategoryAdminService } from './job-category-admin.service';
import { PrismaService } from '../core/prisma/prisma.service';

/** Assert a rejection is the given HttpException type carrying `{ code }`. */
async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
    throw new Error('expected the call to reject, but it resolved');
  } catch (err) {
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getResponse()).toMatchObject({ code });
  }
}

describe('JobCategoryAdminService', () => {
  let service: JobCategoryAdminService;
  let prisma: {
    jobCategory: {
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
      findUnique: jest.Mock;
    };
    job: { count: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      jobCategory: {
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        findUnique: jest.fn(),
      },
      job: { count: jest.fn() },
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [JobCategoryAdminService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(JobCategoryAdminService);
  });

  it('listAll flattens _count.jobs into jobCount', async () => {
    prisma.jobCategory.findMany.mockResolvedValue([
      {
        id: '1',
        slug: 'welder',
        nameEn: 'Welder',
        nameHi: null,
        nameAr: null,
        isActive: true,
        _count: { jobs: 3 },
      },
    ]);
    await expect(service.listAll()).resolves.toEqual([
      {
        id: '1',
        slug: 'welder',
        nameEn: 'Welder',
        nameHi: null,
        nameAr: null,
        isActive: true,
        jobCount: 3,
      },
    ]);
  });

  it('create trims names, nulls blank translations, and defaults isActive to true', async () => {
    prisma.jobCategory.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ id: '2', ...data }),
    );
    const res = await service.create({ slug: 'rigger', nameEn: '  Rigger ', nameHi: '   ' });
    expect(prisma.jobCategory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          slug: 'rigger',
          nameEn: 'Rigger',
          nameHi: null,
          nameAr: null,
          isActive: true,
        }),
      }),
    );
    expect(res.jobCount).toBe(0);
  });

  it('create maps a duplicate slug (P2002) to 409 CATEGORY_SLUG_TAKEN', async () => {
    prisma.jobCategory.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
    );
    await expectCode(service.create({ slug: 'welder', nameEn: 'Welder' }), 'CATEGORY_SLUG_TAKEN');
  });

  it('remove refuses the protected "other" slug and never calls delete', async () => {
    prisma.jobCategory.findUnique.mockResolvedValue({ id: 'o', slug: 'other' });
    await expectCode(service.remove('o'), 'CATEGORY_PROTECTED');
    expect(prisma.jobCategory.delete).not.toHaveBeenCalled();
  });

  it('remove refuses a category still referenced by jobs (deactivate instead)', async () => {
    prisma.jobCategory.findUnique.mockResolvedValue({ id: '1', slug: 'welder' });
    prisma.job.count.mockResolvedValue(2);
    await expectCode(service.remove('1'), 'CATEGORY_IN_USE');
    expect(prisma.jobCategory.delete).not.toHaveBeenCalled();
  });

  it('remove hard-deletes an unused, non-protected category', async () => {
    prisma.jobCategory.findUnique.mockResolvedValue({ id: '1', slug: 'welder' });
    prisma.job.count.mockResolvedValue(0);
    prisma.jobCategory.delete.mockResolvedValue({});
    await service.remove('1');
    expect(prisma.jobCategory.delete).toHaveBeenCalledWith({ where: { id: '1' } });
  });

  it('remove throws NotFound for a missing id', async () => {
    prisma.jobCategory.findUnique.mockResolvedValue(null);
    await expect(service.remove('nope')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('update rejects an unknown id before writing', async () => {
    prisma.jobCategory.findUnique.mockResolvedValue(null);
    await expect(service.update('nope', { nameEn: 'X' })).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.jobCategory.update).not.toHaveBeenCalled();
  });
});
