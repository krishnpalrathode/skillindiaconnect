import { Body, Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/rbac/require-permissions.decorator';
import { Permission } from '../auth/rbac/permission.constants';
import { AdminResendService } from './admin-resend.service';
import { ResendWhatsappDto } from './dto/admin-resend.dto';

/**
 * Manual "Selected" WhatsApp resend (S6b-B2) — the S4-B2 bypassGuard seam's
 * endpoint. RBAC: `applications.change_status` (seeded ON for ADMIN, OFF for
 * MODERATOR — a live denial). 202: the resend is ENQUEUED; the worker owns the
 * external send.
 */
@Controller('admin/applications')
export class AdminResendController {
  constructor(private readonly resendService: AdminResendService) {}

  @Post(':id/resend-whatsapp')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions(Permission.APPLICATIONS_CHANGE_STATUS)
  async resend(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResendWhatsappDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return {
      data: await this.resendService.resendSelectedWhatsapp(id, dto.reason, {
        userId: user.userId,
        role: user.role,
      }),
    };
  }
}
