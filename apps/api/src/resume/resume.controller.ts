import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { ResumeTrigger, UserRole } from '@prisma/client';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { ResumeService } from './resume.service';
import { ResumeSettingsService } from './resume-settings.service';
import { ResumeDeliveryService } from './resume-delivery.service';
import { UpdateResumeSettingsDto } from './dto/update-resume-settings.dto';

/**
 * Resume endpoints (S7-B2) — CANDIDATE-only, own-resume-only.
 *
 * SCOPING: every route resolves the candidate from the BEARER TOKEN. No route
 * accepts a candidate id, a phone number, or an email address, so there is no
 * request shape that could address someone else's resume — the own-only rule
 * is structural, not a check that could be forgotten.
 */
@Controller('candidates/me/resume')
export class ResumeController {
  constructor(
    private readonly resumeService: ResumeService,
    private readonly settingsService: ResumeSettingsService,
    private readonly deliveryService: ResumeDeliveryService,
  ) {}

  /** Settings + the latest generation ("current") — the Screen 12 read. */
  @Get()
  async getResume(@CurrentUser() user: CurrentUserPayload) {
    const candidateId = await this.scope(user);
    return { data: await this.resumeService.getResumeOverview(candidateId) };
  }

  @Patch('settings')
  async updateSettings(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: UpdateResumeSettingsDto,
  ) {
    const candidateId = await this.scope(user);
    return { data: await this.settingsService.updateSettings(candidateId, dto) };
  }

  /** 202 — ENQUEUE ONLY. The worker renders; the client polls /status. */
  @Post('generate')
  @HttpCode(HttpStatus.ACCEPTED)
  async generate(@CurrentUser() user: CurrentUserPayload) {
    const candidateId = await this.scope(user);
    return { data: await this.resumeService.generate(candidateId, ResumeTrigger.DOWNLOAD) };
  }

  @Get('status')
  async getStatus(@CurrentUser() user: CurrentUserPayload) {
    const candidateId = await this.scope(user);
    return { data: await this.resumeService.getStatus(candidateId) };
  }

  @Get('download')
  async getDownload(@CurrentUser() user: CurrentUserPayload) {
    const candidateId = await this.scope(user);
    return { data: await this.resumeService.getDownloadUrl(candidateId) };
  }

  // ─── Cover letter ─────────────────────────────────────────────────────────
  // Rendered with the resume in one job, so there is no separate generate or
  // poll here — if the resume is READY, the letter is there.

  @Get('cover-letter/download')
  async getCoverLetterDownload(@CurrentUser() user: CurrentUserPayload) {
    const candidateId = await this.scope(user);
    return { data: await this.resumeService.getCoverLetterUrl(candidateId) };
  }

  @Post('cover-letter/send-email')
  @HttpCode(HttpStatus.ACCEPTED)
  async sendCoverLetterEmail(@CurrentUser() user: CurrentUserPayload) {
    const candidateId = await this.scope(user);
    return { data: await this.deliveryService.sendCoverLetterEmail(user.userId, candidateId) };
  }

  @Post('send-whatsapp')
  @HttpCode(HttpStatus.ACCEPTED)
  async sendWhatsapp(@CurrentUser() user: CurrentUserPayload) {
    const candidateId = await this.scope(user);
    return { data: await this.deliveryService.sendWhatsapp(user.userId, candidateId) };
  }

  @Post('send-email')
  @HttpCode(HttpStatus.ACCEPTED)
  async sendEmail(@CurrentUser() user: CurrentUserPayload) {
    const candidateId = await this.scope(user);
    return { data: await this.deliveryService.sendEmail(user.userId, candidateId) };
  }

  private async scope(user: CurrentUserPayload): Promise<string> {
    if (user.role !== UserRole.CANDIDATE) {
      throw new ForbiddenException({ code: 'NOT_CANDIDATE' });
    }
    return this.resumeService.requireCandidateId(user.userId);
  }
}
