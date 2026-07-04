import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { EmployerProfileService } from './employer-profile.service';
import { UpsertHiringPreferencesDto } from './dto/upsert-hiring-preferences.dto';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { PresignLogoDto } from './dto/presign-logo.dto';
import { ConfirmLogoDto } from './dto/confirm-logo.dto';

@Controller('employers')
export class EmployerProfileController {
  constructor(private readonly profileService: EmployerProfileService) {}

  // ── GET /employers/me/profile ────────────────────────────────────────────

  @Get('me/profile')
  async getProfile(@CurrentUser() user: CurrentUserPayload) {
    this.assertEmployerRole(user.role);
    return { data: await this.profileService.getProfile(user.userId) };
  }

  // ── PATCH /employers/me/profile/hiring-preferences ───────────────────────

  @Patch('me/profile/hiring-preferences')
  async upsertHiringPreferences(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: UpsertHiringPreferencesDto,
  ) {
    this.assertEmployerRole(user.role);
    return { data: await this.profileService.upsertHiringPreferences(user.userId, dto) };
  }

  // ── POST /employers/me/profile/contacts ──────────────────────────────────

  @Post('me/profile/contacts')
  @HttpCode(HttpStatus.CREATED)
  async createContact(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CreateContactDto,
  ) {
    this.assertEmployerRole(user.role);
    return { data: await this.profileService.createContact(user.userId, dto) };
  }

  // ── PATCH /employers/me/profile/contacts/:id ─────────────────────────────

  @Patch('me/profile/contacts/:id')
  async updateContact(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) contactId: string,
    @Body() dto: UpdateContactDto,
  ) {
    this.assertEmployerRole(user.role);
    return { data: await this.profileService.updateContact(user.userId, contactId, dto) };
  }

  // ── DELETE /employers/me/profile/contacts/:id ────────────────────────────

  @Delete('me/profile/contacts/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteContact(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) contactId: string,
  ) {
    this.assertEmployerRole(user.role);
    await this.profileService.deleteContact(user.userId, contactId);
  }

  // ── POST /employers/me/profile/logo/presign ──────────────────────────────

  @Post('me/profile/logo/presign')
  async presignLogo(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: PresignLogoDto,
  ) {
    this.assertEmployerRole(user.role);
    return { data: await this.profileService.presignLogo(user.userId, dto) };
  }

  // ── POST /employers/me/profile/logo/confirm ──────────────────────────────

  @Post('me/profile/logo/confirm')
  async confirmLogo(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: ConfirmLogoDto,
  ) {
    this.assertEmployerRole(user.role);
    await this.profileService.confirmLogo(user.userId, dto);
    return { data: { ok: true } };
  }

  private assertEmployerRole(role: UserRole): void {
    if (role !== UserRole.EMPLOYER) {
      throw new ForbiddenException({ code: 'FORBIDDEN' });
    }
  }
}
