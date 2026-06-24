import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CandidateService } from './candidate.service';
import { ExperienceService } from './experience.service';
import { SkillService } from './skill.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { CreateExperienceDto } from './dto/create-experience.dto';
import { UpdateExperienceDto } from './dto/update-experience.dto';
import { CreateSkillDto } from './dto/create-skill.dto';

@Controller('candidates')
export class CandidateController {
  constructor(
    private readonly candidateService: CandidateService,
    private readonly experienceService: ExperienceService,
    private readonly skillService: SkillService,
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

  // ─── Completion ───────────────────────────────────────────────────────────

  @Get('me/completion')
  async getCompletion(@CurrentUser() user: CurrentUserPayload) {
    this.candidateService.assertCandidateRole(user.role);
    return { data: await this.candidateService.getCompletion(user.userId) };
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
