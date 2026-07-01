import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { RequirePermissions } from '../auth/rbac/require-permissions.decorator';
import { Permission } from '../auth/rbac/permission.constants';
import { EmployerService } from './employer.service';
import { EmployerApprovalService } from './employer-approval.service';
import { RejectCompanyDto } from './dto/reject-company.dto';
import { ListEmployersDto } from './dto/list-employers.dto';

@Controller('api/v1/admin/employers')
export class AdminEmployerController {
  constructor(
    private readonly employerService: EmployerService,
    private readonly approvalService: EmployerApprovalService,
  ) {}

  @Get()
  @RequirePermissions(Permission.EMPLOYERS_VIEW)
  async list(@Query() query: ListEmployersDto) {
    const result = await this.employerService.adminList({
      status: query.status,
      type: query.type,
      search: query.search,
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 20,
      sort: query.sort ?? 'createdAt:desc',
    });
    return result;
  }

  @Post(':id/approve')
  @RequirePermissions(Permission.EMPLOYERS_APPROVE_REJECT)
  async approve(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const company = await this.approvalService.approve(id, user.userId, user.role);
    return { data: company };
  }

  @Post(':id/reject')
  @RequirePermissions(Permission.EMPLOYERS_APPROVE_REJECT)
  async reject(
    @Param('id') id: string,
    @Body() dto: RejectCompanyDto,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const company = await this.approvalService.reject(id, dto.reason, user.userId, user.role);
    return { data: company };
  }

  @Post(':id/suspend')
  @RequirePermissions(Permission.EMPLOYERS_SUSPEND)
  async suspend(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const company = await this.approvalService.suspend(id, user.userId, user.role);
    return { data: company };
  }

  @Post(':id/reactivate')
  @RequirePermissions(Permission.EMPLOYERS_APPROVE_REJECT)
  async reactivate(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ) {
    const company = await this.approvalService.reactivate(id, user.userId, user.role);
    return { data: company };
  }
}
