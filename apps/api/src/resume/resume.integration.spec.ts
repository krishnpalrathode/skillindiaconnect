/**
 * S7-B2 integration tests — the resume orchestration + delivery layer against
 * a REAL Postgres and a REAL Redis (the 5/day budget is a Redis counter; a
 * mocked Redis would prove nothing about the cap that actually ships).
 *
 * What these assert, in order of how much it would hurt to get wrong:
 *  1. The API NEVER renders — `generate` enqueues and returns PENDING.
 *  2. The whatsappCapable degradation is HONEST — email really goes out AND
 *     the response says EMAIL_FALLBACK.
 *  3. You cannot deliver a resume that was never rendered (422 on both sends).
 *  4. The 5/day cap actually stops the 6th send.
 *  5. Audits carry the channel and NO phone number / email address.
 *
 * Skips gracefully when Docker is unavailable.
 */
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  NotificationType,
  Prisma,
  PrismaClient,
  ResumeGenerationStatus,
  ResumeTemplate,
  ResumeTrigger,
  UserRole,
} from '@prisma/client';
import { Queue } from 'bullmq';
import { execSync } from 'child_process';
import Redis from 'ioredis';
import * as path from 'path';
import { GenericContainer, StartedTestContainer } from 'testcontainers';
import { PrismaService } from '../core/prisma/prisma.service';
import { StorageService } from '../core/storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS } from '../audit/audit.types';
import { CandidateReadService } from '../candidate/candidate-read.service';
import { NotificationService } from '../notifications/notification.service';
import { ResumeService } from './resume.service';
import { ResumeSettingsService } from './resume-settings.service';
import { ResumeDeliveryService, RESUME_SEND_CAP_PER_DAY } from './resume-delivery.service';
import { ResumeSubscriber } from './resume.subscriber';
import { RESUME_EVENTS } from './resume.events';
import { StoredResumeView } from './resume-view.wire';

jest.setTimeout(240_000);

const API_DIR = path.resolve(__dirname, '../..');

let pg: StartedTestContainer;
let redisContainer: StartedTestContainer;
let prismaClient: PrismaClient;
let redis: Redis;
let resumeService: ResumeService;
let settingsService: ResumeSettingsService;
let deliveryService: ResumeDeliveryService;
let notificationService: NotificationService;
let subscriber: ResumeSubscriber;
let renderQueueAdd: jest.Mock;
let notificationQueueAdd: jest.Mock;
let dockerUnavailable = false;

const CANDIDATE_USER_ID = 'rs-cand-1';
const OTHER_USER_ID = 'rs-cand-2';
const PHONE = '+919812345678';
let candidateId: string;
let otherCandidateId: string;

