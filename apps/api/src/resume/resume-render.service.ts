import { Injectable, Logger } from '@nestjs/common';
import { CandidateResume, Prisma, ResumeGenerationStatus } from '@prisma/client';
import { PrismaService } from '../core/prisma/prisma.service';
import { StorageService } from '../core/storage/storage.service';
import { CandidateReadService } from '../candidate/candidate-read.service';
import { PdfRenderService } from '../pdf/pdf-render.service';
import { RESUME_SETTINGS_DEFAULTS, ResumeRenderSettings, toResumeView } from './resume-view.mapper';
import { toSettings } from './resume-settings.service';
import { toStoredResumeView } from './resume-view.wire';
import { selectTemplate } from './templates/registry';
import { buildCoverLetter } from './cover-letter/cover-letter.content';
import { renderCoverLetter } from './cover-letter/cover-letter.template';

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
    // The mapper runs FIRST and unconditionally: omissions are decided here,
    // before any template exists in the picture. The template then renders
    // whatever survived — it cannot reinstate a field the mapper dropped.
    const view = toResumeView(source, settings, photoDataUri);
    const html = selectTemplate(settings.template)(view);

    const { r2Key, sizeBytes, contentHash } = await this.pdfRender.renderToR2(html, {
      keyPrefix: `resumes/${candidateId}`,
      filename: 'resume.pdf',
    });

    /*
      The cover letter, from the SAME view, in the SAME job.

      Rendered here rather than behind its own generate/poll flow for one
      reason: the two documents are sent together and must describe the same
      person on the same day. A separately-generated letter would quote a
      profile snapshot taken minutes or weeks apart from the CV beside it, and
      the first time those disagreed — a job title updated between the two — the
      candidate would be the last to know.

      Failure is NON-FATAL and deliberately so. The resume is the artifact the
      candidate asked for and it is already rendered and stored by this point;
      losing it because the optional second document failed would be a plainly
      worse outcome than shipping without a letter. A null key reads downstream
      as "regenerate to get one", which is also what pre-S8 rows read as.
    */
    let coverLetterR2Key: string | null = null;
    let coverLetterSizeBytes: number | null = null;
    try {
      const letterHtml = renderCoverLetter(buildCoverLetter(view));
      const letter = await this.pdfRender.renderToR2(letterHtml, {
        keyPrefix: `resumes/${candidateId}`,
        filename: 'cover-letter.pdf',
      });
      coverLetterR2Key = letter.r2Key;
      coverLetterSizeBytes = letter.sizeBytes;
    } catch (err) {
      this.logger.error(
        `generation ${generationId}: cover letter render failed — resume is unaffected`,
        err instanceof Error ? err.stack : undefined,
      );
    }

    const generatedAt = new Date();
    await this.prisma.$transaction([
      this.prisma.resumeGeneration.update({
        where: { id: generationId },
        data: {
          status: ResumeGenerationStatus.READY,
          r2Key,
          sizeBytes,
          contentHash,
          coverLetterR2Key,
          coverLetterSizeBytes,
          generatedAt,
          failureReason: null,
          settingsSnapshot: settings as unknown as Prisma.InputJsonValue,
          // The EXACT view these bytes came from (S7-B2 serves it on the poll).
          viewSnapshot: toStoredResumeView(
            view,
            source.photoKey,
          ) as unknown as Prisma.InputJsonValue,
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
    resume: CandidateResume,
  ): ResumeRenderSettings {
    const snap = (snapshot ?? {}) as Partial<ResumeRenderSettings>;
    if (typeof snap.showPhone === 'boolean') {
      return {
        language: snap.language ?? RESUME_SETTINGS_DEFAULTS.language,
        showPhone: snap.showPhone,
        showReligion: snap.showReligion ?? RESUME_SETTINGS_DEFAULTS.showReligion,
        showFatherName: snap.showFatherName ?? RESUME_SETTINGS_DEFAULTS.showFatherName,
        showPassportNumber: snap.showPassportNumber ?? RESUME_SETTINGS_DEFAULTS.showPassportNumber,
        // A snapshot written before this column existed carries no template.
        // CLASSIC is the right answer for exactly those rows: it is what they
        // WERE rendered with, so a re-render reproduces the same document.
        template: snap.template ?? RESUME_SETTINGS_DEFAULTS.template,
      };
    }
    return toSettings(resume);
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
