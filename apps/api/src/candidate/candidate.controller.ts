import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  forwardRef,
} from '@nestjs/common';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CandidateService } from './candidate.service';
import { ExperienceService } from './experience.service';
import { SkillService } from './skill.service';
import { ProfileViewsReadService } from './profile-views-read.service';
import { ApplicationsAggregateService } from '../applications/applications-aggregate.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { CreateExperienceDto } from './dto/create-experience.dto';
import { UpdateExperienceDto } from './dto/update-experience.dto';
import { CreateSkillDto } from './dto/create-skill.dto';
import { PresignPhotoDto } from './dto/presign-photo.dto';
import { ConfirmPhotoDto } from './dto/confirm-photo.dto';

@Controller('candidates')
export class CandidateController {
  constructor(
    private readonly candidateService: CandidateService,
    private readonly experienceService: ExperienceService,
    private readonly skillService: SkillService,
    private readonly profileViewsReadService: ProfileViewsReadService,
    @Inject(forwardRef(() => ApplicationsAggregateService))
    private readonly applicationsAggregate: ApplicationsAggregateService,
  ) {}

  // ─── Profile ──────────────────────────────────────────────────────────────

  @Get('me')
  async getMe(@CurrentUser() user: CurrentUserPayload) {
    this.candidateService.assertCandidateRole(user.role);
    return { data: await this.candidateService.getProfileByUserId(user.userId) };
  }

  @Patch('me')
  async updateMe(@CurrentUser() user: CurrentUserPayload, @Body() dto: UpdateProfileDto) {
    this.candidateService.assertCandidateRole(user.role);
    return { data: await this.candidateService.updateProfile(user.userId, dto) };
  }

  // ─── Profile photo (avatar) upload ────────────────────────────────────────

  @Post('me/photo/presign')
  async presignPhoto(@CurrentUser() user: CurrentUserPayload, @Body() dto: PresignPhotoDto) {
    this.candidateService.assertCandidateRole(user.role);
    return { data: await this.candidateService.presignPhoto(user.userId, dto) };
  }

  @Post('me/photo/confirm')
  async confirmPhoto(@CurrentUser() user: CurrentUserPayload, @Body() dto: ConfirmPhotoDto) {
    this.candidateService.assertCandidateRole(user.role);
    return { data: await this.candidateService.confirmPhoto(user.userId, dto) };
  }

  // ─── Completion ───────────────────────────────────────────────────────────

  @Get('me/completion')
  async getCompletion(@CurrentUser() user: CurrentUserPayload) {
    this.candidateService.assertCandidateRole(user.role);
    return { data: await this.candidateService.getCompletion(user.userId) };
  }

  // ─── Profile views (self — who viewed my profile) ────────────────────────

  @Get('me/profile-views')
  async getProfileViews(@CurrentUser() user: CurrentUserPayload) {
    this.candidateService.assertCandidateRole(user.role);
    const candidateId = await this.candidateService.getCandidateIdByUserId(user.userId);
    return { data: await this.profileViewsReadService.getSummary(candidateId) };
  }

  // ─── Dashboard KPIs (S4-B3: Jobs Applied + Shortlisted, live) ─────────────

  @Get('me/stats')
  async getStats(@CurrentUser() user: CurrentUserPayload) {
    this.candidateService.assertCandidateRole(user.role);
    const candidateId = await this.candidateService.getCandidateIdByUserId(user.userId);
    const counts = await this.applicationsAggregate.countsForCandidate(candidateId);
    return { data: counts };
  }

  // ─── Settings ─────────────────────────────────────────────────────────────

  @Patch('me/settings')
  async updateSettings(@CurrentUser() user: CurrentUserPayload, @Body() dto: UpdateSettingsDto) {
    this.candidateService.assertCandidateRole(user.role);
    return { data: await this.candidateService.updateSettings(user.userId, dto) };
  }

  // ─── Experiences ──────────────────────────────────────────────────────────

  @Post('me/experiences')
  @HttpCode(HttpStatus.CREATED)
  async createExperience(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateExperienceDto,
  ) {
    this.candidateService.assertCandidateRole(user.role);
    const candidateId = await this.candidateService.getCandidateIdByUserId(user.userId);
    const experience = await this.experienceService.create(candidateId, dto);
    return { data: experience };
  }

  @Patch('me/experiences/:id')
  async updateExperience(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateExperienceDto,
  ) {
    this.candidateService.assertCandidateRole(user.role);
    const candidateId = await this.candidateService.getCandidateIdByUserId(user.userId);
    const experience = await this.experienceService.update(candidateId, id, dto);
    return { data: experience };
  }

  @Delete('me/experiences/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteExperience(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<void> {
    this.candidateService.assertCandidateRole(user.role);
    const candidateId = await this.candidateService.getCandidateIdByUserId(user.userId);
    await this.experienceService.remove(candidateId, id);
  }

  // ─── Skills ───────────────────────────────────────────────────────────────

  @Post('me/skills')
  @HttpCode(HttpStatus.CREATED)
  async createSkill(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateSkillDto) {
    this.candidateService.assertCandidateRole(user.role);
    const candidateId = await this.candidateService.getCandidateIdByUserId(user.userId);
    const skill = await this.skillService.create(candidateId, dto);
    return { data: skill };
  }

  @Delete('me/skills/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteSkill(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ): Promise<void> {
    this.candidateService.assertCandidateRole(user.role);
    const candidateId = await this.candidateService.getCandidateIdByUserId(user.userId);
    await this.skillService.remove(candidateId, id);
  }
}