beforeAll(async () => {
  try {
    [pg, redisContainer] = await Promise.all([
      new GenericContainer('postgres:16-alpine')
        .withEnvironment({
          POSTGRES_USER: 'sic',
          POSTGRES_PASSWORD: 'sic',
          POSTGRES_DB: 'sic_resume_b2',
        })
        .withExposedPorts(5432)
        .start(),
      new GenericContainer('redis:7-alpine').withExposedPorts(6379).start(),
    ]);

    const url = `postgresql://sic:sic@localhost:${pg.getMappedPort(5432)}/sic_resume_b2`;
    execSync('pnpm exec prisma migrate deploy', {
      cwd: API_DIR,
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
    });

    prismaClient = new PrismaClient({ datasources: { db: { url } } });
    await prismaClient.$connect();
    redis = new Redis(`redis://localhost:${redisContainer.getMappedPort(6379)}`);

    await prismaClient.user.create({
      data: { id: CANDIDATE_USER_ID, email: 'rs-cand@example.com', role: UserRole.CANDIDATE },
    });
    candidateId = (
      await prismaClient.candidateProfile.create({
        data: {
          userId: CANDIDATE_USER_ID,
          fullName: 'Suresh Kumar',
          completionPct: 90,
          phone: PHONE,
          whatsappCapable: true,
        },
      })
    ).id;
    await prismaClient.user.create({
      data: { id: OTHER_USER_ID, email: 'rs-other@example.com', role: UserRole.CANDIDATE },
    });
    otherCandidateId = (
      await prismaClient.candidateProfile.create({
        data: { userId: OTHER_USER_ID, fullName: 'Other Candidate', completionPct: 40 },
      })
    ).id;

    const prismaSvc = prismaClient as unknown as PrismaService;
    renderQueueAdd = jest.fn();
    notificationQueueAdd = jest.fn();
    const storage = {
      presignGet: jest.fn(async (key: string) => `https://signed.example/${key}`),
    } as unknown as StorageService;
    const candidateRead = new CandidateReadService(prismaSvc);
    const audit = new AuditService(prismaSvc);
    notificationService = new NotificationService(prismaSvc, {
      add: notificationQueueAdd,
    } as unknown as Queue);
    settingsService = new ResumeSettingsService(prismaSvc);
    resumeService = new ResumeService(
      prismaSvc,
      storage,
      candidateRead,
      settingsService,
      { add: renderQueueAdd } as unknown as Queue,
    );
    deliveryService = new ResumeDeliveryService(
      redis,
      resumeService,
      notificationService,
      audit,
    );
    subscriber = new ResumeSubscriber(candidateRead, notificationService);
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
      console.warn('[resume-b2] Docker unavailable — tests will be skipped:', msg);
    } else {
      throw err;
    }
  }
});

afterAll(async () => {
  redis?.disconnect();
  await prismaClient?.$disconnect();
  await Promise.all([pg?.stop(), redisContainer?.stop()]);
});

beforeEach(async () => {
  if (dockerUnavailable) return;
  await prismaClient.resumeGeneration.deleteMany();
  await prismaClient.candidateResume.deleteMany();
  await prismaClient.notification.deleteMany();
  await prismaClient.auditLog.deleteMany();
  await redis.flushall();
  await prismaClient.candidateProfile.update({
    where: { id: candidateId },
    data: { phone: PHONE, whatsappCapable: true, waNotifications: true },
  });
  renderQueueAdd.mockClear();
  notificationQueueAdd.mockClear();
});

/** Simulate what the WORKER does when a render completes. */
async function markReady(genId: string, view?: Partial<StoredResumeView>): Promise<void> {
  await prismaClient.resumeGeneration.update({
    where: { id: genId },
    data: {
      status: ResumeGenerationStatus.READY,
      r2Key: `resumes/${candidateId}/abc-resume.pdf`,
      sizeBytes: 12_345,
      contentHash: 'hash',
      generatedAt: new Date(),
      viewSnapshot: {
        fullName: 'Suresh Kumar',
        email: 'rs-cand@example.com',
        photoKey: null,
        dob: null,
        maritalStatus: null,
        nationality: null,
        currentLocation: null,
        languages: [],
        jobCategory: null,
        experiences: [],
        skills: [],
        documents: [],
        hasVideo: false,
        generatedAt: new Date().toISOString(),
        settingsApplied: {
          language: 'en',
          showPhone: true,
          showReligion: false,
          showFatherName: true,
          showPassportNumber: false,
        },
        ...view,
      } as unknown as Prisma.InputJsonValue,
    },
  });
}

const d = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (dockerUnavailable) return;
    await fn();
  });

// ── Settings ────────────────────────────────────────────────────────────────

