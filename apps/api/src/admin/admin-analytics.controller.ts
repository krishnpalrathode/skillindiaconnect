import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermissions } from '../auth/rbac/require-permissions.decorator';
import { Permission } from '../auth/rbac/permission.constants';
import { AdminAnalyticsService } from './admin-analytics.service';

/**
 * GET /api/v1/admin/analytics?days=30 — the dashboard's charts.
 *
 * Same RBAC key as the dashboard KPIs (`reports.view`): this is the same reading
 * surface, sliced by time. `days` is clamped in the service (1…365) rather than
 * validated with a pipe, because an out-of-range value should still render a
 * dashboard rather than 400 an admin out of their own overview.
 */
@Controller('admin/analytics')
export class AdminAnalyticsController {
  constructor(private readonly analytics: AdminAnalyticsService) {}

  @Get()
  @RequirePermissions(Permission.REPORTS_VIEW)
  async get(@Query('days') days?: string) {
    return { data: await this.analytics.getAnalytics(days ? Number(days) : undefined) };
  }
}
