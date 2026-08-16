import { Injectable } from '@nestjs/common';
import { SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../core/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { SETTING_KEYS } from '../settings/settings.keys';
import { FREE_PLAN_CODE } from './subscription-lifecycle.constants';

/**
 * The company's entitlements as derived from its subscription state.
 * `status` reports the underlying paid-subscription state ('NONE' when the
 * company never held a paid plan) — gates branch on the entitlement fields,
 * never on `status`.
 */
export interface EffectivePlan {
  /** The paid plan's code, or 'FREE' when no live paid subscription exists. */
  planCode: string;
  /** Publish-quota cap; null = unlimited. FREE reads the Settings value. */
  maxActiveJobs: number | null;
  /** The Pro document gate (S5-B3). GRACE keeps it — grace is fully paid. */
  documentAccess: boolean;
  status: SubscriptionStatus | 'NONE';
}

/**
 * THE single source of plan truth (S5-B3). The publish-quota gate and the
 * Pro document gate BOTH consult this — no other code interprets
 * subscription state into entitlements.
 *
 * Semantics:
 * - ACTIVE or GRACE paid subscription → the paid plan's entitlements.
 *   GRACE keeps EVERYTHING (that is what grace means — a grace-period
 *   employer losing document access mid-negotiation would be wrong).
 * - EXPIRED / none → FREE entitlements: maxActiveJobs from the
 *   FREE_MAX_ACTIVE_JOBS setting, documentAccess false.
 * - Subscriptions on the FREE plan row never count as paid; the Free cap
 *   always comes from the setting (Super-Admin tunable), never from the
 *   FREE plan row's maxActiveJobs column.
 * - documentAccess derives from "holds a live paid plan": plans carry no
 *   documentAccess column (`features` is display copy only), and the
 *   S5-0 contract defines document access as THE Pro feature.
 */
@Injectable()
export class SubscriptionReadService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
  ) {}

  /**
   * S6a-B1 (admin dashboard): revenue invoiced in the CURRENT calendar month,
   * in integer subunits.
   *
   * Keyed on the INVOICE's issuedAt, not the order's createdAt: an order created
   * on the 31st and paid on the 1st belongs to the month it was invoiced in, and
   * the invoice is the financial record of truth. ONE aggregate query — the sum
   * happens in Postgres, never by pulling rows into Node.
   */
  async revenueThisMonthSubunits(now: Date = new Date()): Promise<number> {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const result = await this.prisma.order.aggregate({
      _sum: { totalSubunits: true },
      where: {
        invoice: { issuedAt: { gte: startOfMonth, lt: startOfNextMonth } },
      },
    });
    return result._sum.totalSubunits ?? 0;
  }

  /**
   * S22 (admin analytics): revenue invoiced in an ARBITRARY window, in integer
   * subunits — the same figure as `revenueThisMonthSubunits`, but scoped to the
   * dashboard's selected range so it can be compared against the previous one.
   *
   * Keyed on the invoice's `issuedAt` for the same reason as the monthly figure:
   * the invoice is the financial record of truth, not the order's createdAt.
   * `to` is EXCLUSIVE, matching every other window on that dashboard.
   */
  async revenueBetweenSubunits(from: Date, to: Date): Promise<number> {
    const result = await this.prisma.order.aggregate({
      _sum: { totalSubunits: true },
      where: { invoice: { issuedAt: { gte: from, lt: to } } },
    });
    return result._sum.totalSubunits ?? 0;
  }

  async effectivePlan(companyId: string): Promise<EffectivePlan> {
    // Latest paid subscription regardless of status: activation (S5-B2)
    // retires superseded rows and creates/extends the live one, so the
    // newest `startsAt` among paid plans IS the company's current term.
    const sub = await this.prisma.subscription.findFirst({
      where: { companyId, plan: { code: { not: FREE_PLAN_CODE } } },
      orderBy: { startsAt: 'desc' },
      include: { plan: true },
    });

    if (
      sub &&
      (sub.status === SubscriptionStatus.ACTIVE || sub.status === SubscriptionStatus.GRACE)
    ) {
      return {
        planCode: sub.plan.code,
        maxActiveJobs: sub.plan.maxActiveJobs,
        documentAccess: true,
        status: sub.status,
      };
    }

    const freeCap = await this.settingsService.get(SETTING_KEYS.FREE_MAX_ACTIVE_JOBS);
    return {
      planCode: FREE_PLAN_CODE,
      maxActiveJobs: freeCap,
      documentAccess: false,
      status: sub ? sub.status : 'NONE',
    };
  }
}
