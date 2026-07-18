import { Injectable, Logger } from '@nestjs/common';
import { Prisma, ResumeGenerationStatus } from '@prisma/client';
import { PrismaService } from '../core/prisma/prisma.service';
import { StorageService } from '../core/storage/storage.service';
import { CandidateReadService } from '../candidate/candidate-read.service';
import { PdfRenderService } from '../pdf/pdf-render.service';
import {
  RESUME_SETTINGS_DEFAULTS,
  ResumeRenderSettings,
  toResumeView,
} from './resume-view.mapper';
import { renderResumeHtml } from './templates/resume.template';

export interface RenderResumeResult {
  resumeId: string;
  generationId: string;
  r2Key: string;
  sizeBytes: number;
}

/**
 * Resume rendering (S7-B1, WORKER-ONLY): source → view (the omission
 * chokepoint) → template → the shared PdfRenderService → the generation row.
 *
 * The resume module owns candidate_resumes + resume_generations; profile data
 * arrives through CandidateReadService.getResumeSource (Rule 4 — never a
 * direct candidate_profiles query here).
 *
 * The PHOTO (stated approach): fetched server-side from R2 by THIS service
 * and inlined as a data URI. The template never contains a live URL, so
 * Chromium makes zero network requests at render time (nothing can hang the
 * load; nothing leaves the machine). A missing or unreadable photo degrades
 * to a photo-less resume — it never blocks generation.
 *
 * LANGUAGE GUARD (stated): English MVP. Whatever `language` says (a stray
 * 'hi'/'ar' included), the EN template renders — logged, not crashed, never
 * half-rendered. The snapshot still records what the candidate asked for.
 */
@Injectable()
export class ResumeRenderService {
  private readonly logger = new Logger(ResumeRenderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly candidateRead: CandidateReadService,
    private readonly pdfRender: PdfRenderService,
  ) {}

  /**
   * Render the generation `generationId`. Idempotent-ish: an already-READY
   * generation returns without re-rendering (a BullMQ retry after a late ack
   * must not double-render).
   */
  async renderGeneration(generationId: string): Promise<RenderResumeResult> {
    const generation = await this.prisma.resumeGeneration.findUnique({
      where: { id: generationId },
      include: { resume: true },
    });
    if (!generation) throw new Error(`generation not found: ${generationId}`);
    if (generation.status === ResumeGenerationStatus.READY && generation.r2Key) {
      return {
        resumeId: generation.resumeId,
        generationId: generation.id,
        r2Key: generation.r2Key,
        sizeBytes: generation.sizeBytes ?? 0,
      };
    }

    const candidateId = generation.resume.candidateId;
    const source = await this.candidateRead.getResumeSource(candidateId);
    if (!source) throw new Error(`resume source missing for generation ${generationId}`);

    // The settings that render are the SNAPSHOT on the generation row (written
    // at enqueue). A legacy/empty snapshot falls back to the CandidateResume
    // row (or defaults) and is persisted, so the record always states what
    // actually rendered.
    const settings = this.resolveSettings(generation.settingsSnapshot, generation.resume);
    if (settings.language !== 'en') {
      this.logger.log(
        `generation ${generationId}: language '${settings.language}' not yet rendered — using EN (English MVP)`,
      );
    }

    const photoDataUri = await this.loadPhotoDataUri(source.photoKey);
    const view = toResumeView(source, settings, photoDataUri);
    const html = renderResumeHtml(view);

    const { r2Key, sizeBytes, contentHash } = await this.pdfRender.renderToR2(html, {
      keyPrefix: `resumes/${candidateId}`,
      filename: 'resume.pdf',
    });

    const generatedAt = new Date();
    await this.prisma.$transaction([
      this.prisma.resumeGeneration.update({
        where: { id: generationId },
        data: {
          status: ResumeGenerationStatus.READY,
          r2Key,
          sizeBytes,
          contentHash,
          generatedAt,
          failureReason: null,
          settingsSnapshot: settings as unknown as Prisma.InputJsonValue,
        },
      }),
      this.prisma.candidateResume.update({
        where: { id: generation.resumeId },
        data: { lastRenderKey: r2Key, lastRenderHash: contentHash, lastRenderedAt: generatedAt },
      }),
    ]);

    return { resumeId: generation.resumeId, generationId, r2Key, sizeBytes };
  }

  /** Terminal failure (retries exhausted): poll-visible FAILED, generic reason. */
  async markFailed(generationId: string): Promise<void> {
    await this.prisma.resumeGeneration.updateMany({
      where: { id: generationId, status: ResumeGenerationStatus.PENDING },
      data: {
        status: ResumeGenerationStatus.FAILED,
        // Generic by design — an internal error string could leak paths/PII.
        failureReason: 'Rendering failed. Please try generating again.',
      },
    });
  }

  private resolveSettings(
    snapshot: Prisma.JsonValue,
    resume: {
      language: string;
      showPhone: boolean;
      showReligion: boolean;
      showFatherName: boolean;
      showPassportNumber: boolean;
    },
  ): ResumeRenderSettings {
    const snap = (snapshot ?? {}) as Partial<ResumeRenderSettings>;
    if (typeof snap.showPhone === 'boolean') {
      return {
        language: snap.language ?? RESUME_SETTINGS_DEFAULTS.language,
        showPhone: snap.showPhone,
        showReligion: snap.showReligion ?? RESUME_SETTINGS_DEFAULTS.showReligion,
        showFatherName: snap.showFatherName ?? RESUME_SETTINGS_DEFAULTS.showFatherName,
        showPassportNumber:
          snap.showPassportNumber ?? RESUME_SETTINGS_DEFAULTS.showPassportNumber,
      };
    }
    return {
      language: resume.language,
      showPhone: resume.showPhone,
      showReligion: resume.showReligion,
      showFatherName: resume.showFatherName,
      showPassportNumber: resume.showPassportNumber,
    };
  }

  private async loadPhotoDataUri(photoKey: string | null): Promise<string | null> {
    if (!photoKey) return null;
    try {
      const obj = await this.storage.getObjectBuffer(photoKey);
      if (!obj) return null;
      const mime = obj.contentType.startsWith('image/') ? obj.contentType : 'image/jpeg';
      return `data:${mime};base64,${obj.body.toString('base64')}`;
    } catch {
      // A broken photo never blocks a resume — degrade to no photo.
      this.logger.warn('photo fetch failed — rendering without a photo');
      return null;
    }
  }
}