describe('resume settings', () => {
  d('a candidate who never opened settings gets the S7-0 DEFAULTS, not a 404', async () => {
    const settings = await settingsService.getSettings(candidateId);
    expect(settings).toEqual({
      language: 'en',
      showPhone: true,
      showReligion: false, // OFF by default — the sensitive one
      showFatherName: true,
      showPassportNumber: false, // OFF by default — the sensitive one
      // CR-001 B1. Exhaustive on purpose: toEqual fails when a new setting
      // appears, which is what caught this one. CLASSIC is the default because
      // it is the template every existing resume was already rendered with.
      template: ResumeTemplate.CLASSIC,
    });
  });

  d('PATCH is partial — an omitted toggle keeps its value', async () => {
    await settingsService.updateSettings(candidateId, { showPassportNumber: true });
    const after = await settingsService.updateSettings(candidateId, { showReligion: true });
    expect(after.showPassportNumber).toBe(true); // untouched by the second call
    expect(after.showReligion).toBe(true);
    expect(after.showPhone).toBe(true);
  });

  d('settings apply at the NEXT generate — an existing snapshot is never rewritten', async () => {
    const { generationId } = await resumeService.generate(candidateId);
    const before = await prismaClient.resumeGeneration.findUniqueOrThrow({
      where: { id: generationId },
    });

    await settingsService.updateSettings(candidateId, { showPassportNumber: true });

    const after = await prismaClient.resumeGeneration.findUniqueOrThrow({
      where: { id: generationId },
    });
    // The PATCH did not reach back into the already-enqueued generation. The
    // stored PDF and the settings it was rendered from stay one artifact.
    expect(after.settingsSnapshot).toEqual(before.settingsSnapshot);
    expect((after.settingsSnapshot as { showPassportNumber: boolean }).showPassportNumber).toBe(
      false,
    );
  });

  d('the NEXT generate picks the new settings up', async () => {
    await resumeService.generate(candidateId);
    // Clear the in-flight one so the next call creates a fresh generation.
    await prismaClient.resumeGeneration.deleteMany();
    await settingsService.updateSettings(candidateId, { showPassportNumber: true });

    const { generationId } = await resumeService.generate(candidateId);
    const gen = await prismaClient.resumeGeneration.findUniqueOrThrow({
      where: { id: generationId },
    });
    expect((gen.settingsSnapshot as { showPassportNumber: boolean }).showPassportNumber).toBe(true);
  });

  d('language persists as en and the generate path accepts it (English MVP)', async () => {
    const settings = await settingsService.updateSettings(candidateId, { language: 'en' });
    expect(settings.language).toBe('en');
    const { status } = await resumeService.generate(candidateId);
    expect(status).toBe(ResumeGenerationStatus.PENDING);
    // hi/ar are refused at the DTO (enum-enforced, contract-frozen) rather than
    // accepted-then-quietly-rendered-in-English — see update-resume-settings.dto.ts.
  });
});

// ── Generate / poll ─────────────────────────────────────────────────────────

