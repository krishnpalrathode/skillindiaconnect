import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import { Notification } from '@prisma/client';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { NotificationService } from './notification.service';
import { ListNotificationsDto } from './dto/list-notifications.dto';
import { MarkReadDto } from './dto/mark-read.dto';

/**
 * Candidate-facing notification endpoints.
 * Placed here because this module owns the `notifications` table.
 * All endpoints are candidate-only — role is checked via assertCandidateRole().
 */
@Controller('candidates/me/notifications')
export class NotificationsController {
  constructor(private readonly notificationService: NotificationService) {}

  /**
   * GET /api/v1/candidates/me/notifications
   * Cursor-based feed; optional filter by bucket (applications|jobs|profile|system)
   * and unread-only flag.
   * Response: { data: Notification[], nextCursor: string | null }
   */
  @Get()
  async list(
    @CurrentUser() user: CurrentUserPayload,
    @Query() dto: ListNotificationsDto,
  ): Promise<{ data: Notification[]; nextCursor: string | null }> {
    this.notificationService.assertCandidateRole(user.role);
    return this.notificationService.listNotifications(user.userId, dto);
  }

  /**
   * POST /api/v1/candidates/me/notifications/read
   * Mark notifications as read. Pass `ids` for specific ones or `all: true` for all.
   * Returns 200 with empty body on success.
   */
  @Post('read')
  @HttpCode(HttpStatus.OK)
  async markRead(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: MarkReadDto,
  ): Promise<void> {
    this.notificationService.assertCandidateRole(user.role);
    await this.notificationService.markRead(user.userId, dto);
  }
}
