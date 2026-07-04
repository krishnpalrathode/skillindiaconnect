/**
 * Unit tests for CandidateViewService.
 *
 * Focus: fire-and-forget proof, approved-guard, anti-enumeration 404,
 * browse-only-visible. All dependencies are mocked (no DB).
 */

import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CompanyStatus, CompanyType, UserStatus } from '@prisma/client';
import { CandidateViewService } from './candidate-view.service';
import { EmployerService } from './employer.service';
import { CandidateReadService } from '../candidate/candidate-read.service';
import { ProfileViewService } from './profile-view.service';
import { StorageService } from '../core/storage/storage.service';

// ── Fixture builders ──────────────────────────────────────────────────────────

const makeCompany = (overrides: Partial<{ status: CompanyStatus }> = {}) => ({
  id: 'company-uuid',
  name: 'Gulf Builders',
  type: CompanyType.FOREIGN,
  status: CompanyStatus.APPROVED,
  registrationNumber: 'GB001',
  industryType: 'Construction',
  phone: '+966',
  location: 'Riyadh',
  employeeRange: '201-500',
  languagePref: [],
  logoKey: null,
  description: null,
  website: null,
  rejectionReason: null,
  approvedAt: new Date(),
  reviewedById: null,
  suspendedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const makeCandidate = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'cand-uuid',
  userId: 'user-cand',
  fullName: 'Ravi Kumar',
  dob: new Date('1992-04-01'),
  phone: '+919876543210',
  religion: null,
  languages: ['en', 'hi'],
  jobCategoryId: 'cat-uuid',
  photoKey: null,
  currentLocation: 'Mumbai',
  nationality: 'Indian',
  noticePeriod: 30,
  salaryExpectationMin: 50000,
  salaryExpectationMax: null,
  salaryExpectationCurrency: 'INR',
  isAvailable: true,
  completionPct: 80,
  showPhone: true,
  showReligion: false,
  createdAt: new Date('2024-01-01'),
  experiences: [],
  skills: [],
  documents: [],
  ...overrides,
});

// ── Setup ─────────────────────────────────────────────────────────────────────