describe('generate + poll', () => {
  d('generate ENQUEUES the worker render and returns PENDING — it never renders', async () => {
    const result = await resumeService.generate(candidateId, ResumeTrigger.DOWNLOAD);

    expect(result.status).toBe(ResumeGenerationStatus.PENDING);
    expect(renderQueueAdd).toHaveBeenCalledTimes(1);
    const [jobName, data, opts] = renderQueueAdd.mock.calls[0] as [
      string,
      { generationId: string; candidateId: string },
      { jobId: string },
    ];
    expect(jobName).toBe('generate-resume');
    expect(data).toEqual({ generationId: result.generationId, candidateId });
    expect(opts.jobId).toBe(`generate-resume-${result.generationId}`);

    const row = await prismaClient.resumeGeneration.findUniqueOrThrow({
      where: { id: result.generationId },
    });
    // No render happened in-process: the render columns are still empty.
    expect(row.r2Key).toBeNull();
    expect(row.status).toBe(ResumeGenerationStatus.PENDING);
  });

  d('DOUBLE-TAP: a second generate reuses the in-flight one — one render, not N', async () => {
    const first = await resumeService.generate(candidateId);
    const second = await resumeService.generate(candidateId);

    expect(second.generationId).toBe(first.generationId);
    expect(renderQueueAdd).toHaveBeenCalledTimes(1); // NOT enqueued twice
    expect(await prismaClient.resumeGeneration.count()).toBe(1);
  });

  d('a STALE PENDING row does not wedge the candidate forever', async () => {
    // The failure this guards: a generation whose job died (worker killed
    // mid-render, queue flushed, a legacy row predating the lifecycle column)
    // stays PENDING. An unbounded dedupe would hand that dead row back on
    // every Generate — the candidate could never produce a resume again.
    // Found by running the real stack against the dev seed, which had exactly
    // such a row.
    const { generationId: stale } = await resumeService.generate(candidateId);
    await prismaClient.resumeGeneration.update({
      where: { id: stale },
      data: { createdAt: new Date(Date.now() - 10 * 60 * 1000) }, // 10 min old
    });
    renderQueueAdd.mockClear();

    const fresh = await resumeService.generate(candidateId);
    expect(fresh.generationId).not.toBe(stale);
    expect(renderQueueAdd).toHaveBeenCalledTimes(1); // a real render was queued
  });

  d('status: 404 RESUME_NOT_FOUND before anything was ever generated', async () => {
    await expect(resumeService.getStatus(candidateId)).rejects.toMatchObject({
      response: { code: 'RESUME_NOT_FOUND' },
    });
  });

  d('status: PENDING → READY with a short-expiry signed url and the STORED view', async () => {
    const { generationId } = await resumeService.generate(candidateId);

    const pending = await resumeService.getStatus(candidateId);
    expect(pending.status).toBe(ResumeGenerationStatus.PENDING);
    expect(pending.downloadUrl).toBeUndefined(); // nothing to download yet

    await markReady(generationId, { fullName: 'Suresh Kumar' });

    const ready = await resumeService.getStatus(candidateId);
    expect(ready.status).toBe(ResumeGenerationStatus.READY);
    expect(ready.downloadUrl).toContain(`resumes/${candidateId}/`);
    expect(ready.expiresInSeconds).toBe(300);
    expect(ready.generatedAt).toBeTruthy();
    // The view served is the SNAPSHOT the worker stored — not a re-read of the
    // live profile, which would drift from the bytes on the first edit.
    expect(ready.view?.fullName).toBe('Suresh Kumar');
    expect(ready.view?.settingsApplied.showPassportNumber).toBe(false);
  });

  d('status: FAILED surfaces the failure reason so the client can offer a retry', async () => {
    const { generationId } = await resumeService.generate(candidateId);
    await prismaClient.resumeGeneration.update({
      where: { id: generationId },
      data: { status: ResumeGenerationStatus.FAILED, failureReason: 'Rendering failed.' },
    });

    const status = await resumeService.getStatus(candidateId);
    expect(status.status).toBe(ResumeGenerationStatus.FAILED);
    expect(status.failureReason).toBe('Rendering failed.');
    expect(status.downloadUrl).toBeUndefined();
  });

  d('OWN-ONLY: another candidate never sees this resume', async () => {
    const { generationId } = await resumeService.generate(candidateId);
    await markReady(generationId);

    // Same code path, different candidate — 404, because the scope is the
    // candidate id resolved from the token, never a request parameter.
    await expect(resumeService.getStatus(otherCandidateId)).rejects.toMatchObject({
      response: { code: 'RESUME_NOT_FOUND' },
    });
  });

  d('download re-mints a signed url; 404 when no READY resume exists', async () => {
    await expect(resumeService.getDownloadUrl(candidateId)).rejects.toMatchObject({
      response: { code: 'RESUME_NOT_FOUND' },
    });

    const { generationId } = await resumeService.generate(candidateId);
    await markReady(generationId);
    const { url, expiresInSeconds } = await resumeService.getDownloadUrl(candidateId);
    expect(url).toContain('resumes/');
    expect(expiresInSeconds).toBe(300);
  });
});

// ── send-whatsapp: the three stacked gates ──────────────────────────────────

