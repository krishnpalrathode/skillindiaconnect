import { Controller, Get, Param, ParseEnumPipe, ParseUUIDPipe } from '@nestjs/common';
import { DocumentType } from '@prisma/client';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/rbac/require-permissions.decorator';
import { Permission } from '../auth/rbac/permission.constants';
import { AdminDocumentsService } from './admin-documents.service';

/**
 * Admin signed-URL document grants (S6a-B1, decision 5).
 *
 * The two routes carry DIFFERENT keys, because they are different acts:
 *   - `employers.view`            → read a company's registration certificate
 *                                   (needed to approve/reject it at all).
 *   - `candidates.view_documents` → read a candidate's passport. NOT folded into
 *                                   `candidates.view`: a MODERATOR who can see a
 *                                   candidate's card must not thereby be able to
 *                                   open their passport.
 *
 * Every grant is audited per issuance — see AdminDocumentsService.
 */
@Controller('admin')
export class AdminDocumentsController {
  constructor(private readonly documentsService: AdminDocumentsService) {}

  @Get('employers/:id/certificate/url')
  @RequirePermissions(Permission.EMPLOYERS_VIEW)
  async employerCertificate(
    @Param('id', ParseUUIDPipe) companyId: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return {
      data: await this.documentsService.issueEmployerCertificateUrl(companyId, {
        userId: user.userId,
        role: user.role,
      }),
    };
  }

  @Get('candidates/:id/documents/:type/url')
  @RequirePermissions(Permission.CANDIDATES_VIEW_DOCUMENTS)
  async candidateDocument(
    @Param('id', ParseUUIDPipe) candidateId: string,
    @Param('type', new ParseEnumPipe(DocumentType)) type: DocumentType,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    return {
      data: await this.documentsService.issueCandidateDocumentUrl(candidateId, type, {
        userId: user.userId,
        role: user.role,
      }),
    };
  }
}
