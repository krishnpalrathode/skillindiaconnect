import { HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Prisma, ResumeGeneration, ResumeGenerationStatus, ResumeTrigger } from '@prisma/client';
import { Queue } from 'bullmq';
import { PrismaService } from '../core/prisma/prisma.service';
import { StorageService } from '../core/storage/storage.service';
import { CandidateReadService } from '../candidate/candidate-read.service';
import { JOB_NAMES, QUEUE_NAMES } from '../queue/queue.constants';
import { ResumeSettingsService, toSettings } from './resume-settings.service';
import { ResumeRenderSettings } from './resume-view.mapper';
import { StoredResumeView, WireResumeView, toWireResumeView } from './resume-view.wire';

/**
 * Signed-url lifetime for a resume PDF. Short by design — the link is minted
 * for a click that is about to happen, and `GET /resume/download` re-mints it.
 * An expired link is the system working.
 */
export const RESUME_URL_EXPIRY_SECONDS = 300;

/**
 * How long a PENDING generation counts as "in flight" for the double-tap
 * dedupe. Beyond this it is treated as STALE and a fresh generation is made.
 *
 * Why a bound at all: a PENDING row whose job died (worker killed mid-render,
 * a queue flushed, a legacy row that predates the lifecycle column) would
 * otherwise dedupe against itself FOREVER — the candidate taps Generate, gets
 * the dead row's id back, polls PENDING, and can never produce a resume again.
 * A dedupe that can permanently wedge a user is worse than the duplicate
 * render it prevents. 5 minutes clears the worst case comfortably: a 30s
 * render × 3 attempts with 10s exponential backoff finishes inside ~2.
 */
const RESUME_PENDING_STALE_MS = 5 * 60 * 1000;

/** Retry policy for the render job (mirrors S7-B1's processor constant). */
const RESUME_RENDER_JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 10_000 },
};

export interface ResumeGenerationDto {
  generationId: string;
  status: ResumeGenerationStatus;
  resumeId?: string;
  downloadUrl?: string;
  expiresInSeconds?: number;
  generatedAt?: string;
  failureReason?: string;
  view?: WireResumeView;
}

/**
 * Resume orchestration (S7-B2, API-PROCESS side).
 *
 * THE SPLIT: this service only ever WRITES STATE AND ENQUEUES. Chromium lives
 * in the worker (S7-B1's PdfModule is imported by the worker root and by
 * nothing else), so `generate` returns 202 the moment the row and the job
 * exist. The client polls `status`. There is no synchronous render anywhere in
 * the API process, by construction rather than by discipline.
 */
@Injectable()
export class ResumeService {
  private readonly logger = new Logger(ResumeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly candidateRead: CandidateReadService,
    private readonly settingsService: ResumeSettingsService,
    @InjectQueue(QUEUE_NAMES.RESUME_RENDER) private readonly renderQueue: Queue,
  ) {}

  /** userId → candidateId. Every resume read/write is scoped through this. */
  async requireCandidateId(userId: string): Promise<string> {
    const candidateId = await this.candidateRead.getCandidateIdForUser(userId);
    if (!candidateId) {
      throw new NotFoundException({
        code: 'PROFILE_NOT_FOUND',
        detail: 'No candidate profile for this account.',
      });
    }
    return candidateId;
  }

  /** GET /candidates/me/resume — settings + the latest generation ("current"). */
  async getResumeOverview(candidateId: string): Promise<{
    settings: ResumeRenderSettings;
    lastRenderedAt: string | null;
    current: ResumeGenerationDto | null;
  }> {
    const resume = await this.settingsService.getOrCreateResume(candidateId);
    const latest = await this.findLatestGeneration(resume.id);
    return {
      // toSettings is THE row→settings mapping (see resume-settings.service.ts).
      // This used to hand-roll its own copy, which is how a new field ends up
      // present in the PATCH response and missing from the overview read.
      settings: toSettings(resume),
      lastRenderedAt: resume.lastRenderedAt?.toISOString() ?? null,
      current: latest ? await this.toDto(latest) : null,
    };
  }

