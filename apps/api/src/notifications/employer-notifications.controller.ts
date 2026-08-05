import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { NotificationService } from './notification.service';
import { NotificationDto } from './notification.mapper';
import { ListNotificationsDto } from './dto/list-notifications.dto';
import { MarkReadDto } from './dto/mark-read.dto';

/**
 * Employer-facing notification endpoints — the mirror of NotificationsController.
 *
 * Notifications are stored per-user; the service methods are role-agnostic (they
 * key on userId). Employers receive rows for EMPLOYER_APPROVED / _REJECTED /
 * _SUSPENDED, SUBSCRIPTION_* and CANDIDATE_MATCHES, but until this controller
 * existed they had no way to READ them (the candidate feed is candidate-only).
 * Same service, same table (Rule 4) — only the audience differs.
 */
@Controller('employers/me/notifications')
export class EmployerNotificationsController {
  constructor(private readonly notificationService: NotificationService) {}

  /**
   * GET /api/v1/employers/me/notifications
   * Cursor-based feed; optional filter bucket + unread-only flag.
   */
  @Get()
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @Query() dto: ListNotificationsDto,
  ): Promise<{ data: NotificationDto[]; nextCursor: string | null }> {
    this.notificationService.assertEmployerRole(user.role);
    return this.notificationService.listNotifications(user.userId, dto);
  }

  /**
   * POST /api/v1/employers/me/notifications/read
   * Mark notifications read (pass `ids` or `all: true`).
   */
  @Post('read')
  @HttpCode(HttpStatus.OK)
  async markRead(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: MarkReadDto,
  ): Promise<void> {
    this.notificationService.assertEmployerRole(user.role);
    await this.notificationService.markRead(user.userId, dto);
  }
}
