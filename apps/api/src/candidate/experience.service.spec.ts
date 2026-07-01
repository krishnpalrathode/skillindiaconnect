/**
 * Integration tests for ExperienceService against a real Postgres container.
 *
 * Covers: create, update, delete, ownership enforcement (IDOR â†’ 404), and
 * recompute propagation. Uses Testcontainers so no shared state leaks between
 * CI runs. When Docker is unavailable the suite passes with skipped tests.
 */
import { NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaClient, UserRole, UserStatus, ExperienceType } from '@prisma/client';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { execSync } from 'child_process';
import * as path from 'path';
import { ExperienceService } from './experience.service';
import { CompletionService } from './completion/completion.service';
import { PrismaService } from '../core/prisma/prisma.service';

jest.setTimeout(180_000);

const API_DIR = path.resolve(__dirname, '../..');

let pg: StartedTestContainer;
let prisma: PrismaClient;
let experienceService: ExperienceService;
let dockerUnavailable = false;

// â”€â”€â”€ Container lifecycle â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

beforeAll(async () => {
  try {
    pg = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({
        POSTGRES_USER: 'sic',
        POSTGRES_PASSWORD: 'sic',
        POSTGRES_DB: 'sic_test',
      })
      .withExposedPorts(5432)
      .start();

    const url = `postgresql://sic:sic@localhost:${pg.getMappedPort(5432)}/sic_test`;

    execSync('pnpm exec prisma migrate deploy', {
      cwd: API_DIR,
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
    });

    prisma = new PrismaClient({ datasources: { db: { url } } });
    await prisma.$connect();

    const completionService = new CompletionService(prisma as unknown as PrismaService);
    experienceService = new ExperienceService(
      prisma as unknown as PrismaService,
      completionService,
      { emit: jest.fn(), emitAsync: jest.fn() } as unknown as EventEmitter2,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes('container runtime') ||
      msg.includes('Docker') ||
      msg.includes('ENOENT') ||
      msg.includes('connect ECONNREFUSED') ||
      msg.includes('not recognized') ||
      msg.includes('prisma: command not found')
    ) {
      dockerUnavailable = true;
      console.warn('[integration] Docker unavailable â€” experience tests skipped:', msg);
    } else {
      throw err;
    }
  }
});

afterAll(async () => {
  await prisma?.$disconnect();
  await pg?.stop();
});

beforeEach(async () => {
  if (dockerUnavailable) return;
  // Cascade: deleting users drops candidate_profiles â†’ work_experiences.
  await prisma.user.deleteMany();
});

// â”€â”€â”€ Factories â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function makeUser() {
  return prisma.user.create({
    data: {
      email: `u-${Date.now()}-${Math.random().toString(36).slice(2)}@test.com`,
      role: UserRole.CANDIDATE,
      status: UserStatus.ACTIVE,
    },
  });
}

async function makeCandidate(userId: string, overrides: Record<string, unknown> = {}) {
  return prisma.candidateProfile.create({
    data: { userId, fullName: '', ...overrides },
  });
}

const COMPLETE_EXP_DTO = {
  type: ExperienceType.INDIA,
  country: 'India',
  companyName: 'Acme Corp',
  role: 'Engineer',
  years: 2,
};

