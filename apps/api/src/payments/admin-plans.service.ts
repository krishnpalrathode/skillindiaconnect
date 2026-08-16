import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Plan, UserRole } from '@prisma/client';
import { PrismaService } from '../core/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AUDIT_ACTIONS, AUDIT_MODULES, AuditStatus } from '../audit/audit.types';

/**
 * Plan pricing, editable by an admin.
 *
 * Prices used to be reachable only through the seed, so changing ₹2,999 meant a
 * developer, a migration window and a deploy. They live in the `plans` table and
 * `CheckoutService` reads `plan.priceSubunits` at order-creation time, so an edit
 * here takes effect on the very next checkout with nothing to restart.
 *
 * ── What an edit does NOT touch ─────────────────────────────────────────────
 * Orders and invoices snapshot `amountSubunits`/`gstSubunits`/`totalSubunits` at
 * purchase. Re-pricing a plan therefore cannot rewrite what anyone was already
 * charged — history stays exactly as billed. Existing subscriptions keep running
 * to their `expiresAt`; the new price applies when they next buy.
 */

/** ₹10,00,000 in paise — a ceiling that catches a mistyped extra zero. */
export const PLAN_PRICE_MAX_SUBUNITS = 100_000_000;

export interface AdminPlanRow {
  code: string;
  name: string;
  priceSubunits: number;
  period: Plan['period'];
  maxActiveJobs: number | null;
  isActive: boolean;
  /** False for the FREE plan, whose price is structural — see updatePrice. */
  priceEditable: boolean;
}

@Injectable()
export class AdminPlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<AdminPlanRow[]> {
    // Inactive plans included on purpose: `isActive=false` is the kill switch,
    // and a plan you cannot see is one you cannot turn back on.
    const plans = await this.prisma.plan.findMany({ orderBy: { priceSubunits: 'asc' } });
    return plans.map((p) => this.toRow(p));
  }

  /**
   * Set a plan's price, in integer subunits (paise).
   *
   * ── The two guards, and why they are not cosmetic ───────────────────────────
   * `CheckoutService` decides purchasability with `plan.priceSubunits === 0`.
   * That single comparison is why:
   *
   *   - the FREE plan may not be given a price. Doing so would make Free
   *     purchasable, put it on the upgrade path, and start charging for the tier
   *     the product promises at no cost.
   *   - a paid plan may not be set to 0. It would stop being purchasable and the
   *     upgrade button would fail with PLAN_NOT_PURCHASABLE — a plan silently
   *     removed from sale by what looks like a discount.
   *
   * Neither is expressible as a bound, so both are checked here rather than left
   * to the DTO.
   */
  async updatePrice(
    code: string,
    priceSubunits: number,
    actor: { userId: string; role: UserRole },
  ): Promise<AdminPlanRow> {
    const plan = await this.prisma.plan.findUnique({ where: { code } });
    if (!plan) throw new NotFoundException({ code: 'PLAN_NOT_FOUND' });

    if (!Number.isInteger(priceSubunits) || priceSubunits < 0) {
      throw new UnprocessableEntityException({
        code: 'PLAN_PRICE_INVALID',
        detail: 'Price must be a whole number of paise, zero or greater.',
      });
    }
    if (priceSubunits > PLAN_PRICE_MAX_SUBUNITS) {
      throw new UnprocessableEntityException({
        code: 'PLAN_PRICE_INVALID',
        detail: `Price cannot exceed ${PLAN_PRICE_MAX_SUBUNITS / 100} per period.`,
      });
    }

    const isFreePlan = plan.priceSubunits === 0;
    if (isFreePlan && priceSubunits !== 0) {
      throw new UnprocessableEntityException({
        code: 'FREE_PLAN_NOT_PRICEABLE',
        detail: 'The Free plan must stay at zero. Create a paid plan instead.',
      });
    }
    if (!isFreePlan && priceSubunits === 0) {
      throw new UnprocessableEntityException({
        code: 'PAID_PLAN_NEEDS_PRICE',
        detail: 'A paid plan cannot be set to zero. Deactivate it instead.',
      });
    }

    if (priceSubunits === plan.priceSubunits) return this.toRow(plan);

    const updated = await this.prisma.plan.update({
      where: { code },
      data: { priceSubunits },
    });

    /*
      Money changes are audited with BOTH numbers. "Someone changed the price" is
      useless when a customer disputes what they were charged; the before/after
      pair and the actor are what answers it.
    */
    await this.audit.log({
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: AUDIT_ACTIONS.PLAN_PRICE_UPDATED,
      module: AUDIT_MODULES.PAYMENTS,
      targetType: 'Plan',
      targetId: plan.id,
      status: AuditStatus.SUCCESS,
      meta: {
        planCode: plan.code,
        fromSubunits: plan.priceSubunits,
        toSubunits: priceSubunits,
      },
    });

    return this.toRow(updated);
  }

  private toRow(plan: Plan): AdminPlanRow {
    return {
      code: plan.code,
      name: plan.name,
      priceSubunits: plan.priceSubunits,
      period: plan.period,
      maxActiveJobs: plan.maxActiveJobs,
      isActive: plan.isActive,
      priceEditable: plan.priceSubunits !== 0,
    };
  }
}
