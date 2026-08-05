import { Injectable } from '@nestjs/common';
import { CandidateResume } from '@prisma/client';
import { PrismaService } from '../core/prisma/prisma.service';
import { RESUME_SETTINGS_DEFAULTS, ResumeRenderSettings } from './resume-view.mapper';
import { UpdateResumeSettingsDto } from './dto/update-resume-settings.dto';

/**
 * Resume settings CRUD (S7-B2, API-side). Owns candidate_resumes — the row is
 * created lazily on first read/write, so a candidate who never opened the
 * screen still gets the S7-0 DEFAULTS (religion OFF, passport-number OFF,
 * phone ON, father's-name ON) rather than a 404.
 *
 * SETTINGS APPLY AT THE NEXT GENERATE. A PATCH does not touch any existing
 * generation's snapshot: the stored PDF and the view served beside it are one
 * artifact, frozen at render time. Changing a toggle changes the NEXT render —
 * the candidate regenerates for it to take effect. (Retroactively rewriting
 * the snapshot would make the API describe a PDF whose bytes say otherwise.)
 */
@Injectable()
export class ResumeSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** The candidate's settings row, created with defaults if absent. */
  async getOrCreateResume(candidateId: string): Promise<CandidateResume> {
    const existing = await this.prisma.candidateResume.findUnique({ where: { candidateId } });
    if (existing) return existing;
    // Column defaults ARE the S7-0 defaults — asserted in the spec so the two
    // can't drift apart silently.
    return this.prisma.candidateResume.create({ data: { candidateId } });
  }

  async getSettings(candidateId: string): Promise<ResumeRenderSettings> {
    return toSettings(await this.getOrCreateResume(candidateId));
  }

  /**
   * PARTIAL update — omitted toggles keep their value.
   *
   * `language`: the DTO enum accepts only `en` (S7-0 froze the enum that way
   * precisely so a client cannot request a language the renderer does not
   * have). If hi/ar are ever added to the enum, the value persists and the
   * renderer's guard still produces English — the honest behavior is stated in
   * both places rather than implied by silence.
   */
  async updateSettings(
    candidateId: string,
    dto: UpdateResumeSettingsDto,
  ): Promise<ResumeRenderSettings> {
    await this.getOrCreateResume(candidateId);
    const updated = await this.prisma.candidateResume.update({
      where: { candidateId },
      data: {
        ...(dto.language !== undefined && { language: dto.language }),
        ...(dto.showPhone !== undefined && { showPhone: dto.showPhone }),
        ...(dto.showReligion !== undefined && { showReligion: dto.showReligion }),
        ...(dto.showFatherName !== undefined && { showFatherName: dto.showFatherName }),
        ...(dto.showPassportNumber !== undefined && {
          showPassportNumber: dto.showPassportNumber,
        }),
        ...(dto.template !== undefined && { template: dto.template }),
      },
    });
    return toSettings(updated);
  }
}

/**
 * CandidateResume row → ResumeRenderSettings.
 *
 * THE single mapping. This was previously hand-rolled in three places (here,
 * ResumeService.getResumeOverview and ResumeService.generate), which is exactly
 * the shape where a newly-added field reaches two of them and the third quietly
 * reports something stale — a settings read and the snapshot that actually
 * renders disagreeing is the worst possible version of that bug. All three now
 * call this.
 */
export function toSettings(row: CandidateResume): ResumeRenderSettings {
  return {
    language: row.language || RESUME_SETTINGS_DEFAULTS.language,
    showPhone: row.showPhone,
    showReligion: row.showReligion,
    showFatherName: row.showFatherName,
    showPassportNumber: row.showPassportNumber,
    template: row.template,
  };
}
