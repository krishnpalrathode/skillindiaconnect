import { Controller, Get } from '@nestjs/common';
import { RequirePermissions } from '../auth/rbac/require-permissions.decorator';
import { Permission } from '../auth/rbac/permission.constants';
import { AdminDashboardService } from './admin-dashboard.service';

/**
 * GET /api/v1/admin/dashboard — the admin overview KPIs.
 *
 * RBAC: `reports.view` — seeded ON for every admin-side role (SUPER_ADMIN,
 * ADMIN, MODERATOR, SUPPORT). Seeing the numbers is not the same as acting on
 * them; the mutations behind each queue carry their own, stricter keys.
 */
@Controller('admin/dashboard')
export class AdminDashboardController {
  constructor(private readonly dashboardService: AdminDashboardService) {}

  @Get()
  @RequirePermissions(Permission.REPORTS_VIEW)
  async get() {
    return { data: await this.dashboardService.getDashboard() };
  }
}
