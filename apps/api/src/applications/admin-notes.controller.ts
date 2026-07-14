import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/rbac/require-permissions.decorator';
import { Permission } from '../auth/rbac/permission.constants';
import { AdminNotesService } from './admin-notes.service';
import { CreateNoteDto } from './dto/admin-note.dto';

/**
 * Internal application notes (S6b-B2). RBAC: `applications.notes` — per the
 * frozen contract (NOT `applications.manage`). Admin-only, never surfaced to
 * candidates or employers.
 */
@Controller('admin/applications')
export class AdminNotesController {
  constructor(private readonly notesService: AdminNotesService) {}

  @Get(':id/notes')
  @RequirePermissions(Permission.APPLICATIONS_NOTES)
  async list(@Param('id', ParseUUIDPipe) id: string) {
    return { data: await this.notesService.list(id) };
  }

  @Post(':id/notes')
  @RequirePermissions(Permission.APPLICATIONS_NOTES)
  async add(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateNoteDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return {
      data: await this.notesService.add(id, dto.body, {
        userId: user.userId,
        role: user.role,
      }),
    };
  }

  @Delete(':id/notes/:noteId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(Permission.APPLICATIONS_NOTES)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('noteId', ParseUUIDPipe) noteId: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<void> {
    await this.notesService.remove(id, noteId, { userId: user.userId, role: user.role });
  }
}
