import { Body, Controller, Delete, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { CandidateService } from './candidate.service';
import { DocumentService } from './document.service';
import { PresignDocumentDto } from './dto/presign-document.dto';
import { ConfirmDocumentDto } from './dto/confirm-document.dto';

@Controller('candidates')
export class DocumentController {
  constructor(
    private readonly candidateService: CandidateService,
    private readonly documentService: DocumentService,
  ) {}

  @Post('me/documents/presign')
  async presign(@CurrentUser() user: CurrentUserPayload, @Body() dto: PresignDocumentDto) {
    this.candidateService.assertCandidateRole(user.role);
    const candidateId = await this.candidateService.getCandidateIdByUserId(user.userId);
    return { data: await this.documentService.presign(dto, candidateId) };
  }

  @Post('me/documents/confirm')
  async confirm(@CurrentUser() user: CurrentUserPayload, @Body() dto: ConfirmDocumentDto) {
    this.candidateService.assertCandidateRole(user.role);
    const candidateId = await this.candidateService.getCandidateIdByUserId(user.userId);
    return { data: await this.documentService.confirm(dto, candidateId) };
  }

  @Delete('me/documents/:type')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteDocument(
    @CurrentUser() user: CurrentUserPayload,
    @Param('type') type: string,
  ): Promise<void> {
    this.candidateService.assertCandidateRole(user.role);
    const candidateId = await this.candidateService.getCandidateIdByUserId(user.userId);
    await this.documentService.deleteDocument(type, candidateId);
  }
}
