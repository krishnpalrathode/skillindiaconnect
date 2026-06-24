import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CandidateController } from './candidate.controller';
import { CandidateService } from './candidate.service';
import { ExperienceService } from './experience.service';
import { SkillService } from './skill.service';

const MOCK_CANDIDATE_USER = {
  userId: 'user-1',
  role: UserRole.CANDIDATE,
  jti: 'jti-1',
  exp: 9999999999,
};

const MOCK_EMPLOYER_USER = {
  userId: 'user-2',
  role: UserRole.EMPLOYER,
  jti: 'jti-2',
  exp: 9999999999,
};

const MOCK_SELF_DTO = {
  id: 'cand-1',
  userId: 'user-1',
  fullName: 'Test User',
  completionPct: 0,
};

describe('CandidateController', () => {
  let controller: CandidateController;
  let candidateMock: jest.Mocked<
    Pick<
      CandidateService,
      | 'assertCandidateRole'
      | 'getProfileByUserId'
      | 'updateProfile'
      | 'getCompletion'
      | 'updateSettings'
      | 'getCandidateIdByUserId'
    >
  >;
  let experienceMock: jest.Mocked<Pick<ExperienceService, 'create' | 'update' | 'remove'>>;
  let skillMock: jest.Mocked<Pick<SkillService, 'create' | 'remove'>>;

  beforeEach(async () => {
    candidateMock = {
      assertCandidateRole: jest.fn(),
      getProfileByUserId: jest.fn().mockResolvedValue(MOCK_SELF_DTO),
      updateProfile: jest.fn().mockResolvedValue(MOCK_SELF_DTO),
      getCompletion: jest
        .fn()
        .mockResolvedValue({ pct: 0, sections: [], canApply: false, missingForApply: [] }),
      updateSettings: jest.fn().mockResolvedValue(MOCK_SELF_DTO),
      getCandidateIdByUserId: jest.fn().mockResolvedValue('cand-1'),
    };

    experienceMock = {
      create: jest.fn().mockResolvedValue({ id: 'exp-1' }),
      update: jest.fn().mockResolvedValue({ id: 'exp-1' }),
      remove: jest.fn().mockResolvedValue(undefined),
    };

    skillMock = {
      create: jest.fn().mockResolvedValue({ id: 'skill-1', name: 'Welding' }),
      remove: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CandidateController],
      providers: [
        { provide: CandidateService, useValue: candidateMock },
        { provide: ExperienceService, useValue: experienceMock },
        { provide: SkillService, useValue: skillMock },
      ],
    }).compile();

    controller = module.get(CandidateController);
  });

  // ── Non-candidate role → 403 ──────────────────────────────────────────────

  it('GET /candidates/me throws 403 for EMPLOYER (assertCandidateRole wired)', async () => {
    candidateMock.assertCandidateRole.mockImplementationOnce(() => {
      throw new ForbiddenException({ code: 'FORBIDDEN_ROLE' });
    });
    await expect(controller.getMe(MOCK_EMPLOYER_USER)).rejects.toThrow(ForbiddenException);
  });

  // ── GET /candidates/me ────────────────────────────────────────────────────

  it('returns { data: CandidateSelfDto }', async () => {
    const result = await controller.getMe(MOCK_CANDIDATE_USER);
    expect(result).toEqual({ data: MOCK_SELF_DTO });
    expect(candidateMock.getProfileByUserId).toHaveBeenCalledWith('user-1');
  });

  // ── PATCH /candidates/me ──────────────────────────────────────────────────

  it('returns { data: CandidateSelfDto } after profile update', async () => {
    const dto = { fullName: 'Updated Name' };
    const result = await controller.updateMe(MOCK_CANDIDATE_USER, dto);
    expect(result).toEqual({ data: MOCK_SELF_DTO });
    expect(candidateMock.updateProfile).toHaveBeenCalledWith('user-1', dto);
  });

  it('throws 422 when jobCategoryId is invalid (propagated from service)', async () => {
    const { UnprocessableEntityException } = await import('@nestjs/common');
    candidateMock.updateProfile.mockRejectedValue(
      new UnprocessableEntityException({ code: 'INVALID_JOB_CATEGORY' }),
    );
    await expect(
      controller.updateMe(MOCK_CANDIDATE_USER, { jobCategoryId: 'bad-uuid' }),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  // ── GET /candidates/me/completion ─────────────────────────────────────────

  it('returns completion data with canApply + missingForApply', async () => {
    const result = await controller.getCompletion(MOCK_CANDIDATE_USER);
    expect(result.data).toHaveProperty('pct');
    expect(result.data).toHaveProperty('canApply');
    expect(result.data).toHaveProperty('missingForApply');
  });

  // ── PATCH /candidates/me/settings ─────────────────────────────────────────

  it('returns { data: CandidateSelfDto } after settings update', async () => {
    const result = await controller.updateSettings(MOCK_CANDIDATE_USER, { showPhone: false });
    expect(result).toEqual({ data: MOCK_SELF_DTO });
  });

  // ── POST /candidates/me/experiences ───────────────────────────────────────

  it('creates experience and returns { data: experience }', async () => {
    const dto = {
      type: 'INDIA' as const,
      country: 'India',
      companyName: 'ABC',
      role: 'Dev',
      years: 2,
    };
    const result = await controller.createExperience(MOCK_CANDIDATE_USER, dto);
    expect(result).toEqual({ data: { id: 'exp-1' } });
    expect(experienceMock.create).toHaveBeenCalledWith('cand-1', dto);
  });

  // ── PATCH /candidates/me/experiences/:id ──────────────────────────────────

  it('updates experience and returns { data: experience }', async () => {
    const dto = { role: 'Senior Dev' };
    const result = await controller.updateExperience(MOCK_CANDIDATE_USER, 'exp-1', dto);
    expect(result).toEqual({ data: { id: 'exp-1' } });
    expect(experienceMock.update).toHaveBeenCalledWith('cand-1', 'exp-1', dto);
  });

  // ── DELETE /candidates/me/experiences/:id ─────────────────────────────────

  it('deletes experience (204 no body)', async () => {
    const result = await controller.deleteExperience(MOCK_CANDIDATE_USER, 'exp-1');
    expect(result).toBeUndefined();
    expect(experienceMock.remove).toHaveBeenCalledWith('cand-1', 'exp-1');
  });

  // ── POST /candidates/me/skills ────────────────────────────────────────────

  it('creates skill and returns { data: skill }', async () => {
    const result = await controller.createSkill(MOCK_CANDIDATE_USER, { name: 'Welding' });
    expect(result).toEqual({ data: { id: 'skill-1', name: 'Welding' } });
  });

  // ── DELETE /candidates/me/skills/:id ─────────────────────────────────────

  it('deletes skill (204 no body)', async () => {
    const result = await controller.deleteSkill(MOCK_CANDIDATE_USER, 'skill-1');
    expect(result).toBeUndefined();
    expect(skillMock.remove).toHaveBeenCalledWith('cand-1', 'skill-1');
  });
});