describe('send-whatsapp', () => {
  d('GATE 1 — no READY resume → 422 RESUME_NOT_READY, and no send is enqueued', async () => {
    await expect(
      deliveryService.sendWhatsapp(CANDIDATE_USER_ID, candidateId),
    ).rejects.toMatchObject({
      status: 422,
      response: { code: 'RESUME_NOT_READY' },
    });
    expect(notificationQueueAdd).not.toHaveBeenCalled();

    // A PENDING generation is NOT ready either — you cannot send bytes that
    // don't exist yet.
    await resumeService.generate(candidateId);
    await expect(
      deliveryService.sendWhatsapp(CANDIDATE_USER_ID, candidateId),
    ).rejects.toMatchObject({ response: { code: 'RESUME_NOT_READY' } });
  });

  d('GATE 1 does not consume budget — a blocked send is not a spent send', async () => {
    await expect(
      deliveryService.sendWhatsapp(CANDIDATE_USER_ID, candidateId),
    ).rejects.toMatchObject({ response: { code: 'RESUME_NOT_READY' } });

    const day = new Date().toISOString().slice(0, 10);
    expect(await redis.get(`resume:send:wa:${candidateId}:${day}`)).toBeNull();
  });

  d('CAPABLE → a WhatsApp document send is ENQUEUED (the worker sends, not us)', async () => {
    const { generationId } = await resumeService.generate(candidateId);
    await markReady(generationId);

    const result = await deliveryService.sendWhatsapp(CANDIDATE_USER_ID, candidateId);
    expect(result.delivered).toBe('WHATSAPP');

    // The API enqueued; nothing external was touched in-process.
    const whatsappJobs = notificationQueueAdd.mock.calls.filter(
      (c) => (c[1] as { channel: string }).channel === 'whatsapp',
    );
    expect(whatsappJobs).toHaveLength(1);
    expect((whatsappJobs[0]![1] as { type: NotificationType }).type).toBe(
      NotificationType.RESUME_SENT,
    );
    // RESUME_SENT's matrix row is whatsapp+inApp, email OFF — no email job.
    expect(
      notificationQueueAdd.mock.calls.filter(
        (c) => (c[1] as { channel: string }).channel === 'email',
      ),
    ).toHaveLength(0);
  });

  d('NOT CAPABLE → the response says EMAIL_FALLBACK and an email really goes out', async () => {
    const { generationId } = await resumeService.generate(candidateId);
    await markReady(generationId);
    await prismaClient.candidateProfile.update({
      where: { id: candidateId },
      data: { whatsappCapable: false },
    });

    const result = await deliveryService.sendWhatsapp(CANDIDATE_USER_ID, candidateId);

    // BOTH halves of honesty: the stated channel is the real one...
    expect(result.delivered).toBe('EMAIL_FALLBACK');
    // ...and something was actually enqueued (never a silent no-op). The job
    // reaches the worker's downgrade path, which emails the candidate.
    expect(notificationQueueAdd).toHaveBeenCalled();
    const audit = await prismaClient.auditLog.findFirstOrThrow({
      where: { action: AUDIT_ACTIONS.RESUME_SENT },
    });
    expect((audit.meta as { channel: string }).channel).toBe('EMAIL_FALLBACK');
  });

  d('opted OUT of WhatsApp notifications → also EMAIL_FALLBACK (same predicate)', async () => {
    const { generationId } = await resumeService.generate(candidateId);
    await markReady(generationId);
    await prismaClient.candidateProfile.update({
      where: { id: candidateId },
      data: { waNotifications: false },
    });

    const result = await deliveryService.sendWhatsapp(CANDIDATE_USER_ID, candidateId);
    expect(result.delivered).toBe('EMAIL_FALLBACK');
  });

  d(`GATE 2 — the ${RESUME_SEND_CAP_PER_DAY + 1}th send in a day → 429`, async () => {
    const { generationId } = await resumeService.generate(candidateId);
    await markReady(generationId);

    for (let i = 0; i < RESUME_SEND_CAP_PER_DAY; i++) {
      const r = await deliveryService.sendWhatsapp(CANDIDATE_USER_ID, candidateId);
      expect(r.delivered).toBe('WHATSAPP');
    }

    await expect(
      deliveryService.sendWhatsapp(CANDIDATE_USER_ID, candidateId),
    ).rejects.toMatchObject({
      status: 429,
      response: { code: 'RESUME_SEND_LIMIT_EXCEEDED' },
    });
  });

  d('the audit carries the channel and NO phone number', async () => {
    const { generationId } = await resumeService.generate(candidateId);
    await markReady(generationId);
    await deliveryService.sendWhatsapp(CANDIDATE_USER_ID, candidateId);

    const audit = await prismaClient.auditLog.findFirstOrThrow({
      where: { action: AUDIT_ACTIONS.RESUME_SENT },
    });
    expect(audit.targetId).toBe(generationId);
    expect((audit.meta as { channel: string }).channel).toBe('WHATSAPP');
    expect(JSON.stringify(audit.meta)).not.toContain(PHONE);
    expect(JSON.stringify(audit.meta)).not.toContain('9812345678');
  });
});