  /**
   * POST /generate — 202, enqueue only.
   *
   * DOUBLE-TAP DEDUPE (stated): an in-flight PENDING generation for this
   * candidate is RETURNED AS-IS instead of creating a second one. A candidate
   * mashing "Download PDF" on a slow connection must not spawn N Chromium
   * renders — each one costs a slot in a small bounded pool (2 by default; see
   * pdf/render-tuning.ts, S8-H1 made it configurable), so the
   * mashing would delay everyone including them. The BullMQ `jobId` is derived
   * from the generation id as a second, independent guard: even if two requests
   * raced past the row check, they would enqueue the SAME job id, and BullMQ
   * would keep one.
   */
  async generate(candidateId: string, trigger: ResumeTrigger = ResumeTrigger.DOWNLOAD): Promise<{
    generationId: string;
    status: ResumeGenerationStatus;
  }> {
    const resume = await this.settingsService.getOrCreateResume(candidateId);

    const inFlight = await this.prisma.resumeGeneration.findFirst({
      where: {
        resumeId: resume.id,
        status: ResumeGenerationStatus.PENDING,
        createdAt: { gte: new Date(Date.now() - RESUME_PENDING_STALE_MS) },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (inFlight) {
      this.logger.log(`generate: reusing in-flight generation ${inFlight.id}`);
      return { generationId: inFlight.id, status: inFlight.status };
    }

    // The settings are SNAPSHOT here, at enqueue — a PATCH landing between now
    // and the render must not change what these bytes contain. That now
    // includes `template`, so the snapshot records which template produced the
    // stored PDF without needing a column of its own.
    const settings: ResumeRenderSettings = toSettings(resume);

    const generation = await this.prisma.resumeGeneration.create({
      data: {
        resumeId: resume.id,
        status: ResumeGenerationStatus.PENDING,
        trigger,
        settingsSnapshot: settings as unknown as Prisma.InputJsonValue,
      },
    });

    await this.renderQueue.add(
      JOB_NAMES.GENERATE_RESUME,
      { generationId: generation.id, candidateId },
      { jobId: `generate-resume-${generation.id}`, ...RESUME_RENDER_JOB_OPTS },
    );

    return { generationId: generation.id, status: generation.status };
  }

  /** GET /status — the poll target. 404 when nothing was ever generated. */
  async getStatus(candidateId: string): Promise<ResumeGenerationDto> {
    const resume = await this.settingsService.getOrCreateResume(candidateId);
    const latest = await this.findLatestGeneration(resume.id);
    if (!latest) {
      throw new NotFoundException({
        code: 'RESUME_NOT_FOUND',
        detail: 'No resume has been generated yet.',
      });
    }
    return this.toDto(latest);
  }

  /** GET /download — re-mint the signed url (the expired-link affordance). */
  async getDownloadUrl(candidateId: string): Promise<{ url: string; expiresInSeconds: number }> {
    const ready = await this.requireReadyGeneration(candidateId, 'RESUME_NOT_FOUND', 404);
    return {
      url: await this.storage.presignGet(ready.r2Key!, RESUME_URL_EXPIRY_SECONDS),
      expiresInSeconds: RESUME_URL_EXPIRY_SECONDS,
    };
  }

  /**
   * The READY gate both delivery endpoints stand on: you cannot send a resume
   * that does not exist. PENDING and FAILED are both "not ready" — the client
   * generates first (the poll tells it when).
   */
  async requireReadyGeneration(
    candidateId: string,
    code: string,
    status: number,
  ): Promise<ResumeGeneration> {
    const resume = await this.settingsService.getOrCreateResume(candidateId);
    const ready = await this.prisma.resumeGeneration.findFirst({
      where: { resumeId: resume.id, status: ResumeGenerationStatus.READY, r2Key: { not: null } },
      orderBy: { createdAt: 'desc' },
    });
    if (!ready) {
      throw new HttpException(
        { code, detail: 'Generate your resume before sending it.' },
        status as HttpStatus,
      );
    }
    return ready;
  }

  private findLatestGeneration(resumeId: string): Promise<ResumeGeneration | null> {
    return this.prisma.resumeGeneration.findFirst({
      where: { resumeId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Wire shape. READY carries the signed url AND the stored view — the exact
   * field set those bytes were rendered from, never a re-read of the live
   * profile (see resume-view.wire.ts).
   */
  private async toDto(gen: ResumeGeneration): Promise<ResumeGenerationDto> {
    const dto: ResumeGenerationDto = { generationId: gen.id, status: gen.status };

    if (gen.status === ResumeGenerationStatus.FAILED && gen.failureReason) {
      dto.failureReason = gen.failureReason;
    }
    if (gen.status !== ResumeGenerationStatus.READY || !gen.r2Key) return dto;

    dto.resumeId = gen.resumeId;
    dto.downloadUrl = await this.storage.presignGet(gen.r2Key, RESUME_URL_EXPIRY_SECONDS);
    dto.expiresInSeconds = RESUME_URL_EXPIRY_SECONDS;
    if (gen.generatedAt) dto.generatedAt = gen.generatedAt.toISOString();

    const stored = gen.viewSnapshot as unknown as StoredResumeView | null;
    if (stored) {
      const photoUrl = stored.photoKey
        ? await this.storage.presignGet(stored.photoKey, RESUME_URL_EXPIRY_SECONDS)
        : null;
      dto.view = toWireResumeView(stored, photoUrl);
    }
    return dto;
  }
}
