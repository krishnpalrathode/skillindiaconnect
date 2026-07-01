import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Patch,
  Post,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { EmployerService } from './employer.service';
import { RegisterCompanyDto } from './dto/register-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { PresignCertDto } from './dto/presign-cert.dto';
import { ConfirmCertDto } from './dto/confirm-cert.dto';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_MODULES, AuditStatus } from '../audit/audit.types';

@Controller('api/v1/employers')
export class EmployerController {
  constructor(
    private readonly employerService: EmployerService,
    private readonly audit: AuditService,
  ) {}

  @Post('register')
  async register(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: RegisterCompanyDto,
  ) {
    this.assertEmployerRole(user.role);
    const company = await this.employerService.register(user.userId, dto);

    await this.audit.log({
      actorUserId: user.userId,
      actorRole: user.role,
      action: AUDIT_ACTIONS.EMPLOYER_APPROVED, // employer.registered — reusing module bucket
      module: AUDIT_MODULES.EMPLOYER,
      targetType: 'Company',
      targetId: company.id,
      status: AuditStatus.SUCCESS,
      meta: { companyName: company.name, event: 'registered' },
    });

    return { data: company };
  }

  @Get('me/company')
  async getMyCompany(@CurrentUser() user: CurrentUserPayload) {
    this.assertEmployerRole(user.role);
    const company = await this.employerService.getCompanyForEmployerUser(user.userId);
    return { data: company };
  }

  @Patch('me/company')
  async updateMyCompany(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: UpdateCompanyDto,
  ) {
    this.assertEmployerRole(user.role);
    const company = await this.employerService.updateCompany(user.userId, dto);
    return { data: company };
  }

  @Post('me/company/documents/presign')
  async presignCert(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: PresignCertDto,
  ) {
    this.assertEmployerRole(user.role);
    const result = await this.employerService.presignCert(user.userId, dto);
    return { data: result };
  }

  @Post('me/company/documents/confirm')
  async confirmCert(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: ConfirmCertDto,
  ) {
    this.assertEmployerRole(user.role);
    const doc = await this.employerService.confirmCert(user.userId, dto);
    return { data: doc };
  }

  @Get('me/dashboard')
  async getDashboard(@CurrentUser() user: CurrentUserPayload) {
    this.assertEmployerRole(user.role);
    const dashboard = await this.employerService.getDashboard(user.userId);
    return { data: dashboard };
  }

  private assertEmployerRole(role: UserRole): void {
    if (role !== UserRole.EMPLOYER) {
      throw new ForbiddenException({ code: 'FORBIDDEN' });
    }
  }
}