// ── send-email (email-to-self) ──────────────────────────────────────────────

describe('send-email', () => {
  d('READY-required → 422 RESUME_NOT_READY', async () => {
    await expect(deliveryService.sendEmail(CANDIDATE_USER_ID, candidateId)).rejects.toMatchObject({
      status: 422,
      response: { code: 'RESUME_NOT_READY' },
    });
  });

  d('enqueues an email to the OWN account address; audited without the address', async () => {
    const { generationId } = await resumeService.generate(candidateId);
    await markReady(generationId);

    const result = await deliveryService.sendEmail(CANDIDATE_USER_ID, candidateId);
    expect(result.delivered).toBe('EMAIL');

    const emailJobs = notificationQueueAdd.mock.calls.filter(
      (c) => (c[1] as { channel: string }).channel === 'email',
    );
    expect(emailJobs).toHaveLength(1);
    // The destination is resolved worker-side from the USER ROW — the job
    // carries a userId, never an address, so there is no request-supplied
    // recipient anywhere in the pipeline.
    expect((emailJobs[0]![1] as { userId: string }).userId).toBe(CANDIDATE_USER_ID);
    expect(JSON.stringify(emailJobs[0]![1])).not.toContain('rs-cand@example.com');

    const audit = await prismaClient.auditLog.findFirstOrThrow({
      where: { action: AUDIT_ACTIONS.RESUME_EMAILED },
    });
    expect(JSON.stringify(audit.meta)).not.toContain('rs-cand@example.com');
  });

  d('no dedicated daily cap — the 6th email-to-self still goes (stated policy)', async () => {
    const { generationId } = await resumeService.generate(candidateId);
    await markReady(generationId);

    for (let i = 0; i < RESUME_SEND_CAP_PER_DAY + 1; i++) {
      const r = await deliveryService.sendEmail(CANDIDATE_USER_ID, candidateId);
      expect(r.delivered).toBe('EMAIL');
    }
  });
});

// ── The ready notification ──────────────────────────────────────────────────

describe('resume.generated → RESUME_READY', () => {
  d('writes an in-app notification so a navigated-away candidate learns of it', async () => {
    const { generationId } = await resumeService.generate(candidateId);
    await markReady(generationId);
    const resume = await prismaClient.candidateResume.findUniqueOrThrow({
      where: { candidateId },
    });

    await subscriber.onResumeGenerated({
      candidateId,
      resumeId: resume.id,
      generationId,
    });

    const notification = await prismaClient.notification.findFirstOrThrow({
      where: { userId: CANDIDATE_USER_ID, type: NotificationType.RESUME_READY },
    });
    expect(notification.title).toContain('ready');
    // In-app ONLY (matrix): no WhatsApp job, no email job for this type.
    expect(notificationQueueAdd).not.toHaveBeenCalled();
  });

  d('a purged candidate mid-render is skipped, not crashed', async () => {
    const emitter = new EventEmitter2();
    emitter.on(RESUME_EVENTS.GENERATED, (p) => subscriber.onResumeGenerated(p));
    await expect(
      subscriber.onResumeGenerated({
        candidateId: 'does-not-exist',
        resumeId: 'x',
        generationId: 'y',
      }),
    ).resolves.toBeUndefined();
  });
});
