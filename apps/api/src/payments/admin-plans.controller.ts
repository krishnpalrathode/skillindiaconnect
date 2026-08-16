import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { Permission } from '../auth/rbac/permission.constants';
import { RequirePermissions } from '../auth/rbac/require-permissions.decorator';
import { AdminPlansService, AdminPlanRow } from './admin-plans.service';
import { UpdatePlanPriceDto } from './dto/update-plan-price.dto';

/**
 * Plan pricing for the admin console.
 *
 * ── Why this controller lives in Payments, not Admin ────────────────────────
 * A module owns its tables (module-boundaries Rule 4) and `plans` belongs to
 * Payments — the same module whose `CheckoutService` reads the price and turns
 * it into money. Putting an admin-facing controller in `admin/` would have meant
 * that module querying another's table, which is the exact coupling the rule
 * exists to prevent. The route still sits under `/admin/*`; the URL is a
 * consumer-facing detail, not an ownership claim.
 *
 * ── Permissions ─────────────────────────────────────────────────────────────
 * Reuses the Settings pair, because this renders inside the Settings screen's
 * Payments tab and gating a price editor more loosely than the GST rate beside
 * it would make no sense. Read is `settings.view`; write is `settings.manage`,
 * which MODERATOR and SUPPORT do not hold.
 */
@Controller('admin/plans')
export class AdminPlansController {
  constructor(private readonly plans: AdminPlansService) {}

  @Get()
  @RequirePermissions(Permission.SETTINGS_VIEW)
  async list(): Promise<{ data: AdminPlanRow[] }> {
    return { data: await this.plans.list() };
  }

  @Patch(':code')
  @RequirePermissions(Permission.SETTINGS_MANAGE)
  async updatePrice(
    @Param('code') code: string,
    @Body() dto: UpdatePlanPriceDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ data: AdminPlanRow }> {
    const updated = await this.plans.updatePrice(code, dto.priceSubunits, {
      userId: user.userId,
      role: user.role,
    });
    return { data: updated };
  }
}
