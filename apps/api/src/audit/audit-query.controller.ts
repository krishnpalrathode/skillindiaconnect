import { Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/rbac/require-permissions.decorator';
import { Permission } from '../auth/rbac/permission.constants';
import { AuditQueryService } from './audit-query.service';
import { LogQueryDto } from './dto/log-query.dto';

/**
 * GET /api/v1/admin/logs, /api/v1/admin/logs/export — Screen 29.
 *
 * Lives in the AUDIT module, not the admin module: audit_logs is this module's
 * table, and module-boundaries Rule 4 says a module reads only its own tables.
 * The admin console is just the caller.
 *
 * The two endpoints carry DIFFERENT RBAC keys on purpose:
 *   - logs.view   → read a page on screen (MODERATOR holds this).
 *   - logs.export → walk out with the whole table (MODERATOR does NOT).
 * Reading and bulk-extracting are different acts; one key for both would make
 * the distinction unenforceable.
 */
@Controller('admin/logs')
export class AuditQueryController {
  constructor(private readonly auditQueryService: AuditQueryService) {}

  @Get()
  @RequirePermissions(Permission.LOGS_VIEW)
  async list(@Query() dto: LogQueryDto) {
    // Envelope is { data, nextCursor } — the cursor feed shape, not { data } alone.
    return this.auditQueryService.query(dto);
  }

  @Get('export')
  @RequirePermissions(Permission.LOGS_EXPORT)
  async export(
    @Query() dto: LogQueryDto,
    @CurrentUser() user: CurrentUserPayload,
    @Res() res: Response,
  ): Promise<void> {
    const { csv, filename } = await this.auditQueryService.export(dto, {
      userId: user.userId,
      role: user.role,
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }
}