describe('CandidateViewService', () => {
  let service: CandidateViewService;
  let mockEmployerService: jest.Mocked<Pick<EmployerService, 'getCompanyForEmployerUser'>>;
  let mockCandidateReadService: jest.Mocked<
    Pick<CandidateReadService, 'findVisibleCandidateForEmployerView' | 'browseVisibleCandidates'>
  >;
  let mockProfileViewService: jest.Mocked<Pick<ProfileViewService, 'recordView'>>;
  let mockStorage: jest.Mocked<Pick<StorageService, 'presignGet'>>;

  beforeEach(() => {
    mockEmployerService = {
      getCompanyForEmployerUser: jest.fn().mockResolvedValue(makeCompany()),
    };
    mockCandidateReadService = {
      findVisibleCandidateForEmployerView: jest.fn().mockResolvedValue(makeCandidate()),
      browseVisibleCandidates: jest.fn().mockResolvedValue({ data: [], nextCursor: null }),
    };
    mockProfileViewService = {
      recordView: jest.fn().mockResolvedValue(undefined),
    };
    mockStorage = {
      presignGet: jest.fn().mockResolvedValue('https://r2.example/photo.jpg'),
    };

    service = new CandidateViewService(
      mockEmployerService as unknown as EmployerService,
      mockCandidateReadService as unknown as CandidateReadService,
      mockProfileViewService as unknown as ProfileViewService,
      mockStorage as unknown as StorageService,
    );
  });

  // ── Approved guard ────────────────────────────────────────────────────────

  it('viewCandidate: unapproved company → 403 EMPLOYER_NOT_APPROVED', async () => {
    mockEmployerService.getCompanyForEmployerUser.mockResolvedValue(
      makeCompany({ status: CompanyStatus.PENDING }),
    );
    await expect(service.viewCandidate('user-employer', 'cand-uuid')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('browse: unapproved company → 403 EMPLOYER_NOT_APPROVED', async () => {
    mockEmployerService.getCompanyForEmployerUser.mockResolvedValue(
      makeCompany({ status: CompanyStatus.PENDING }),
    );
    await expect(service.browse('user-employer', {})).rejects.toThrow(ForbiddenException);
  });

  // ── Anti-enumeration 404 ──────────────────────────────────────────────────

  it('viewCandidate: invisible / nonexistent candidate → 404 CANDIDATE_NOT_FOUND', async () => {
    mockCandidateReadService.findVisibleCandidateForEmployerView.mockResolvedValue(null);
    await expect(service.viewCandidate('user-employer', 'nonexistent-uuid')).rejects.toMatchObject({
      response: { code: 'CANDIDATE_NOT_FOUND' },
    });
  });

  it('viewCandidate: 404 error code is identical for invisible vs nonexistent (anti-enumeration)', async () => {
    // Both cases return null from the read service → identical 404
    mockCandidateReadService.findVisibleCandidateForEmployerView.mockResolvedValue(null);
    let err1: unknown;
    try {
      await service.viewCandidate('user-employer', 'invisible-uuid');
    } catch (e) {
      err1 = e;
    }

    let err2: unknown;
    try {
      await service.viewCandidate('user-employer', 'nonexistent-uuid');
    } catch (e) {
      err2 = e;
    }

    // Both are NotFoundException with identical response code
    expect(err1).toBeInstanceOf(NotFoundException);
    expect(err2).toBeInstanceOf(NotFoundException);
    expect((err1 as NotFoundException).getResponse()).toEqual(
      (err2 as NotFoundException).getResponse(),
    );
  });

  // ── Fire-and-forget proof ─────────────────────────────────────────────────

  it('viewCandidate: recordView throws → GET still resolves 200 with full body', async () => {
    mockProfileViewService.recordView.mockRejectedValue(new Error('Redis exploded'));

    // Should NOT throw
    const result = await service.viewCandidate('user-employer', 'cand-uuid');
    expect(result).toBeDefined();
    expect(result.id).toBe('cand-uuid');
    expect(result.fullName).toBe('Ravi Kumar');
  });

  // ── Correct data returned ─────────────────────────────────────────────────

  it('viewCandidate: returns mapped DTO with correct id and fullName', async () => {
    const result = await service.viewCandidate('user-employer', 'cand-uuid');
    expect(result.id).toBe('cand-uuid');
    expect(result.fullName).toBe('Ravi Kumar');
  });

  it('viewCandidate: recordView is called with correct company + candidate ids', async () => {
    await service.viewCandidate('user-employer', 'cand-uuid');
    // Wait for the fire-and-forget microtask to resolve
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(mockProfileViewService.recordView).toHaveBeenCalledWith(
      'company-uuid',
      'Gulf Builders',
      'cand-uuid',
      'user-cand',
    );
  });

  it('browse: passes filters to CandidateReadService and returns data + nextCursor', async () => {
    mockCandidateReadService.browseVisibleCandidates.mockResolvedValue({
      data: [
        {
          id: 'c1',
          fullName: 'Ali',
          photoKey: null,
          jobCategoryId: 'cat-1',
          currentLocation: 'Mumbai',
          isAvailable: true,
          completionPct: 70,
          updatedAt: new Date(),
          totalExperienceYears: 2.5,
          hasForeignExperience: false,
          skills: [{ name: 'Welding' }],
        },
      ],
      nextCursor: 'cursor123',
    });

    const result = await service.browse('user-employer', { category: 'cat-1', limit: 10 });
    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.id).toBe('c1');
    expect(result.nextCursor).toBe('cursor123');
    expect(mockCandidateReadService.browseVisibleCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'cat-1', limit: 10 }),
    );
  });
});
