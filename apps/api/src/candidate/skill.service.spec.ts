/**
 * Integration tests for SkillService against a real Postgres container.
 *
 * Covers: create (including idempotent duplicate), delete, ownership enforcement
 * (IDOR â†’ 404), and recompute propagation. When Docker is unavailable the suite
 * passes with skipped tests.
 */
import { NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaClient, UserRole, UserStatus } from '@prisma/client';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { execSync } from 'child_process';
import * as path from 'path';
import { SkillService } from './skill.service';
import { CompletionService } from './completion/completion.service';
import { PrismaService } from '../core/prisma/prisma.service';

jest.setTimeout(180_000);

const API_DIR = path.resolve(__dirname, '../..');

let pg: StartedTestContainer;
let prisma: PrismaClient;
let skillService: SkillService;
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
    skillService = new SkillService(prisma as unknown as PrismaService, completionService, {
      emit: jest.fn(),
      emitAsync: jest.fn(),
    } as unknown as EventEmitter2);
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
      console.warn('[integration] Docker or infra unavailable â€” skill tests skipped:', msg);
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

async function makeCandidate(userId: string) {
  return prisma.candidateProfile.create({
    data: { userId, fullName: '' },
  });
}

// â”€â”€â”€ Tests â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('SkillService â€” integration (real DB)', () => {
  // â”€â”€ create â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  it('create: inserts a skill and returns it', async () => {
    if (dockerUnavailable) return;
    const { id: userId } = await makeUser();
    const { id: candidateId } = await makeCandidate(userId);

    const skill = await skillService.create(candidateId, { name: 'Welding' });

    expect(skill.id).toBeTruthy();
    expect(skill.candidateId).toBe(candidateId);
    expect(skill.name).toBe('Welding');

    const row = await prisma.candidateSkill.findUnique({ where: { id: skill.id } });
    expect(row).not.toBeNull();
  });

  it('create: completionPct reflects 1 skill (â‰ˆ3% â€” more than 0)', async () => {
    if (dockerUnavailable) return;
    const { id: userId } = await makeUser();
    const { id: candidateId } = await makeCandidate(userId);

    await skillService.create(candidateId, { name: 'Welding' });

    const profile = await prisma.candidateProfile.findUnique({ where: { id: candidateId } });
    // 10 / 3 â‰ˆ 3.33 â†’ rounds to 3
    expect(profile!.completionPct).toBe(3);
  });

  // â”€â”€ idempotent duplicate â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  it('create (duplicate): returns existing row when (candidateId, name) already exists', async () => {
    if (dockerUnavailable) return;
    const { id: userId } = await makeUser();
    const { id: candidateId } = await makeCandidate(userId);

    const first = await skillService.create(candidateId, { name: 'Welding' });
    const second = await skillService.create(candidateId, { name: 'Welding' });

    expect(second.id).toBe(first.id);
  });

  it('create (duplicate): does NOT create a second row â€” count stays at 1', async () => {
    if (dockerUnavailable) return;
    const { id: userId } = await makeUser();
    const { id: candidateId } = await makeCandidate(userId);

    await skillService.create(candidateId, { name: 'Welding' });
    await skillService.create(candidateId, { name: 'Welding' });

    const count = await prisma.candidateSkill.count({ where: { candidateId } });
    expect(count).toBe(1);
  });

  // â”€â”€ remove â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  it('remove: deletes the skill from the DB', async () => {
    if (dockerUnavailable) return;
    const { id: userId } = await makeUser();
    const { id: candidateId } = await makeCandidate(userId);

    const skill = await skillService.create(candidateId, { name: 'Welding' });
    await skillService.remove(candidateId, skill.id);

    const row = await prisma.candidateSkill.findUnique({ where: { id: skill.id } });
    expect(row).toBeNull();
  });

  it('remove: completionPct drops back to 0 after deleting the only skill', async () => {
    if (dockerUnavailable) return;
    const { id: userId } = await makeUser();
    const { id: candidateId } = await makeCandidate(userId);

    const skill = await skillService.create(candidateId, { name: 'Welding' });
    const mid = await prisma.candidateProfile.findUnique({ where: { id: candidateId } });
    expect(mid!.completionPct).toBeGreaterThan(0);

    await skillService.remove(candidateId, skill.id);

    const final = await prisma.candidateProfile.findUnique({ where: { id: candidateId } });
    expect(final!.completionPct).toBe(0);
  });

  // â”€â”€ IDOR â€” remove â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  it("remove (IDOR): candidate A cannot delete candidate B's skill â†’ 404", async () => {
    if (dockerUnavailable) return;
    const { id: userAId } = await makeUser();
    const { id: userBId } = await makeUser();
    const { id: candidateAId } = await makeCandidate(userAId);
    const { id: candidateBId } = await makeCandidate(userBId);

    const skillB = await skillService.create(candidateBId, { name: 'Driving' });

    await expect(skillService.remove(candidateAId, skillB.id)).rejects.toThrow(NotFoundException);
  });

  it("remove (IDOR): victim's skill row still exists after a failed cross-candidate delete", async () => {
    if (dockerUnavailable) return;
    const { id: userAId } = await makeUser();
    const { id: userBId } = await makeUser();
    const { id: candidateAId } = await makeCandidate(userAId);
    const { id: candidateBId } = await makeCandidate(userBId);

    const skillB = await skillService.create(candidateBId, { name: 'Driving' });

    try {
      await skillService.remove(candidateAId, skillB.id);
    } catch {
      // expected 404
    }

    const rowAfter = await prisma.candidateSkill.findUnique({ where: { id: skillB.id } });
    expect(rowAfter).not.toBeNull();
  });

  // â”€â”€ Not-found â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  it('remove: non-existent skill id â†’ 404', async () => {
    if (dockerUnavailable) return;
    const { id: userId } = await makeUser();
    const { id: candidateId } = await makeCandidate(userId);

    await expect(skillService.remove(candidateId, 'non-existent-id')).rejects.toThrow(
      NotFoundException,
    );
  });

  // â”€â”€ Three-skill cap on completionPct â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  it('3 skills â†’ completionPct gains 10 from skills section (cap enforced in compute)', async () => {
    if (dockerUnavailable) return;
    const { id: userId } = await makeUser();
    const { id: candidateId } = await makeCandidate(userId);

    await skillService.create(candidateId, { name: 'Welding' });
    await skillService.create(candidateId, { name: 'Driving' });
    await skillService.create(candidateId, { name: 'Cooking' });

    const profile = await prisma.candidateProfile.findUnique({ where: { id: candidateId } });
    expect(profile!.completionPct).toBe(10);
  });

  it('adding a 4th skill does not increase completionPct beyond the 3-skill cap', async () => {
    if (dockerUnavailable) return;
    const { id: userId } = await makeUser();
    const { id: candidateId } = await makeCandidate(userId);

    await skillService.create(candidateId, { name: 'Welding' });
    await skillService.create(candidateId, { name: 'Driving' });
    await skillService.create(candidateId, { name: 'Cooking' });
    const atCap = await prisma.candidateProfile.findUnique({ where: { id: candidateId } });

    await skillService.create(candidateId, { name: 'Plumbing' });
    const afterFour = await prisma.candidateProfile.findUnique({ where: { id: candidateId } });

    expect(afterFour!.completionPct).toBe(atCap!.completionPct);
  });
});

