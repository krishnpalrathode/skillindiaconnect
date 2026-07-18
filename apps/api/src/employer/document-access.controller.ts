import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
} from '@nestjs/common';
import { DocumentType, UserRole } from '@prisma/client';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { DocumentAccessService } from './document-access.service';

/**
 * GET /employers/candidates/:id/documents/:type/url — the Pro document gate
 * (S5-B3). All ordering/privacy semantics live in DocumentAccessService; this
 * controller only shapes the route and the role check.
 */
@Controller('employers')
export class DocumentAccessController {
  constructor(private readonly documentAccessService: DocumentAccessService) {}

  @Get('candidates/:id/documents/:type/url')
  async getDocumentUrl(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) candidateId: string,
    @Param('type', new ParseEnumPipe(DocumentType)) type: DocumentType,
  ) {
    if (user.role !== UserRole.EMPLOYER) {
      throw new ForbiddenException({ code: 'FORBIDDEN' });
    }
    return {
      data: await this.documentAccessService.issueDocumentUrl(user.userId, candidateId, type),
    };
  }
}
