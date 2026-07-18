import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/rbac/require-permissions.decorator';
import { Permission } from '../auth/rbac/permission.constants';
import { AdminCandidatesService } from './admin-candidates.service';
import {
  ListAdminCandidatesDto,
  PurgeCandidateDto,
  SuspendCandidateDto,
} from './dto/admin-candidates.dto';

/**
 * Admin candidate management (S6b-B1, Screen 25).
 *
 * RBAC per the frozen contract: reads on `candidates.view`, suspend/reactivate
 * on `candidates.edit`, purge on `candidates.delete` (SUPER_ADMIN-effective —
 * seeded ON+locked for SUPER_ADMIN, locked OFF elsewhere; the contract
 * deliberately reuses this key rather than forking a `candidates.purge`).
 *
 * The document signed-URL grant is NOT here — it stayed in
 * AdminDocumentsController (S6a-B1) under `candidates.view_documents`.
 */
@Controller('admin/candidates')
export class AdminCandidatesController {
  constructor(private readonly adminCandidates: AdminCandidatesService) {}

  @Get()
  @RequirePermissions(Permission.CANDIDATES_VIEW)
  async list(@Query() query: ListAdminCandidatesDto) {
    return this.adminCandidates.list(query);
  }

  @Get(':id')
  @RequirePermissions(Permission.CANDIDATES_VIEW)
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.adminCandidates.detail(id) };
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK) // contract: 200 with the refreshed card (Nest POSTs default to 201)
  @RequirePermissions(Permission.CANDIDATES_EDIT)
  async suspend(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SuspendCandidateDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return {
      data: await this.adminCandidates.suspend(id, dto.reason, {
        userId: user.userId,
        role: user.role,
      }),
    };
  }

  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK) // contract: 200 with the refreshed card
  @RequirePermissions(Permission.CANDIDATES_EDIT)
  async reactivate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: CurrentUserPayload) {
    return {
      data: await this.adminCandidates.reactivate(id, {
        userId: user.userId,
        role: user.role,
      }),
    };
  }

  /** 202: the purge is ACCEPTED — the worker anonymizes; nothing happens inline. */
  @Post(':id/purge')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions(Permission.CANDIDATES_DELETE)
  async purge(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PurgeCandidateDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return {
      data: await this.adminCandidates.requestPurge(id, dto, {
        userId: user.userId,
        role: user.role,
      }),
    };
  }
}