// â”€â”€â”€ Tests â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('ExperienceService â€” integration (real DB)', () => {
  // â”€â”€ create â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  it('create: inserts a work experience and returns it', async () => {
    if (dockerUnavailable) return;
    const { id: userId } = await makeUser();
    const { id: candidateId } = await makeCandidate(userId);

    const exp = await experienceService.create(candidateId, COMPLETE_EXP_DTO);

    expect(exp.id).toBeTruthy();
    expect(exp.candidateId).toBe(candidateId);
    expect(exp.companyName).toBe('Acme Corp');
    expect(exp.role).toBe('Engineer');

    const row = await prisma.workExperience.findUnique({ where: { id: exp.id } });
    expect(row).not.toBeNull();
  });

  it('create: completionPct moves from 0 to 20 when first complete experience is added', async () => {
    if (dockerUnavailable) return;
    const { id: userId } = await makeUser();
    const { id: candidateId } = await makeCandidate(userId);

    const before = await prisma.candidateProfile.findUnique({ where: { id: candidateId } });
    expect(before!.completionPct).toBe(0);

    await experienceService.create(candidateId, COMPLETE_EXP_DTO);

    const after = await prisma.candidateProfile.findUnique({ where: { id: candidateId } });
    expect(after!.completionPct).toBe(20);
  });

  it('create: months defaults to 0 when not provided', async () => {
    if (dockerUnavailable) return;
    const { id: userId } = await makeUser();
    const { id: candidateId } = await makeCandidate(userId);

    const exp = await experienceService.create(candidateId, COMPLETE_EXP_DTO);
    expect(exp.months).toBe(0);
  });

  // â”€â”€ update â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  it('update: modifies a field and persists it', async () => {
    if (dockerUnavailable) return;
    const { id: userId } = await makeUser();
    const { id: candidateId } = await makeCandidate(userId);

    const exp = await experienceService.create(candidateId, COMPLETE_EXP_DTO);
    const updated = await experienceService.update(candidateId, exp.id, {
      role: 'Senior Engineer',
    });

    expect(updated.role).toBe('Senior Engineer');
    const row = await prisma.workExperience.findUnique({ where: { id: exp.id } });
    expect(row!.role).toBe('Senior Engineer');
  });

  it('update: clearing role makes the entry incomplete â†’ recomputes completionPct to 0', async () => {
    if (dockerUnavailable) return;
    const { id: userId } = await makeUser();
    const { id: candidateId } = await makeCandidate(userId);

    await experienceService.create(candidateId, COMPLETE_EXP_DTO);
    const after = await prisma.candidateProfile.findUnique({ where: { id: candidateId } });
    expect(after!.completionPct).toBe(20); // baseline

    // The experience we'll update is the one we just created.
    const [exp] = await prisma.workExperience.findMany({ where: { candidateId } });
    await experienceService.update(candidateId, exp!.id, { role: '' });

    const recomputed = await prisma.candidateProfile.findUnique({ where: { id: candidateId } });
    expect(recomputed!.completionPct).toBe(0);
  });

  // â”€â”€ remove â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  it('remove: deletes the experience from the DB', async () => {
    if (dockerUnavailable) return;
    const { id: userId } = await makeUser();
    const { id: candidateId } = await makeCandidate(userId);

    const exp = await experienceService.create(candidateId, COMPLETE_EXP_DTO);
    await experienceService.remove(candidateId, exp.id);

    const row = await prisma.workExperience.findUnique({ where: { id: exp.id } });
    expect(row).toBeNull();
  });

  it('remove: completionPct drops from 20 to 0 when the last experience is deleted', async () => {
    if (dockerUnavailable) return;
    const { id: userId } = await makeUser();
    const { id: candidateId } = await makeCandidate(userId);

    const exp = await experienceService.create(candidateId, COMPLETE_EXP_DTO);
    const mid = await prisma.candidateProfile.findUnique({ where: { id: candidateId } });
    expect(mid!.completionPct).toBe(20);

    await experienceService.remove(candidateId, exp.id);

    const final = await prisma.candidateProfile.findUnique({ where: { id: candidateId } });
    expect(final!.completionPct).toBe(0);
  });

  // â”€â”€ IDOR â€” update â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  it("update (IDOR): candidate A cannot update candidate B's experience â†’ 404", async () => {
    if (dockerUnavailable) return;
    const { id: userAId } = await makeUser();
    const { id: userBId } = await makeUser();
    const { id: candidateAId } = await makeCandidate(userAId);
    const { id: candidateBId } = await makeCandidate(userBId);

    const expB = await experienceService.create(candidateBId, COMPLETE_EXP_DTO);

    await expect(
      experienceService.update(candidateAId, expB.id, { role: 'Hacked' }),
    ).rejects.toThrow(NotFoundException);
  });

  it("update (IDOR): victim's row is unchanged after a failed cross-candidate update", async () => {
    if (dockerUnavailable) return;
    const { id: userAId } = await makeUser();
    const { id: userBId } = await makeUser();
    const { id: candidateAId } = await makeCandidate(userAId);
    const { id: candidateBId } = await makeCandidate(userBId);

    const expB = await experienceService.create(candidateBId, COMPLETE_EXP_DTO);
    const roleBefore = expB.role;

    try {
      await experienceService.update(candidateAId, expB.id, { role: 'Hacked' });
    } catch {
      // expected 404
    }

    const rowAfter = await prisma.workExperience.findUnique({ where: { id: expB.id } });
    expect(rowAfter!.role).toBe(roleBefore);
  });

  // â”€â”€ IDOR â€” remove â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  it("remove (IDOR): candidate A cannot delete candidate B's experience â†’ 404", async () => {
    if (dockerUnavailable) return;
    const { id: userAId } = await makeUser();
    const { id: userBId } = await makeUser();
    const { id: candidateAId } = await makeCandidate(userAId);
    const { id: candidateBId } = await makeCandidate(userBId);

    const expB = await experienceService.create(candidateBId, COMPLETE_EXP_DTO);

    await expect(experienceService.remove(candidateAId, expB.id)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("remove (IDOR): victim's experience row still exists after a failed cross-candidate delete", async () => {
    if (dockerUnavailable) return;
    const { id: userAId } = await makeUser();
    const { id: userBId } = await makeUser();
    const { id: candidateAId } = await makeCandidate(userAId);
    const { id: candidateBId } = await makeCandidate(userBId);

    const expB = await experienceService.create(candidateBId, COMPLETE_EXP_DTO);

    try {
      await experienceService.remove(candidateAId, expB.id);
    } catch {
      // expected 404
    }

    const rowAfter = await prisma.workExperience.findUnique({ where: { id: expB.id } });
    expect(rowAfter).not.toBeNull();
  });

  // â”€â”€ Not-found â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  it('update: non-existent experience id â†’ 404', async () => {
    if (dockerUnavailable) return;
    const { id: userId } = await makeUser();
    const { id: candidateId } = await makeCandidate(userId);

    await expect(
      experienceService.update(candidateId, 'non-existent-id', { role: 'X' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('remove: non-existent experience id â†’ 404', async () => {
    if (dockerUnavailable) return;
    const { id: userId } = await makeUser();
    const { id: candidateId } = await makeCandidate(userId);

    await expect(experienceService.remove(candidateId, 'non-existent-id')).rejects.toThrow(
      NotFoundException,
    );
  });
});

